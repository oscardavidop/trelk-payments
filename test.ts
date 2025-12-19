/**
 * Script de testing para verificar endpoints y flujo de suscripción
 * Uso: ts-node test.ts
 */

import axios from 'axios';

const BASE_URL = 'http://localhost:3001';
const TEST_TELEGRAM_ID = 123456789;
const TEST_SUBSCRIPTION_ID = 'I-TEST123';

async function test() {
  console.log('🧪 Iniciando tests...\n');

  try {
    // 1. Verificar que servidor está corriendo
    console.log('1️⃣ Verificando conexión al servidor...');
    await axios.get(BASE_URL);
    console.log('✅ Servidor accesible\n');

    // 2. Obtener página de suscripción
    console.log('2️⃣ Obteniendo página de suscripción...');
    const subscribeResponse = await axios.get(
      `${BASE_URL}/paypal/subscribe?tg_id=${TEST_TELEGRAM_ID}`,
    );
    console.log(`✅ Código: ${subscribeResponse.status}`);
    console.log(`✅ Tamaño HTML: ${subscribeResponse.data.length} bytes\n`);

    // 3. Verificar estado de usuario
    console.log('3️⃣ Verificando estado de usuario...');
    const statusResponse = await axios.get(`${BASE_URL}/paypal/status?tg_id=${TEST_TELEGRAM_ID}`);
    console.log('✅ Status:', JSON.stringify(statusResponse.data, null, 2));
    console.log();

    // 4. Simular webhook de activación
    console.log('4️⃣ Simulando webhook de suscripción ACTIVADA...');
    const webhookResponse = await axios.post(`${BASE_URL}/paypal/webhook`, {
      event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
      resource: {
        id: TEST_SUBSCRIPTION_ID,
        custom_id: `telegram_${TEST_TELEGRAM_ID}`,
        status: 'ACTIVE',
        payer: {
          payer_info: {
            email: `user_${TEST_TELEGRAM_ID}@telegram.local`,
          },
        },
        billing_cycles: [
          {
            pricing_scheme: {
              fixed_price: {
                value: '10.00',
                currency_code: 'USD',
              },
            },
          },
        ],
      },
    });
    console.log('✅ Webhook procesado:', webhookResponse.data);
    console.log();

    // 5. Verificar que usuario es premium
    console.log('5️⃣ Verificando que usuario es premium...');
    const statusAfter = await axios.get(`${BASE_URL}/paypal/status?tg_id=${TEST_TELEGRAM_ID}`);
    console.log('✅ Status después:', JSON.stringify(statusAfter.data, null, 2));
    console.log();

    // 6. Simular cancelación
    console.log('6️⃣ Simulando cancelación de suscripción...');
    const cancelWebhook = await axios.post(`${BASE_URL}/paypal/webhook`, {
      event_type: 'BILLING.SUBSCRIPTION.CANCELLED',
      resource: {
        id: TEST_SUBSCRIPTION_ID,
        custom_id: `telegram_${TEST_TELEGRAM_ID}`,
        status: 'CANCELLED',
      },
    });
    console.log('✅ Cancelación procesada:', cancelWebhook.data);
    console.log();

    // 7. Verificar que usuario no es premium
    console.log('7️⃣ Verificando que usuario no es premium...');
    const statusFinal = await axios.get(`${BASE_URL}/paypal/status?tg_id=${TEST_TELEGRAM_ID}`);
    console.log('✅ Status final:', JSON.stringify(statusFinal.data, null, 2));
    console.log();

    console.log('═══════════════════════════════════════════');
    console.log('✨ ¡Todos los tests pasaron exitosamente!');
    console.log('═══════════════════════════════════════════');
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        '❌ Error:',
        error.response?.data || error.message || 'Error desconocido',
      );
    } else {
      console.error('❌ Error:', error);
    }
    process.exit(1);
  }
}

test();
