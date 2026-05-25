import { Request, Response, NextFunction } from 'express';
import { verifyStoreCustomerToken, type StoreCustomerJwtPayload } from '../../common/utils/store-customer-jwt.util';
import { resolveStoreTenant } from './store-tenant.util';

export type StoreCustomerAuthRequest = Request & {
  storeCustomer?: StoreCustomerJwtPayload;
  storeTenant?: Awaited<ReturnType<typeof resolveStoreTenant>>;
};

function bearerToken(req: Request): string | null {
  const h = req.get('authorization');
  if (!h?.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

/** Opsiyonel müşteri oturumu (checkout vb.). */
export async function optionalStoreCustomer(
  req: StoreCustomerAuthRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const tenant = await resolveStoreTenant(req);
    req.storeTenant = tenant;
    const token = bearerToken(req);
    if (token && tenant) {
      const payload = verifyStoreCustomerToken(token);
      if (payload.tenantId === tenant.id) {
        req.storeCustomer = payload;
      }
    }
  } catch {
    /* ignore invalid token */
  }
  next();
}

/** Zorunlu müşteri oturumu + tenant eşleşmesi. */
export async function requireStoreCustomer(
  req: StoreCustomerAuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const tenant = await resolveStoreTenant(req);
    if (!tenant) {
      res.status(404).json({ success: false, error: 'Mağaza bulunamadı.' });
      return;
    }
    req.storeTenant = tenant;

    const token = bearerToken(req);
    if (!token) {
      res.status(401).json({ success: false, error: 'Giriş yapmanız gerekiyor.' });
      return;
    }

    const payload = verifyStoreCustomerToken(token);
    if (payload.tenantId !== tenant.id) {
      res.status(401).json({ success: false, error: 'Oturum bu mağaza için geçerli değil.' });
      return;
    }

    req.storeCustomer = payload;
    next();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Yetkilendirme hatası';
    res.status(401).json({ success: false, error: msg });
  }
}
