import Stripe from 'stripe';
import Iyzipay from 'iyzipay';

interface PaymentConfig {
  provider: 'stripe' | 'iyzico';
  stripeSecretKey?: string;
  iyzicoApiKey?: string;
  iyzicoSecretKey?: string;
  iyzicoBaseUrl?: string;
}

interface PaymentRequest {
  amount: number;
  currency: string;
  description: string;
  customerEmail: string;
  customerName: string;
  paymentMethodId?: string; // For Stripe
  cardDetails?: {
    cardNumber: string;
    expireMonth: string;
    expireYear: string;
    cvc: string;
    cardHolderName: string;
  }; // For iyzico
}

interface PaymentResponse {
  success: boolean;
  transactionId?: string;
  error?: string;
  rawResponse?: any;
}

export class PaymentService {
  private config: PaymentConfig;
  private stripe?: Stripe;
  private iyzipay?: any;

  constructor() {
    this.config = {
      provider: (process.env.PAYMENT_PROVIDER as 'stripe' | 'iyzico') || 'stripe',
      stripeSecretKey: process.env.STRIPE_SECRET_KEY,
      iyzicoApiKey: process.env.IYZICO_API_KEY,
      iyzicoSecretKey: process.env.IYZICO_SECRET_KEY,
      iyzicoBaseUrl: process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com',
    };

    this.initializeProvider();
  }

  private initializeProvider() {
    if (this.config.provider === 'stripe' && this.config.stripeSecretKey) {
      this.stripe = new Stripe(this.config.stripeSecretKey, {
        apiVersion: '2023-10-16',
      });
    } else if (this.config.provider === 'iyzico') {
      this.iyzipay = new Iyzipay({
        apiKey: this.config.iyzicoApiKey,
        secretKey: this.config.iyzicoSecretKey,
        uri: this.config.iyzicoBaseUrl,
      });
    }
  }

  async processPayment(request: PaymentRequest): Promise<PaymentResponse> {
    try {
      if (this.config.provider === 'stripe') {
        return await this.processStripePayment(request);
      } else if (this.config.provider === 'iyzico') {
        return await this.processIyzicoPayment(request);
      } else {
        throw new Error('Invalid payment provider configured');
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Payment processing failed',
      };
    }
  }

  private async processStripePayment(request: PaymentRequest): Promise<PaymentResponse> {
    if (!this.stripe) {
      throw new Error('Stripe not initialized');
    }

    try {
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: Math.round(request.amount * 100), // Convert to cents
        currency: request.currency.toLowerCase(),
        description: request.description,
        receipt_email: request.customerEmail,
        payment_method: request.paymentMethodId,
        confirm: true,
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'never',
        },
      });

      return {
        success: paymentIntent.status === 'succeeded',
        transactionId: paymentIntent.id,
        rawResponse: paymentIntent,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        rawResponse: error,
      };
    }
  }

  private async processIyzicoPayment(request: PaymentRequest): Promise<PaymentResponse> {
    if (!this.iyzipay) {
      throw new Error('iyzico not initialized');
    }

    if (!request.cardDetails) {
      throw new Error('Card details required for iyzico payment');
    }

    return new Promise((resolve) => {
      const paymentRequest = {
        locale: Iyzipay.LOCALE.TR,
        conversationId: `order_${Date.now()}`,
        price: request.amount.toFixed(2),
        paidPrice: request.amount.toFixed(2),
        currency: Iyzipay.CURRENCY.TRY,
        installment: '1',
        basketId: `basket_${Date.now()}`,
        paymentChannel: Iyzipay.PAYMENT_CHANNEL.WEB,
        paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
        paymentCard: {
          cardHolderName: request.cardDetails.cardHolderName,
          cardNumber: request.cardDetails.cardNumber.replace(/\s/g, ''),
          expireMonth: request.cardDetails.expireMonth,
          expireYear: request.cardDetails.expireYear,
          cvc: request.cardDetails.cvc,
          registerCard: '0',
        },
        buyer: {
          id: 'BY' + Date.now(),
          name: request.customerName.split(' ')[0] || 'Ad',
          surname: request.customerName.split(' ')[1] || 'Soyad',
          gsmNumber: '+905350000000',
          email: request.customerEmail,
          identityNumber: '11111111111',
          registrationAddress: 'Adres',
          ip: '85.34.78.112',
          city: 'Istanbul',
          country: 'Turkey',
        },
        shippingAddress: {
          contactName: request.customerName,
          city: 'Istanbul',
          country: 'Turkey',
          address: 'Adres',
        },
        billingAddress: {
          contactName: request.customerName,
          city: 'Istanbul',
          country: 'Turkey',
          address: 'Adres',
        },
        basketItems: [
          {
            id: 'BI' + Date.now(),
            name: request.description,
            category1: 'Product',
            itemType: Iyzipay.BASKET_ITEM_TYPE.PHYSICAL,
            price: request.amount.toFixed(2),
          },
        ],
      };

      this.iyzipay.payment.create(paymentRequest, (err: any, result: any) => {
        if (err) {
          resolve({
            success: false,
            error: err.message || 'iyzico payment failed',
            rawResponse: err,
          });
        } else if (result.status === 'success') {
          resolve({
            success: true,
            transactionId: result.paymentId,
            rawResponse: result,
          });
        } else {
          resolve({
            success: false,
            error: result.errorMessage || 'Payment failed',
            rawResponse: result,
          });
        }
      });
    });
  }

  async refundPayment(transactionId: string, amount?: number): Promise<PaymentResponse> {
    try {
      if (this.config.provider === 'stripe' && this.stripe) {
        const refund = await this.stripe.refunds.create({
          payment_intent: transactionId,
          amount: amount ? Math.round(amount * 100) : undefined,
        });

        return {
          success: refund.status === 'succeeded',
          transactionId: refund.id,
          rawResponse: refund,
        };
      } else if (this.config.provider === 'iyzico' && this.iyzipay) {
        // iyzico refund implementation
        return {
          success: false,
          error: 'iyzico refund not implemented yet',
        };
      } else {
        throw new Error('Payment provider not configured');
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
