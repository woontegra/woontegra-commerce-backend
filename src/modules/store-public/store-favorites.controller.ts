import { Response } from 'express';
import { z } from 'zod';
import { storeFavoritesService } from './store-favorites.service';
import type { StoreCustomerAuthRequest } from './store-customer-auth.middleware';

const addFavoriteSchema = z.object({
  productId: z.union([z.string().min(1), z.number()]).transform(v => String(v)),
});

export async function listFavorites(req: StoreCustomerAuthRequest, res: Response): Promise<void> {
  try {
    if (!req.storeCustomer || !req.storeTenant) {
      res.status(401).json({ success: false, error: 'Giriş yapmanız gerekiyor.' });
      return;
    }
    const favorites = await storeFavoritesService.list(
      req.storeTenant.id,
      req.storeCustomer.customerId,
    );
    res.json({ success: true, favorites });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Favoriler alınamadı.' });
  }
}

export async function addFavorite(req: StoreCustomerAuthRequest, res: Response): Promise<void> {
  try {
    if (!req.storeCustomer || !req.storeTenant) {
      res.status(401).json({ success: false, error: 'Giriş yapmanız gerekiyor.' });
      return;
    }
    const parsed = addFavoriteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues.map(i => i.message).join('; ') });
      return;
    }
    const item = await storeFavoritesService.add(
      req.storeTenant.id,
      req.storeCustomer.customerId,
      parsed.data.productId,
    );
    res.status(item.alreadyExists ? 200 : 201).json({ success: true, favorite: item });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Favori eklenemedi.';
    res.status(/bulunamadı|eklenemez/i.test(msg) ? 400 : 500).json({ success: false, error: msg });
  }
}

export async function removeFavorite(req: StoreCustomerAuthRequest, res: Response): Promise<void> {
  try {
    if (!req.storeCustomer || !req.storeTenant) {
      res.status(401).json({ success: false, error: 'Giriş yapmanız gerekiyor.' });
      return;
    }
    const productId = typeof req.params.productId === 'string' ? req.params.productId.trim() : '';
    if (!productId) {
      res.status(400).json({ success: false, error: 'Ürün kimliği gerekli.' });
      return;
    }
    await storeFavoritesService.remove(
      req.storeTenant.id,
      req.storeCustomer.customerId,
      productId,
    );
    res.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Favori kaldırılamadı.';
    res.status(/bulunamadı/i.test(msg) ? 404 : 500).json({ success: false, error: msg });
  }
}
