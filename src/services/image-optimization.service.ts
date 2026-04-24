import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { logger } from '../config/logger';

export interface ImageSizes {
  thumbnail: { width: number; height: number };
  medium: { width: number; height: number };
  large: { width: number; height: number };
  original?: { width: number; height: number };
}

export const DEFAULT_IMAGE_SIZES: ImageSizes = {
  thumbnail: { width: 150, height: 150 },
  medium: { width: 500, height: 500 },
  large: { width: 1200, height: 1200 },
};

export interface OptimizedImage {
  original: string;
  thumbnail: string;
  medium: string;
  large: string;
  webp: {
    original: string;
    thumbnail: string;
    medium: string;
    large: string;
  };
}

export class ImageOptimizationService {
  /**
   * Optimize and resize image
   */
  static async optimizeImage(
    inputPath: string,
    outputDir: string,
    filename: string,
    sizes: ImageSizes = DEFAULT_IMAGE_SIZES
  ): Promise<OptimizedImage> {
    try {
      logger.info('[ImageOptimization] Processing image', { inputPath, filename });

      // Ensure output directory exists
      await fs.mkdir(outputDir, { recursive: true });

      const ext = path.extname(filename);
      const basename = path.basename(filename, ext);

      const result: OptimizedImage = {
        original: '',
        thumbnail: '',
        medium: '',
        large: '',
        webp: {
          original: '',
          thumbnail: '',
          medium: '',
          large: '',
        },
      };

      // Process original
      const originalPath = path.join(outputDir, `${basename}${ext}`);
      await sharp(inputPath)
        .jpeg({ quality: 90, progressive: true })
        .png({ quality: 90, compressionLevel: 9 })
        .toFile(originalPath);
      result.original = `${basename}${ext}`;

      // Process original WebP
      const originalWebpPath = path.join(outputDir, `${basename}.webp`);
      await sharp(inputPath)
        .webp({ quality: 90 })
        .toFile(originalWebpPath);
      result.webp.original = `${basename}.webp`;

      // Process thumbnail
      const thumbnailPath = path.join(outputDir, `${basename}-thumbnail${ext}`);
      await sharp(inputPath)
        .resize(sizes.thumbnail.width, sizes.thumbnail.height, {
          fit: 'cover',
          position: 'center',
        })
        .jpeg({ quality: 85, progressive: true })
        .png({ quality: 85, compressionLevel: 9 })
        .toFile(thumbnailPath);
      result.thumbnail = `${basename}-thumbnail${ext}`;

      // Process thumbnail WebP
      const thumbnailWebpPath = path.join(outputDir, `${basename}-thumbnail.webp`);
      await sharp(inputPath)
        .resize(sizes.thumbnail.width, sizes.thumbnail.height, {
          fit: 'cover',
          position: 'center',
        })
        .webp({ quality: 85 })
        .toFile(thumbnailWebpPath);
      result.webp.thumbnail = `${basename}-thumbnail.webp`;

      // Process medium
      const mediumPath = path.join(outputDir, `${basename}-medium${ext}`);
      await sharp(inputPath)
        .resize(sizes.medium.width, sizes.medium.height, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85, progressive: true })
        .png({ quality: 85, compressionLevel: 9 })
        .toFile(mediumPath);
      result.medium = `${basename}-medium${ext}`;

      // Process medium WebP
      const mediumWebpPath = path.join(outputDir, `${basename}-medium.webp`);
      await sharp(inputPath)
        .resize(sizes.medium.width, sizes.medium.height, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toFile(mediumWebpPath);
      result.webp.medium = `${basename}-medium.webp`;

      // Process large
      const largePath = path.join(outputDir, `${basename}-large${ext}`);
      await sharp(inputPath)
        .resize(sizes.large.width, sizes.large.height, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 90, progressive: true })
        .png({ quality: 90, compressionLevel: 9 })
        .toFile(largePath);
      result.large = `${basename}-large${ext}`;

      // Process large WebP
      const largeWebpPath = path.join(outputDir, `${basename}-large.webp`);
      await sharp(inputPath)
        .resize(sizes.large.width, sizes.large.height, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 90 })
        .toFile(largeWebpPath);
      result.webp.large = `${basename}-large.webp`;

      logger.info('[ImageOptimization] Image processed successfully', { 
        filename,
        variants: Object.keys(result).length + Object.keys(result.webp).length,
      });

      return result;
    } catch (error) {
      logger.error('[ImageOptimization] Error processing image', { error, inputPath });
      throw error;
    }
  }

  /**
   * Delete all variants of an image
   */
  static async deleteImageVariants(
    outputDir: string,
    filename: string
  ): Promise<void> {
    try {
      const ext = path.extname(filename);
      const basename = path.basename(filename, ext);

      const variants = [
        `${basename}${ext}`,
        `${basename}.webp`,
        `${basename}-thumbnail${ext}`,
        `${basename}-thumbnail.webp`,
        `${basename}-medium${ext}`,
        `${basename}-medium.webp`,
        `${basename}-large${ext}`,
        `${basename}-large.webp`,
      ];

      for (const variant of variants) {
        const filePath = path.join(outputDir, variant);
        try {
          await fs.unlink(filePath);
        } catch (error) {
          // Ignore if file doesn't exist
        }
      }

      logger.info('[ImageOptimization] Image variants deleted', { filename });
    } catch (error) {
      logger.error('[ImageOptimization] Error deleting image variants', { error, filename });
      throw error;
    }
  }

  /**
   * Get image metadata
   */
  static async getImageMetadata(imagePath: string): Promise<sharp.Metadata> {
    try {
      return await sharp(imagePath).metadata();
    } catch (error) {
      logger.error('[ImageOptimization] Error getting image metadata', { error, imagePath });
      throw error;
    }
  }

  /**
   * Validate image file
   */
  static async validateImage(imagePath: string): Promise<boolean> {
    try {
      const metadata = await this.getImageMetadata(imagePath);
      
      // Check if valid image format
      if (!metadata.format) {
        return false;
      }

      // Check supported formats
      const supportedFormats = ['jpeg', 'jpg', 'png', 'webp', 'gif', 'svg'];
      if (!supportedFormats.includes(metadata.format)) {
        return false;
      }

      // Check dimensions
      if (!metadata.width || !metadata.height) {
        return false;
      }

      // Check max dimensions (10000x10000)
      if (metadata.width > 10000 || metadata.height > 10000) {
        return false;
      }

      return true;
    } catch (error) {
      logger.error('[ImageOptimization] Error validating image', { error, imagePath });
      return false;
    }
  }
}

export const imageOptimizationService = ImageOptimizationService;
