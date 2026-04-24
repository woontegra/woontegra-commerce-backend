import { Request, Response } from 'express';
import { TranslationService } from '../../services/translation.service';

interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
  };
}

export class TranslationController {
  /**
   * Get product translations
   */
  async getProductTranslations(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { productId } = req.params;

      const translations = await TranslationService.getProductTranslations(productId);

      res.json({ success: true, data: translations });
    } catch (error) {
      console.error('Error fetching translations:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Upsert product translation
   */
  async upsertTranslation(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { productId } = req.params;
      const { language, name, description, slug, metaTitle, metaDescription, metaKeywords } = req.body;

      if (!language || !name) {
        res.status(400).json({ error: 'language and name are required' });
        return;
      }

      const translation = await TranslationService.upsertProductTranslation(productId, {
        language,
        name,
        description,
        slug,
        metaTitle,
        metaDescription,
        metaKeywords,
      });

      res.json({ success: true, data: translation });
    } catch (error) {
      console.error('Error upserting translation:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Delete product translation
   */
  async deleteTranslation(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { productId, language } = req.params;

      await TranslationService.deleteProductTranslation(productId, language);

      res.json({ success: true, message: 'Translation deleted' });
    } catch (error) {
      console.error('Error deleting translation:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get supported languages
   */
  async getSupportedLanguages(req: Request, res: Response): Promise<void> {
    try {
      const languages = TranslationService.SUPPORTED_LANGUAGES;

      res.json({ success: true, data: languages });
    } catch (error) {
      console.error('Error fetching languages:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export const translationController = new TranslationController();
