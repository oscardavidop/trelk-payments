#!/bin/bash

# Script para crear producto y plan en PayPal
# Uso: node scripts/create-paypal-plan.js

set -e

echo "🚀 Creando producto y plan en PayPal..."

# Variables
CLIENT_ID="${PAYPAL_CLIENT_ID}"
CLIENT_SECRET="${PAYPAL_CLIENT_SECRET}"
MODE="${PAYPAL_MODE:-sandbox}"

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
  echo "❌ Error: PAYPAL_CLIENT_ID o PAYPAL_CLIENT_SECRET no están configuradas"
  exit 1
fi

# URL base
if [ "$MODE" = "sandbox" ]; then
  BASE_URL="https://api-m.sandbox.paypal.com"
else
  BASE_URL="https://api-m.paypal.com"
fi

# 1. Obtener access token
echo "📝 Obteniendo access token..."
TOKEN_RESPONSE=$(curl -s -X POST "$BASE_URL/v1/oauth2/token" \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials")

ACCESS_TOKEN=$(echo $TOKEN_RESPONSE | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

if [ -z "$ACCESS_TOKEN" ]; then
  echo "❌ Error: No se pudo obtener access token"
  echo "Respuesta: $TOKEN_RESPONSE"
  exit 1
fi

echo "✅ Token obtenido"

# 2. Crear producto
echo "🏪 Creando producto..."
PRODUCT_RESPONSE=$(curl -s -X POST "$BASE_URL/v1/billing/products" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Premium Bot Access",
    "description": "Acceso premium a funciones exclusivas del bot",
    "type": "SERVICE"
  }')

PRODUCT_ID=$(echo $PRODUCT_RESPONSE | grep -o '"id":"[^"]*' | cut -d'"' -f4 | head -1)

if [ -z "$PRODUCT_ID" ]; then
  echo "❌ Error: No se pudo crear el producto"
  echo "Respuesta: $PRODUCT_RESPONSE"
  exit 1
fi

echo "✅ Producto creado: $PRODUCT_ID"

# 3. Crear plan
echo "💳 Creando plan..."
PLAN_RESPONSE=$(curl -s -X POST "$BASE_URL/v1/billing/plans" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{
    "product_id": "'$PRODUCT_ID'",
    "name": "Premium Mensual",
    "description": "Plan Premium - $10 USD por mes",
    "billing_cycles": [
      {
        "frequency": {
          "interval_unit": "MONTH",
          "interval_count": 1
        },
        "tenure_type": "REGULAR",
        "sequence": 1,
        "total_cycles": 0,
        "pricing_scheme": {
          "fixed_price": {
            "value": "10.00",
            "currency_code": "USD"
          }
        }
      }
    ],
    "payment_preferences": {
      "auto_bill_amount": "YES",
      "setup_fee_failure_action": "CONTINUE",
      "payment_failure_threshold": 3
    },
    "taxes": {
      "percentage": "0"
    }
  }')

PLAN_ID=$(echo $PLAN_RESPONSE | grep -o '"id":"[^"]*' | cut -d'"' -f4 | head -1)

if [ -z "$PLAN_ID" ]; then
  echo "❌ Error: No se pudo crear el plan"
  echo "Respuesta: $PLAN_RESPONSE"
  exit 1
fi

echo "✅ Plan creado: $PLAN_ID"

# 4. Mostrar variables de entorno
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✨ ¡Éxito! Copia estas variables a tu archivo .env:"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "PAYPAL_PLAN_ID=$PLAN_ID"
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "📋 Próximos pasos:"
echo ""
echo "1. Ve a https://developer.paypal.com → Webhooks"
echo "2. Crea un nuevo webhook con URL:"
echo "   https://tu-dominio.com/paypal/webhook"
echo "3. Selecciona estos eventos:"
echo "   - BILLING.SUBSCRIPTION.ACTIVATED"
echo "   - BILLING.SUBSCRIPTION.CANCELLED"
echo "   - BILLING.SUBSCRIPTION.SUSPENDED"
echo "   - BILLING.SUBSCRIPTION.RE_ACTIVATED"
echo "   - PAYMENT.BILLING.SUBSCRIPTION.PAYMENT.FAILED"
echo "4. Copia el WEBHOOK_ID a tu .env"
echo ""
echo "═══════════════════════════════════════════════════════════"
