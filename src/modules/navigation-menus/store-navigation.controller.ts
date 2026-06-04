import { Request, Response } from 'express';
import { resolveStoreTenant } from '../store-public/store-tenant.util';
import { getPublicNavigationMenus } from './navigation-menu.controller';

export async function getStoreNavigationMenus(req: Request, res: Response): Promise<void> {
  try {
    const tenant = await resolveStoreTenant(req);
    if (!tenant) {
      res.status(404).json({ status: 'error', error: 'Mağaza bulunamadı.' });
      return;
    }

    const data = await getPublicNavigationMenus(
      tenant.id,
      tenant.slug,
      tenant.customDomain,
      tenant.domainVerified,
    );

    res.json({ status: 'success', data });
  } catch {
    res.status(500).json({ status: 'error', error: 'Menüler yüklenemedi.' });
  }
}
