import { Request, Response } from 'express';
import { uploadTemp, processUploadedImage, processUploadedImages } from '../../common/middleware/upload-optimized';
import { getUploadUrl } from '../../config/cdn';

interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
  };
}

export class UploadOptimizedController {
  /**
   * Upload single image with optimization
   */
  async uploadSingle(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const category = req.body.category || 'general';
      const result = await processUploadedImage(req.file, category);

      res.json({
        success: true,
        data: {
          ...result,
          url: getUploadUrl(result.original, category),
          thumbnailUrl: getUploadUrl(result.thumbnail, category),
          mediumUrl: getUploadUrl(result.medium, category),
          largeUrl: getUploadUrl(result.large, category),
          webp: {
            url: getUploadUrl(result.webp.original, category),
            thumbnailUrl: getUploadUrl(result.webp.thumbnail, category),
            mediumUrl: getUploadUrl(result.webp.medium, category),
            largeUrl: getUploadUrl(result.webp.large, category),
          },
        },
      });
    } catch (error) {
      console.error('Error uploading image:', error);
      res.status(500).json({ error: 'Failed to upload image' });
    }
  }

  /**
   * Upload multiple images with optimization
   */
  async uploadMultiple(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        res.status(400).json({ error: 'No files uploaded' });
        return;
      }

      const category = req.body.category || 'general';
      const results = await processUploadedImages(req.files, category);

      const data = results.map(result => ({
        ...result,
        url: getUploadUrl(result.original, category),
        thumbnailUrl: getUploadUrl(result.thumbnail, category),
        mediumUrl: getUploadUrl(result.medium, category),
        largeUrl: getUploadUrl(result.large, category),
        webp: {
          url: getUploadUrl(result.webp.original, category),
          thumbnailUrl: getUploadUrl(result.webp.thumbnail, category),
          mediumUrl: getUploadUrl(result.webp.medium, category),
          largeUrl: getUploadUrl(result.webp.large, category),
        },
      }));

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error uploading images:', error);
      res.status(500).json({ error: 'Failed to upload images' });
    }
  }
}

export const uploadOptimizedController = new UploadOptimizedController();

// Middleware wrapper for single upload
export const uploadSingleMiddleware = uploadTemp.single('image');

// Middleware wrapper for multiple upload
export const uploadMultipleMiddleware = uploadTemp.array('images', 10);
