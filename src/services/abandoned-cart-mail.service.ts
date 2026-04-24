import { mailService } from './mail.service';
import { abandonedCartService } from './abandoned-cart.service';
import { logger } from '../config/logger';

interface AbandonedCartMailData {
  customerName: string;
  items: Array<{
    name: string;
    variant?: string;
    price: string;
    quantity: number;
    image: string;
  }>;
  cartTotal: string;
  cartUrl: string;
  supportEmail: string;
  storeName: string;
  freeShippingThreshold: string;
  unsubscribeUrl: string;
}

export class AbandonedCartMailService {
  /**
   * Send abandoned cart email
   */
  async sendAbandonedCartEmail(cart: any): Promise<boolean> {
    try {
      if (!cart.customer?.email) {
        logger.warn('[AbandonedCartMail] No customer email', { cartId: cart.id });
        return false;
      }

      // Prepare cart items
      const items = cart.items.map((item: any) => {
        const product = item.product;
        const variant = item.variant;
        const price = variant?.price || product?.price || 0;
        const image = variant?.images?.[0] || product?.images?.[0] || '/placeholder.jpg';

        return {
          name: product?.name || 'Ürün',
          variant: variant?.name,
          price: price.toLocaleString('tr-TR'),
          quantity: item.quantity,
          image,
        };
      });

      // Calculate total
      const cartTotal = abandonedCartService.calculateCartTotal(cart);

      // Prepare email data
      const emailData: AbandonedCartMailData = {
        customerName: `${cart.customer.firstName} ${cart.customer.lastName}`,
        items,
        cartTotal: cartTotal.toLocaleString('tr-TR'),
        cartUrl: abandonedCartService.getCartRecoveryUrl(cart.id),
        supportEmail: cart.tenant.settings?.contactEmail || 'destek@woontegra.com',
        storeName: cart.tenant.name,
        freeShippingThreshold: '500',
        unsubscribeUrl: `${process.env.FRONTEND_URL}/unsubscribe`,
      };

      // Send email
      const sent = await mailService.sendMail({
        to: cart.customer.email,
        subject: '🛒 Sepetinizde Ürünler Bekliyor!',
        template: 'cart-abandoned',
        data: emailData,
      });

      if (sent) {
        // Mark cart as abandoned
        await abandonedCartService.markAsAbandoned(cart.id);

        logger.info('[AbandonedCartMail] Email sent successfully', {
          cartId: cart.id,
          customerEmail: cart.customer.email,
        });
      }

      return sent;
    } catch (error) {
      logger.error('[AbandonedCartMail] Failed to send email', {
        cartId: cart.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Process all abandoned carts and send emails
   */
  async processAbandonedCarts(): Promise<void> {
    try {
      logger.info('[AbandonedCartMail] Starting abandoned cart processing');

      const abandonedCarts = await abandonedCartService.findAbandonedCarts();

      if (abandonedCarts.length === 0) {
        logger.info('[AbandonedCartMail] No abandoned carts found');
        return;
      }

      let successCount = 0;
      let failCount = 0;

      for (const cart of abandonedCarts) {
        const sent = await this.sendAbandonedCartEmail(cart);
        if (sent) {
          successCount++;
        } else {
          failCount++;
        }

        // Add delay between emails to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      logger.info('[AbandonedCartMail] Abandoned cart processing completed', {
        total: abandonedCarts.length,
        success: successCount,
        failed: failCount,
      });
    } catch (error) {
      logger.error('[AbandonedCartMail] Error processing abandoned carts', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

export const abandonedCartMailService = new AbandonedCartMailService();
