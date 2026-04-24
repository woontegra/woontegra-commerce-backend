import { logger } from './logger';

export interface CDNConfig {
  enabled: boolean;
  baseUrl: string;
  uploadPath: string;
}

/**
 * CDN Configuration
 */
export const cdnConfig: CDNConfig = {
  enabled: process.env.CDN_ENABLED === 'true',
  baseUrl: process.env.CDN_BASE_URL || '',
  uploadPath: process.env.CDN_UPLOAD_PATH || '/uploads',
};

/**
 * Get asset URL (CDN or local)
 */
export function getAssetUrl(path: string): string {
  // Remove leading slash if present
  const cleanPath = path.startsWith('/') ? path.substring(1) : path;

  if (cdnConfig.enabled && cdnConfig.baseUrl) {
    // CDN URL
    return `${cdnConfig.baseUrl}/${cleanPath}`;
  }

  // Local URL
  return `/${cleanPath}`;
}

/**
 * Get upload URL (CDN or local)
 */
export function getUploadUrl(filename: string, category: string = 'general'): string {
  const path = `uploads/${category}/${filename}`;
  return getAssetUrl(path);
}

/**
 * Get multiple upload URLs
 */
export function getUploadUrls(filenames: string[], category: string = 'general'): string[] {
  return filenames.map(filename => getUploadUrl(filename, category));
}

/**
 * Check if CDN is enabled
 */
export function isCDNEnabled(): boolean {
  return cdnConfig.enabled;
}

/**
 * Log CDN configuration
 */
export function logCDNConfig(): void {
  logger.info('[CDN] Configuration', {
    enabled: cdnConfig.enabled,
    baseUrl: cdnConfig.baseUrl || 'Not configured',
    uploadPath: cdnConfig.uploadPath,
  });
}

// Log configuration on startup
logCDNConfig();
