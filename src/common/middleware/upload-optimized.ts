import multer from 'multer';
import path from 'path';
import { Request } from 'express';
import { ImageOptimizationService } from '../../services/image-optimization.service';
import { logger } from '../../config/logger';

// Temporary storage for uploaded files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(process.cwd(), 'uploads', 'temp'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

// File filter
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.'));
  }
};

// Multer upload configuration
export const uploadTemp = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

/**
 * Process uploaded image with optimization
 */
export async function processUploadedImage(
  file: Express.Multer.File,
  category: string = 'general'
): Promise<{
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
}> {
  try {
    // Validate image
    const isValid = await ImageOptimizationService.validateImage(file.path);
    if (!isValid) {
      throw new Error('Invalid image file');
    }

    // Output directory
    const outputDir = path.join(process.cwd(), 'uploads', category);

    // Optimize and create variants
    const result = await ImageOptimizationService.optimizeImage(
      file.path,
      outputDir,
      file.filename
    );

    // Delete temporary file
    const fs = require('fs/promises');
    await fs.unlink(file.path);

    logger.info('[UploadOptimized] Image processed', {
      original: file.filename,
      category,
      variants: Object.keys(result).length,
    });

    return result;
  } catch (error) {
    logger.error('[UploadOptimized] Error processing image', { error, file: file.filename });
    throw error;
  }
}

/**
 * Process multiple uploaded images
 */
export async function processUploadedImages(
  files: Express.Multer.File[],
  category: string = 'general'
): Promise<Array<{
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
}>> {
  const results = [];

  for (const file of files) {
    const result = await processUploadedImage(file, category);
    results.push(result);
  }

  return results;
}
