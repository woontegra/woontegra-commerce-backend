import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface TranslationData {
  language: string;
  name: string;
  description?: string;
  slug?: string;
  metaTitle?: string;
  metaDescription?: string;
  metaKeywords?: string;
}

export class TranslationService {
  /**
   * Get product with translations
   */
  static async getProductWithTranslations(productId: string, language?: string) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        translations: language 
          ? { where: { language } }
          : true,
      },
    });

    return product;
  }

  /**
   * Get translated product (returns translation if exists, fallback to default)
   */
  static async getTranslatedProduct(productId: string, language: string = 'tr') {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        translations: {
          where: { language },
        },
      },
    });

    if (!product) return null;

    // If translation exists, merge it with product
    if (product.translations && product.translations.length > 0) {
      const translation = product.translations[0];
      return {
        ...product,
        name: translation.name || product.name,
        description: translation.description || product.description,
        slug: translation.slug || product.slug,
      };
    }

    return product;
  }

  /**
   * Create or update product translation
   */
  static async upsertProductTranslation(
    productId: string,
    data: TranslationData
  ) {
    return await prisma.productTranslation.upsert({
      where: {
        productId_language: {
          productId,
          language: data.language,
        },
      },
      create: {
        productId,
        ...data,
      },
      update: {
        ...data,
      },
    });
  }

  /**
   * Delete product translation
   */
  static async deleteProductTranslation(productId: string, language: string) {
    return await prisma.productTranslation.delete({
      where: {
        productId_language: {
          productId,
          language,
        },
      },
    });
  }

  /**
   * Get all translations for a product
   */
  static async getProductTranslations(productId: string) {
    return await prisma.productTranslation.findMany({
      where: { productId },
      orderBy: { language: 'asc' },
    });
  }

  /**
   * Get products with specific language
   */
  static async getProductsByLanguage(
    tenantId: string,
    language: string = 'tr',
    filters?: any
  ) {
    const products = await prisma.product.findMany({
      where: {
        tenantId,
        ...filters,
      },
      include: {
        translations: {
          where: { language },
        },
      },
    });

    // Merge translations
    return products.map(product => {
      if (product.translations && product.translations.length > 0) {
        const translation = product.translations[0];
        return {
          ...product,
          name: translation.name || product.name,
          description: translation.description || product.description,
          slug: translation.slug || product.slug,
        };
      }
      return product;
    });
  }

  /**
   * Supported languages
   */
  static readonly SUPPORTED_LANGUAGES = [
    { code: 'tr', name: 'Türkçe', flag: '🇹🇷' },
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' },
    { code: 'ar', name: 'العربية', flag: '🇸🇦' },
    { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  ];

  static readonly DEFAULT_LANGUAGE = 'tr';
}

export const translationService = TranslationService;
