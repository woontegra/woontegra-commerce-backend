import { Response } from 'express';
import { NavigationMenuType } from '@prisma/client';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import prisma from '../../config/database';
import { AppError } from '../../common/middleware/AppError';
import {
  normalizeLinkType,
  normalizeMenuType,
  resolveMenuItemPath,
} from './navigation-menu.resolve';

function tenantIdFromReq(req: AuthRequest): string {
  const id = req.user?.tenantId;
  if (!id) throw new AppError('Tenant information missing', 403);
  return id;
}

type MenuItemInput = {
  id?: string;
  label?: string;
  linkType?: string;
  targetId?: string | null;
  url?: string | null;
  parentId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  openInNewTab?: boolean;
};

async function getOrCreateMenu(tenantId: string, type: NavigationMenuType) {
  const existing = await prisma.tenantNavigationMenu.findUnique({
    where: { tenantId_type: { tenantId, type } },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });
  if (existing) return existing;
  return prisma.tenantNavigationMenu.create({
    data: {
      tenantId,
      type,
      title: type === 'HEADER' ? 'Üst menü' : 'Footer menü',
    },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });
}

export class NavigationMenuController {
  getMenus = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = tenantIdFromReq(req);
      const header = await getOrCreateMenu(tenantId, 'HEADER');
      const footer = await getOrCreateMenu(tenantId, 'FOOTER');
      res.status(200).json({ status: 'success', data: { header, footer } });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Menüler yüklenemedi.' });
    }
  };

  getOptions = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = tenantIdFromReq(req);
      const productQ =
        typeof req.query.productQ === 'string' ? req.query.productQ.trim() : '';
      const [pages, posts, categories, products] = await Promise.all([
        prisma.page.findMany({
          where: { tenantId, status: 'published', isPublished: true },
          orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
          select: { id: true, title: true, slug: true, status: true, isPublished: true },
        }),
        prisma.post.findMany({
          where: { tenantId, isPublished: true },
          orderBy: { title: 'asc' },
          select: { id: true, title: true, slug: true, isPublished: true },
        }),
        prisma.category.findMany({
          where: { tenantId, isActive: true },
          orderBy: [{ order: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true, slug: true, path: true },
        }),
        prisma.product.findMany({
          where: {
            tenantId,
            isActive: true,
            status: 'active',
            ...(productQ
              ? {
                  OR: [
                    { name: { contains: productQ, mode: 'insensitive' } },
                    { slug: { contains: productQ, mode: 'insensitive' } },
                    { sku: { contains: productQ, mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
          orderBy: { name: 'asc' },
          take: productQ ? 80 : 500,
          select: { id: true, name: true, slug: true, status: true, sku: true },
        }),
      ]);
      res.status(200).json({
        status: 'success',
        data: { pages, posts, categories, products },
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Menü seçenekleri yüklenemedi.' });
    }
  };

  saveMenu = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = tenantIdFromReq(req);
      const type = normalizeMenuType(req.params.type ?? req.body?.type);
      if (!type) throw new AppError('Geçersiz menü tipi (HEADER veya FOOTER)', 400);

      const body = req.body ?? {};
      const title =
        typeof body.title === 'string' && body.title.trim()
          ? body.title.trim()
          : type === 'HEADER'
            ? 'Üst menü'
            : 'Footer menü';
      const items: MenuItemInput[] = Array.isArray(body.items) ? body.items : [];

      for (const item of items) {
        if (!item.label?.trim()) throw new AppError('Her menü öğesinde etiket zorunludur.', 400);
        const lt = normalizeLinkType(item.linkType);
        if (!lt) throw new AppError('Geçersiz bağlantı tipi.', 400);
        if (lt === 'custom' && !item.url?.trim()) {
          throw new AppError('Özel bağlantı için URL zorunludur.', 400);
        }
        if (lt !== 'custom' && !item.targetId?.trim()) {
          throw new AppError('Seçili içerik zorunludur.', 400);
        }
      }

      const menu = await prisma.$transaction(async tx => {
        const record = await tx.tenantNavigationMenu.upsert({
          where: { tenantId_type: { tenantId, type } },
          create: { tenantId, type, title },
          update: { title },
        });

        await tx.tenantNavigationMenuItem.deleteMany({ where: { menuId: record.id } });

        if (items.length > 0) {
          const clientKey = (item: MenuItemInput, index: number) => {
            const id = typeof item.id === 'string' ? item.id.trim() : '';
            return id || `__idx_${index}`;
          };

          const keyToDbId = new Map<string, string>();
          const createdIds: string[] = [];

          for (let index = 0; index < items.length; index++) {
            const item = items[index];
            const row = await tx.tenantNavigationMenuItem.create({
              data: {
                menuId: record.id,
                tenantId,
                label: String(item.label).trim(),
                linkType: normalizeLinkType(item.linkType)!,
                targetId: item.targetId?.trim() || null,
                url: item.url?.trim() || null,
                parentId: null,
                sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
                isActive: item.isActive !== false,
                openInNewTab: Boolean(item.openInNewTab),
              },
            });
            createdIds.push(row.id);
            keyToDbId.set(clientKey(item, index), row.id);
          }

          for (let index = 0; index < items.length; index++) {
            const parentKey = items[index].parentId?.trim();
            if (!parentKey) continue;
            const dbParentId = keyToDbId.get(parentKey);
            const dbChildId = createdIds[index];
            if (!dbParentId || dbParentId === dbChildId) continue;
            await tx.tenantNavigationMenuItem.update({
              where: { id: dbChildId },
              data: { parentId: dbParentId },
            });
          }
        }

        return tx.tenantNavigationMenu.findUnique({
          where: { id: record.id },
          include: { items: { orderBy: { sortOrder: 'asc' } } },
        });
      });

      res.status(200).json({ status: 'success', data: menu });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Menü kaydedilemedi.' });
    }
  };
}

export async function getPublicNavigationMenus(
  tenantId: string,
  tenantSlug: string,
  customDomain: string | null,
  domainVerified: boolean,
) {
  const menus = await prisma.tenantNavigationMenu.findMany({
    where: { tenantId },
    include: {
      items: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  const mapMenu = async (type: NavigationMenuType) => {
    const menu = menus.find(m => m.type === type);
    if (!menu || menu.items.length === 0) return [];
    const resolved = await Promise.all(
      menu.items.map(async item => {
        const href = await resolveMenuItemPath(tenantId, tenantSlug, customDomain, domainVerified, item);
        if (!href) return null;
        return {
          id: item.id,
          label: item.label,
          href,
          openInNewTab: item.openInNewTab,
          parentId: item.parentId,
          linkType: item.linkType,
        };
      }),
    );
    return resolved.filter(Boolean);
  };

  const [header, footer] = await Promise.all([mapMenu('HEADER'), mapMenu('FOOTER')]);
  return { header, footer };
}
