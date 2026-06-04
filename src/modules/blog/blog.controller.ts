import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import prisma from '../../config/database';
import { AppError } from '../../common/middleware/AppError';

const authorSelect = {
  id: true,
  firstName: true,
  lastName: true,
} as const;

function tenantIdFromReq(req: AuthRequest): string {
  const id = req.user?.tenantId;
  if (!id) throw new AppError('Tenant information missing', 403);
  return id;
}

function authorIdFromReq(req: AuthRequest): string {
  const id = req.user?.userId ?? req.user?.id;
  if (!id) throw new AppError('Authentication required', 401);
  return id;
}

function normalizeTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map(t => String(t).trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw.split(',').map(t => t.trim()).filter(Boolean);
  }
  return [];
}

function parsePublishedAt(raw: unknown): Date | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

export class BlogController {
  getAll = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { published } = req.query;
      const tenantId = tenantIdFromReq(req);

      const posts = await prisma.post.findMany({
        where: {
          tenantId,
          ...(published === 'true' ? { isPublished: true } : {}),
        },
        include: { author: { select: authorSelect } },
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      });

      res.status(200).json({ status: 'success', data: posts });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to fetch posts' });
    }
  };

  getById = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = String(req.params.id ?? '');
      const tenantId = tenantIdFromReq(req);

      const post = await prisma.post.findFirst({
        where: { id, tenantId },
        include: { author: { select: authorSelect } },
      });

      if (!post) throw new AppError('Post not found', 404);

      res.status(200).json({ status: 'success', data: post });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to fetch post' });
      }
    }
  };

  /** Panel önizleme — taslak dahil. */
  getBySlug = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const slug = String(req.params.slug ?? '').trim();
      const tenantId = tenantIdFromReq(req);

      const post = await prisma.post.findFirst({
        where: { slug, tenantId },
        include: { author: { select: authorSelect } },
      });

      if (!post) throw new AppError('Post not found', 404);

      res.status(200).json({ status: 'success', data: post });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to fetch post' });
      }
    }
  };

  create = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = tenantIdFromReq(req);
      const authorId = authorIdFromReq(req);
      const {
        title,
        content,
        slug,
        excerpt,
        coverImage,
        category,
        tags,
        metaTitle,
        metaDescription,
        isPublished,
        publishedAt: publishedAtRaw,
      } = req.body ?? {};

      if (!title?.trim() || !content?.trim() || !slug?.trim()) {
        throw new AppError('Title, content, and slug are required', 400);
      }

      const publish = Boolean(isPublished);
      const publishedAtParsed = parsePublishedAt(publishedAtRaw);
      const publishedAt = publish
        ? (publishedAtParsed ?? new Date())
        : null;

      const post = await prisma.post.create({
        data: {
          title: String(title).trim(),
          content: String(content),
          slug: String(slug).trim(),
          excerpt: excerpt?.trim() || null,
          coverImage: coverImage?.trim() || null,
          category: category?.trim() || null,
          tags: normalizeTags(tags),
          metaTitle: metaTitle?.trim() || null,
          metaDescription: metaDescription?.trim() || null,
          isPublished: publish,
          publishedAt,
          tenantId,
          authorId,
        },
        include: { author: { select: authorSelect } },
      });

      res.status(201).json({ status: 'success', data: post });
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
        res.status(400).json({ error: 'Bu slug zaten kullanılıyor' });
        return;
      }
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to create post' });
      }
    }
  };

  update = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = String(req.params.id ?? '');
      const tenantId = tenantIdFromReq(req);
      const {
        title,
        content,
        slug,
        excerpt,
        coverImage,
        category,
        tags,
        metaTitle,
        metaDescription,
        isPublished,
        publishedAt: publishedAtRaw,
      } = req.body ?? {};

      const existingPost = await prisma.post.findFirst({ where: { id, tenantId } });
      if (!existingPost) throw new AppError('Post not found', 404);

      const publish = isPublished !== undefined ? Boolean(isPublished) : existingPost.isPublished;
      let publishedAt = existingPost.publishedAt;
      if (publishedAtRaw !== undefined) {
        publishedAt = parsePublishedAt(publishedAtRaw) ?? null;
      } else if (publish && !existingPost.isPublished) {
        publishedAt = new Date();
      } else if (!publish) {
        publishedAt = null;
      }

      const post = await prisma.post.update({
        where: { id },
        data: {
          ...(title !== undefined ? { title: String(title).trim() } : {}),
          ...(content !== undefined ? { content: String(content) } : {}),
          ...(slug !== undefined ? { slug: String(slug).trim() } : {}),
          ...(excerpt !== undefined ? { excerpt: excerpt?.trim() || null } : {}),
          ...(coverImage !== undefined ? { coverImage: coverImage?.trim() || null } : {}),
          ...(category !== undefined ? { category: category?.trim() || null } : {}),
          ...(tags !== undefined ? { tags: normalizeTags(tags) } : {}),
          ...(metaTitle !== undefined ? { metaTitle: metaTitle?.trim() || null } : {}),
          ...(metaDescription !== undefined ? { metaDescription: metaDescription?.trim() || null } : {}),
          ...(isPublished !== undefined ? { isPublished: publish } : {}),
          publishedAt,
        },
        include: { author: { select: authorSelect } },
      });

      res.status(200).json({ status: 'success', data: post });
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
        res.status(400).json({ error: 'Bu slug zaten kullanılıyor' });
        return;
      }
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to update post' });
      }
    }
  };

  delete = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = String(req.params.id ?? '');
      const tenantId = tenantIdFromReq(req);

      const existingPost = await prisma.post.findFirst({ where: { id, tenantId } });
      if (!existingPost) throw new AppError('Post not found', 404);

      await prisma.post.delete({ where: { id } });

      res.status(200).json({ status: 'success', message: 'Post deleted successfully' });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to delete post' });
      }
    }
  };
}
