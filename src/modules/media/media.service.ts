import fs from 'fs';
import sharp from 'sharp';
import prisma from '../../config/database';
import {
  DEFAULT_MEDIA_FOLDER,
  normalizeMediaFolder,
  normalizeMediaSort,
  type MediaFolderSlug,
  type MediaSortField,
} from './media.constants';
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
  folder: string;
  createdAt: Date;
  updatedAt: Date;
};

export type MediaListOptions = {
  limit?: number;
  folder?: string | null;
  search?: string;
  sort?: string;
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
  folder: string;
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
    folder: asset.folder || DEFAULT_MEDIA_FOLDER,
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

function buildOrderBy(sort: MediaSortField) {
  switch (sort) {
    case 'oldest':
      return { createdAt: 'asc' as const };
    case 'name':
      return { originalName: 'asc' as const };
    case 'size':
      return { size: 'desc' as const };
    default:
      return { createdAt: 'desc' as const };
  }
}

export const mediaService = {
  async list(
    tenantId: string,
    options: MediaListOptions = {},
  ): Promise<{ assets: MediaAssetDto[]; total: number }> {
    const take = Math.min(Math.max(options.limit ?? 200, 1), 500);
    const sort = normalizeMediaSort(options.sort);
    const search = typeof options.search === 'string' ? options.search.trim() : '';
    const folderRaw = typeof options.folder === 'string' ? options.folder.trim().toLowerCase() : '';

    const where: {
      tenantId: string;
      type: 'IMAGE';
      folder?: string;
      OR?: Array<{ originalName: { contains: string; mode: 'insensitive' } } | { fileName: { contains: string; mode: 'insensitive' } }>;
    } = { tenantId, type: 'IMAGE' };

    if (folderRaw && folderRaw !== 'all') {
      where.folder = normalizeMediaFolder(folderRaw);
    }

    if (search) {
      where.OR = [
        { originalName: { contains: search, mode: 'insensitive' } },
        { fileName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.mediaAsset.findMany({
        where,
        orderBy: buildOrderBy(sort),
        take,
      }),
      prisma.mediaAsset.count({ where }),
    ]);
    return { assets: rows.map(serializeAsset), total };
  },

  async createFromUpload(
    tenantId: string,
    file: Express.Multer.File,
    folderInput?: string,
  ): Promise<MediaAssetDto> {
    const folder: MediaFolderSlug = normalizeMediaFolder(folderInput);
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
        folder,
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
