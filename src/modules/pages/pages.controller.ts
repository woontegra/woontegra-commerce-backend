import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import prisma from '../../config/database';
import { AppError } from '../../common/middleware/AppError';

function tenantIdFromReq(req: AuthRequest): string {
  const id = req.user?.tenantId;
  if (!id) throw new AppError('Tenant information missing', 403);
  return id;
}

function parsePublishedAt(raw: unknown): Date | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeStatus(raw: unknown, existing?: string): string {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (s === 'published' || s === 'draft') return s;
  return existing ?? 'draft';
}

function applyPublishState(status: string, publishedAtRaw: unknown, existingPublishedAt: Date | null) {
  const published = status === 'published';
  let publishedAt = existingPublishedAt;
  if (publishedAtRaw !== undefined) {
    publishedAt = parsePublishedAt(publishedAtRaw) ?? null;
  } else if (published && !existingPublishedAt) {
    publishedAt = new Date();
  } else if (!published) {
    publishedAt = null;
  }
  return { isPublished: published, publishedAt };
}

export class PagesController {
  getAll = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = tenantIdFromReq(req);
      let pages;
      try {
        pages = await prisma.page.findMany({
          where: { tenantId },
          orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
        });
      } catch {
        pages = await prisma.page.findMany({
          where: { tenantId },
          orderBy: { updatedAt: 'desc' },
        });
      }
      res.status(200).json({ status: 'success', data: pages });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : 'Failed to fetch pages';
      res.status(500).json({ error: message });
    }
  };

  getById = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = String(req.params.id ?? '');
      const tenantId = tenantIdFromReq(req);
      const page = await prisma.page.findFirst({ where: { id, tenantId } });
      if (!page) throw new AppError('Page not found', 404);
      res.status(200).json({ status: 'success', data: page });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to fetch page' });
      }
    }
  };

  create = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = tenantIdFromReq(req);
      const body = req.body ?? {};
      const { title, slug, content, excerpt, coverImageUrl, metaTitle, metaDescription, showInHeader, showInFooter, sortOrder, publishedAt: publishedAtRaw } = body;

      if (!title?.trim() || !slug?.trim()) {
        throw new AppError('Title and slug are required', 400);
      }

      const status = normalizeStatus(body.status);
      const { isPublished, publishedAt } = applyPublishState(status, publishedAtRaw, null);

      const page = await prisma.page.create({
        data: {
          title: String(title).trim(),
          slug: String(slug).trim(),
          content: content != null ? String(content) : '',
          excerpt: excerpt?.trim() || null,
          coverImageUrl: coverImageUrl?.trim() || null,
          status,
          metaTitle: metaTitle?.trim() || null,
          metaDescription: metaDescription?.trim() || null,
          showInHeader: Boolean(showInHeader),
          showInFooter: Boolean(showInFooter),
          sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
          isPublished,
          publishedAt,
          tenantId,
        },
      });

      res.status(201).json({ status: 'success', data: page });
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
        res.status(400).json({ error: 'Bu slug zaten kullanılıyor' });
        return;
      }
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to create page' });
      }
    }
  };

  update = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = String(req.params.id ?? '');
      const tenantId = tenantIdFromReq(req);
      const body = req.body ?? {};

      const existing = await prisma.page.findFirst({ where: { id, tenantId } });
      if (!existing) throw new AppError('Page not found', 404);

      const status = body.status !== undefined ? normalizeStatus(body.status) : existing.status;
      const { isPublished, publishedAt } = applyPublishState(
        status,
        body.publishedAt,
        existing.publishedAt,
      );

      const page = await prisma.page.update({
        where: { id },
        data: {
          ...(body.title !== undefined ? { title: String(body.title).trim() } : {}),
          ...(body.slug !== undefined ? { slug: String(body.slug).trim() } : {}),
          ...(body.content !== undefined ? { content: String(body.content) } : {}),
          ...(body.excerpt !== undefined ? { excerpt: body.excerpt?.trim() || null } : {}),
          ...(body.coverImageUrl !== undefined ? { coverImageUrl: body.coverImageUrl?.trim() || null } : {}),
          ...(body.status !== undefined ? { status } : {}),
          ...(body.metaTitle !== undefined ? { metaTitle: body.metaTitle?.trim() || null } : {}),
          ...(body.metaDescription !== undefined ? { metaDescription: body.metaDescription?.trim() || null } : {}),
          ...(body.showInHeader !== undefined ? { showInHeader: Boolean(body.showInHeader) } : {}),
          ...(body.showInFooter !== undefined ? { showInFooter: Boolean(body.showInFooter) } : {}),
          ...(body.sortOrder !== undefined
            ? { sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0 }
            : {}),
          isPublished,
          publishedAt,
        },
      });

      res.status(200).json({ status: 'success', data: page });
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
        res.status(400).json({ error: 'Bu slug zaten kullanılıyor' });
        return;
      }
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to update page' });
      }
    }
  };

  delete = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = String(req.params.id ?? '');
      const tenantId = tenantIdFromReq(req);
      const existing = await prisma.page.findFirst({ where: { id, tenantId } });
      if (!existing) throw new AppError('Page not found', 404);
      await prisma.page.delete({ where: { id } });
      res.status(200).json({ status: 'success', message: 'Page deleted successfully' });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to delete page' });
      }
    }
  };
}
