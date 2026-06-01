import fs from 'fs';
import sharp from 'sharp';
import prisma from '../../config/database';
import { mediaLocalPath, mediaPublicUrl } from './media.upload';

export class MediaError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'MediaError';
  }
}

export type MediaAssetDto = {
  id: string;
  tenantId: string;
  url: string;
  secureUrl: string | null;
  publicId: string | null;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  type: string;
  createdAt: Date;
  updatedAt: Date;
};

function serializeAsset(asset: {
  id: string;
  tenantId: string;
  url: string;
  secureUrl: string | null;
  publicId: string | null;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  type: string;
  createdAt: Date;
  updatedAt: Date;
}): MediaAssetDto {
  return {
    id: asset.id,
    tenantId: asset.tenantId,
    url: asset.url,
    secureUrl: asset.secureUrl,
    publicId: asset.publicId,
    fileName: asset.fileName,
    originalName: asset.originalName,
    mimeType: asset.mimeType,
    size: asset.size,
    width: asset.width,
    height: asset.height,
    type: asset.type,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

async function readImageDimensions(
  filePath: string,
  mimeType: string,
): Promise<{ width: number | null; height: number | null }> {
  if (mimeType === 'image/svg+xml') return { width: null, height: null };
  try {
    const meta = await sharp(filePath).metadata();
    return {
      width: typeof meta.width === 'number' ? meta.width : null,
      height: typeof meta.height === 'number' ? meta.height : null,
    };
  } catch {
    return { width: null, height: null };
  }
}

export const mediaService = {
  async list(tenantId: string, limit = 200): Promise<{ assets: MediaAssetDto[]; total: number }> {
    const take = Math.min(Math.max(limit, 1), 500);
    const [rows, total] = await Promise.all([
      prisma.mediaAsset.findMany({
        where: { tenantId, type: 'IMAGE' },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      prisma.mediaAsset.count({ where: { tenantId, type: 'IMAGE' } }),
    ]);
    return { assets: rows.map(serializeAsset), total };
  },

  async createFromUpload(
    tenantId: string,
    file: Express.Multer.File,
  ): Promise<MediaAssetDto> {
    const filePath = mediaLocalPath(tenantId, file.filename);
    const { width, height } = await readImageDimensions(filePath, file.mimetype);
    const url = mediaPublicUrl(tenantId, file.filename);

    const asset = await prisma.mediaAsset.create({
      data: {
        tenantId,
        url,
        secureUrl: url,
        fileName: file.filename,
        originalName: file.originalname || file.filename,
        mimeType: file.mimetype || 'application/octet-stream',
        size: file.size,
        width,
        height,
        type: 'IMAGE',
      },
    });

    return serializeAsset(asset);
  },

  async delete(tenantId: string, id: string): Promise<void> {
    const asset = await prisma.mediaAsset.findFirst({
      where: { id, tenantId },
    });
    if (!asset) {
      throw new MediaError('Dosya bulunamadı.', 404);
    }

    const localPath = mediaLocalPath(tenantId, asset.fileName);
    if (fs.existsSync(localPath)) {
      try {
        fs.unlinkSync(localPath);
      } catch {
        // DB kaydını yine de sil; dosya zaten kaldırılmış olabilir
      }
    }

    await prisma.mediaAsset.delete({ where: { id: asset.id } });
  },
};
