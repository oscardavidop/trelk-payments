import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { createHmac } from 'crypto';
import { Client, Environment, OrdersController, SubscriptionsController } from '@paypal/paypal-server-sdk';
import { RedisService } from '../redis/redis.service';

/** Clave Redis para el access token de PayPal (compartido entre todos los pods) */
const PAYPAL_TOKEN_REDIS_KEY = 'paypal:access_token';

/** Clave Redis del lock de refresco (previene stampede multi-instancia) */
const PAYPAL_TOKEN_LOCK_KEY = 'paypal:token:lock';

@Injectable()
export class PaypalService {
  private axiosInstance: AxiosInstance;
  /** Fallback in-memory: usado si Redis no está disponible */
  private fallbackToken = '';
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly client: Client;
  public readonly subscriptionsController: SubscriptionsController;
  public readonly ordersController: OrdersController;

  constructor(private readonly redisService: RedisService) {
    this.clientId = this.requireEnv('PAYPAL_CLIENT_ID');
    this.clientSecret = this.requireEnv('PAYPAL_CLIENT_SECRET');

    // SEGURIDAD: NUNCA loguear clientId ni clientSecret
    console.log(`[PayPalService] Initializing in ${process.env.PAYPAL_MODE === 'live' ? 'Production' : 'Sandbox'} mode`);

    // FIX: Usar variables de entorno, NO hardcodear credenciales
    this.client = new Client({
      clientCredentialsAuthCredentials: {
        oAuthClientId: this.clientId,
        oAuthClientSecret: this.clientSecret
      },
      timeout: 30000, // FIX: 30 segundos timeout
      environment: process.env.PAYPAL_MODE === 'live' ? Environment.Production : Environment.Sandbox
    });

    // this.client.clientCredentialsAuthManager.fetchToken().then(token => {
    //   console.log('[PayPalService] Initial access token obtained', token);
    // }).catch(error => {
    //   console.error('[PayPalService] Error obtaining initial access token:', error?.message);
    // });

    this.subscriptionsController = new SubscriptionsController(this.client);
    this.ordersController = new OrdersController(this.client);

    const apiUrl =
      process.env.PAYPAL_MODE === 'sandbox'
        ? 'https://api-m.sandbox.paypal.com'
        : 'https://api-m.paypal.com';

    this.axiosInstance = axios.create({
      baseURL: apiUrl,
      timeout: 30000, // FIX: 30 segundos timeout
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Obtiene una variable de entorno requerida o lanza error descriptivo.
   */
  private requireEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
      throw new Error(`Missing required environment variable ${key}`);
    }
    return value;
  }

  /**
   * Obtiene el access token de PayPal.
   *
   * Estrategia multi-capa (resiliente en todos los escenarios):
   * 1. Cache Redis: consulta rápida, compartida entre todos los pods/instancias.
   * 2. Distributed lock: exactamente UN pod refresca el token cuando expira.
   *    (Previene el «thundering herd» problem con N pods arrancando a la vez)
   * 3. Double-check tras lock: si otro pod ya refrescó mientras esperábamos.
   * 4. Fallback in-memory: si Redis no está disponible, degrada graciosamente.
   */
  async getAccessToken(): Promise<string> {
    // ── 1. Fast path: token en Redis ─────────────────────────────────────────
    const cached = await this.redisService.get(PAYPAL_TOKEN_REDIS_KEY);
    if (cached) return cached;

    // ── 2. Adquirir lock distribuido (15s TTL) ───────────────────────────────
    // Sólo un pod refresca a la vez; los demás esperan y reusan el resultado.
    const lockToken = await this.redisService.acquireLock(PAYPAL_TOKEN_LOCK_KEY, 15_000);

    if (!lockToken) {
      // Otro pod tiene el lock → esperar 300ms y reusar su resultado
      await new Promise((r) => setTimeout(r, 300));
      const retryCache = await this.redisService.get(PAYPAL_TOKEN_REDIS_KEY);
      if (retryCache) return retryCache;
      // Si aún no hay token (ej: Redis caído), continuar sin lock
    }

    try {
      // ── 3. Double-check post-lock (otro pod pudo haberlo seteado) ──────────
      if (lockToken) {
        const afterLock = await this.redisService.get(PAYPAL_TOKEN_REDIS_KEY);
        if (afterLock) return afterLock;
      }

      // ── 4. Obtener nuevo token de PayPal ──────────────────────────────────
      const token = await this.client.clientCredentialsAuthManager.fetchToken();
      const accessToken = token.accessToken;
      const expiresIn: number = (token as any).expiresIn ?? 3600;
      const ttlSeconds = Math.max(expiresIn - 60, 30); // margen 60s, mínimo 30s

      // Guardar en Redis (compartido) y en memoria (fallback local)
      await this.redisService.set(PAYPAL_TOKEN_REDIS_KEY, accessToken, ttlSeconds);
      this.fallbackToken = accessToken;

      return accessToken;
    } catch (error: any) {
      console.error('[PayPalService] Error getting access token:', error?.message);
      // Fallback in-memory si Redis/PayPal fallan
      if (this.fallbackToken) return this.fallbackToken;
      throw new HttpException('Failed to get PayPal access token', HttpStatus.INTERNAL_SERVER_ERROR);
    } finally {
      if (lockToken) {
        await this.redisService.releaseLock(PAYPAL_TOKEN_LOCK_KEY, lockToken);
      }
    }
  }

  /**
   * Crea un producto en PayPal
   */
  async createProduct(name: string, description: string): Promise<any> {
    try {
      const token = await this.getAccessToken();

      const response = await this.axiosInstance.post(
        '/v1/billing/products',
        {
          name,
          description,
          type: 'SERVICE',
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.error('Error creating product:', error?.response?.data || error?.message);
      throw new HttpException('Failed to create PayPal product', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Crea un plan de suscripción en PayPal
   */
  async createPlan(productId: string, name: string, price: string, currency: string = 'USD'): Promise<any> {
    try {
      const token = await this.getAccessToken();

      const response = await this.axiosInstance.post(
        '/v1/billing/plans',
        {
          product_id: productId,
          name,
          description: name,
          billing_cycles: [
            {
              frequency: {
                interval_unit: 'MONTH',
                interval_count: 1,
              },
              tenure_type: 'REGULAR',
              sequence: 1,
              total_cycles: 0, // 0 = infinito
              pricing_scheme: {
                fixed_price: {
                  value: price,
                  currency_code: currency,
                },
              },
            },
          ],
          payment_preferences: {
            auto_bill_amount: 'YES',
            setup_fee_failure_action: 'CONTINUE',
            payment_failure_threshold: 3,
          },
          taxes: {
            percentage: '0',
          },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.error('Error creating plan:', error?.response?.data || error?.message);
      throw new HttpException('Failed to create PayPal plan', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Obtiene detalles de un plan
   */
  async getPlan(planId: string): Promise<any> {
    try {
      const token = await this.getAccessToken();

      const response = await this.axiosInstance.get(`/v1/billing/plans/${planId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return response.data;
    } catch (error: any) {
      console.error('Error getting plan:', error?.response?.data || error?.message);
      throw new HttpException('Failed to get PayPal plan', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Obtiene detalles de una suscripción
   */
  async getSubscription(subscriptionId: string): Promise<any> {
    try {
      const token = await this.getAccessToken();

      const response = await this.axiosInstance.get(
        `/v1/billing/subscriptions/${subscriptionId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.error('Error getting subscription:', error?.response?.data || error?.message);
      throw new HttpException('Failed to get PayPal subscription', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Cancela una suscripción
   */
  async cancelSubscription(subscriptionId: string, reason: string = 'Customer requested cancellation'): Promise<any> {
    try {
      const token = await this.getAccessToken();

      const response = await this.axiosInstance.post(
        `/v1/billing/subscriptions/${subscriptionId}/cancel`,
        {
          reason,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.error('Error cancelling subscription:', error?.response?.data || error?.message);
      throw new HttpException('Failed to cancel PayPal subscription', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Suspende una suscripción
   */
  async suspendSubscription(subscriptionId: string, reason: string = 'Temporary suspension'): Promise<any> {
    try {
      const token = await this.getAccessToken();

      const response = await this.axiosInstance.post(
        `/v1/billing/subscriptions/${subscriptionId}/suspend`,
        {
          reason,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.error('Error suspending subscription:', error?.response?.data || error?.message);
      throw new HttpException('Failed to suspend PayPal subscription', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Reactiva una suscripción suspendida
   */
  async activateSubscription(subscriptionId: string): Promise<any> {
    try {
      const token = await this.getAccessToken();

      const response = await this.axiosInstance.post(
        `/v1/billing/subscriptions/${subscriptionId}/activate`,
        {
          reason: 'Customer reactivating subscription',
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.error('Error activating subscription:', error?.response?.data || error?.message);
      throw new HttpException('Failed to activate PayPal subscription', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Verifica la firma de un webhook de PayPal
   */
  async verifyWebhookSignature(
    webhookId: string,
    req: any,
  ): Promise<boolean> {
    try {
      const token = await this.getAccessToken();

      if (!req.rawBody) {
        console.error('Missing rawBody');
        return false;
      }

      const payload = {
        auth_algo: req.headers['paypal-auth-algo'],
        cert_url: req.headers['paypal-cert-url'],
        transmission_id: req.headers['paypal-transmission-id'],
        transmission_sig: req.headers['paypal-transmission-sig'],
        transmission_time: req.headers['paypal-transmission-time'],
        webhook_id: webhookId,
        webhook_event: JSON.parse(req.rawBody), // 🔑 CLAVE
      };

      // console.log('Verifying webhook with payload:', payload);

      const response = await this.axiosInstance.post(
        '/v1/notifications/verify-webhook-signature',
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data.verification_status === 'SUCCESS';
    } catch (error: any) {
      console.error(
        'Error verifying webhook signature:',
        error?.response?.data || error?.message,
      );
      return false;
    }
  }


  /**
   * Obtiene el certificado de PayPal para verificación local de webhooks.
   * SEGURIDAD: Solo permite URLs que pertenezcan a los dominios oficiales de PayPal
   * para prevenir SSRF (Server-Side Request Forgery).
   */
  async getWebhookSignatureKey(certUrl: string): Promise<string> {
    // SSRF guard: solo dominios PayPal aceptados
    const ALLOWED_CERT_HOSTS = [
      'api.paypal.com',
      'api-m.paypal.com',
      'api.sandbox.paypal.com',
      'api-m.sandbox.paypal.com',
    ];
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(certUrl);
    } catch {
      throw new HttpException('Invalid cert URL', HttpStatus.BAD_REQUEST);
    }
    if (!ALLOWED_CERT_HOSTS.includes(parsedUrl.hostname)) {
      throw new HttpException('Untrusted cert URL host', HttpStatus.BAD_REQUEST);
    }
    if (parsedUrl.protocol !== 'https:') {
      throw new HttpException('Cert URL must use HTTPS', HttpStatus.BAD_REQUEST);
    }
    try {
      const response = await axios.get(certUrl, { timeout: 5000 });
      return response.data;
    } catch (error: any) {
      console.error('Error getting webhook certificate:', error?.message);
      throw new HttpException('Failed to get webhook certificate', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Genera el signature esperado para validación local de webhooks
   */
  generateWebhookSignature(
    transmissionId: string,
    transmissionTime: string,
    webhookId: string,
    eventBody: any,
  ): string {
    const expectedSignature = transmissionId + '|' + transmissionTime + '|' + webhookId + '|' + eventBody;

    return createHmac('sha256', this.clientSecret)
      .update(expectedSignature)
      .digest('base64');
  }
}
