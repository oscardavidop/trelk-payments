import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { createHmac } from 'crypto';
import { Client, Environment, LogLevel, OrdersController, SubscriptionsController } from '@paypal/paypal-server-sdk';

@Injectable()
export class PaypalService {
  private axiosInstance: AxiosInstance;
  private accessToken = '';
  private tokenExpiry = new Date(0);
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly client: Client;
  public readonly subscriptionsController: SubscriptionsController;
  public readonly ordersController: OrdersController;

  constructor() {
    this.clientId = this.requireEnv('PAYPAL_CLIENT_ID');
    this.clientSecret = this.requireEnv('PAYPAL_CLIENT_SECRET');

    this.client = new Client({
      clientCredentialsAuthCredentials: {
        oAuthClientId: "ASSliDYKV_oegv0sWN2MaF0mHMfQo6avfPYdYJhFu5O2tFv-bscGJm6xDLdBn0TJPvtUTI8o-9XJ2sJ_",
        oAuthClientSecret: "EAAtAgMHvoHoxJTCChXNVJ7kM54ey96Mi9oVaCNWyo4ElrpPq5E1LzQlqhDxHyh1qK_jamYdywCou2VM"
      },
      timeout: 0,
      environment: Environment.Sandbox
    });

    this.subscriptionsController = new SubscriptionsController(this.client);
    this.ordersController = new OrdersController(this.client);

    const apiUrl =
      process.env.PAYPAL_MODE === 'sandbox'
        ? 'https://api-m.sandbox.paypal.com'
        : 'https://api-m.paypal.com';

    this.axiosInstance = axios.create({
      baseURL: apiUrl,
      headers: {
        'Content-Type': 'application/json',
        // 'Authorization': `Bearer ${this.accessToken}`,
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
   * Obtiene el access token de PayPal
   */
  async getAccessToken(): Promise<string> {

    // if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
    //   return this.accessToken;
    // }

    try {
      //   const response = await this.axiosInstance.post('/v1/oauth2/token', 'grant_type=client_credentials', {
      //     headers: {
      //       'Content-Type': 'application/x-www-form-urlencoded',
      //     },
      //   });

      //   this.accessToken = response.data.access_token;
      //   this.tokenExpiry = new Date(Date.now() + response.data.expires_in * 1000 - 60000);
      const token = await this.client.clientCredentialsAuthManager.fetchToken()
      this.accessToken = token.accessToken;
      return this.accessToken;
    } catch (error: any) {
      console.error('Error getting PayPal access token:', error);
      throw new HttpException('Failed to get PayPal access token', HttpStatus.INTERNAL_SERVER_ERROR);
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
   * Obtiene el ID de webhook del cliente (para verificación local)
   */
  async getWebhookSignatureKey(transmissionId: string, transmissionTime: string, certUrl: string): Promise<string> {
    try {
      const response = await axios.get(certUrl);
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
