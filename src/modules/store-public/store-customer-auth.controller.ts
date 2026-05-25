import { Response } from 'express';
import { resolveStoreTenant } from './store-tenant.util';
import {
  storeCustomerRegisterSchema,
  storeCustomerLoginSchema,
  storeCustomerForgotPasswordSchema,
  storeCustomerResetPasswordSchema,
  customerAddressSchema,
  customerProfileUpdateSchema,
} from './store-customer-auth.dto';
import { storeCustomerAuthService } from './store-customer-auth.service';
import {
  storeCustomerPasswordResetService,
  FORGOT_PASSWORD_SUCCESS_MESSAGE,
} from './store-customer-password-reset.service';
import { storeAccountService } from './store-account.service';
import { parseStoreAccountOrdersListQuery } from './store-account-orders-query.util';
import type { StoreCustomerAuthRequest } from './store-customer-auth.middleware';

async function resolveTenantOr404(req: StoreCustomerAuthRequest, res: Response) {
  const tenant = await resolveStoreTenant(req);
  if (!tenant) {
    res.status(404).json({ success: false, error: 'Mağaza bulunamadı.' });
    return null;
  }
  return tenant;
}

export async function register(req: StoreCustomerAuthRequest, res: Response): Promise<void> {
  try {
    const tenant = await resolveTenantOr404(req, res);
    if (!tenant) return;

    const parsed = storeCustomerRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues.map(i => i.message).join('; ') });
      return;
    }

    const result = await storeCustomerAuthService.register(tenant, parsed.data);
    res.status(201).json({ success: true, customer: result.customer, token: result.token });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Kayıt olunamadı.';
    const isClient = /kayıtlı|geçersiz/i.test(msg);
    res.status(isClient ? 400 : 500).json({ success: false, error: msg });
  }
}

export async function login(req: StoreCustomerAuthRequest, res: Response): Promise<void> {
  try {
    const tenant = await resolveTenantOr404(req, res);
    if (!tenant) return;

    const parsed = storeCustomerLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'E-posta ve şifre gerekli.' });
      return;
    }

    const result = await storeCustomerAuthService.login(tenant, parsed.data.email, parsed.data.password);
    res.json({ success: true, customer: result.customer, token: result.token });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Giriş yapılamadı.';
    res.status(401).json({ success: false, error: msg });
  }
}

export async function logout(_req: StoreCustomerAuthRequest, res: Response): Promise<void> {
  res.json({ success: true });
}

export async function forgotPassword(req: StoreCustomerAuthRequest, res: Response): Promise<void> {
  try {
    const tenant = await resolveTenantOr404(req, res);
    if (!tenant) return;

    const parsed = storeCustomerForgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Geçerli bir e-posta adresi girin.' });
      return;
    }

    await storeCustomerPasswordResetService.requestReset(tenant, parsed.data.email);
    res.json({ success: true, message: FORGOT_PASSWORD_SUCCESS_MESSAGE });
  } catch (e: unknown) {
    res.json({ success: true, message: FORGOT_PASSWORD_SUCCESS_MESSAGE });
  }
}

export async function resetPassword(req: StoreCustomerAuthRequest, res: Response): Promise<void> {
  try {
    const tenant = await resolveTenantOr404(req, res);
    if (!tenant) return;

    const parsed = storeCustomerResetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: parsed.error.issues.map(i => i.message).join('; ') || 'Geçersiz istek.',
      });
      return;
    }

    await storeCustomerPasswordResetService.resetPassword(
      tenant,
      parsed.data.token,
      parsed.data.password,
    );
    res.json({ success: true, message: 'Şifreniz güncellendi. Giriş yapabilirsiniz.' });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Şifre güncellenemedi.';
    res.status(400).json({ success: false, error: msg });
  }
}

export async function me(req: StoreCustomerAuthRequest, res: Response): Promise<void> {
  try {
    if (!req.storeCustomer || !req.storeTenant) {
      res.status(401).json({ success: false, error: 'Giriş yapmanız gerekiyor.' });
      return;
    }
    const customer = await storeCustomerAuthService.me(
      req.storeTenant.id,
      req.storeCustomer.customerId,
    );
    res.json({ success: true, customer });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Oturum alınamadı.';
    res.status(500).json({ success: false, error: msg });
  }
}

function customerPublic(row: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
}) {
  return {
    id:        row.id,
    email:     row.email,
    firstName: row.firstName,
    lastName:  row.lastName,
    phone:     row.phone ?? '',
  };
}

export async function updateProfile(req: StoreCustomerAuthRequest, res: Response): Promise<void> {
  try {
    if (!req.storeCustomer || !req.storeTenant) {
      res.status(401).json({ success: false, error: 'Giriş yapmanız gerekiyor.' });
      return;
    }
    const parsed = customerProfileUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues.map(i => i.message).join('; ') });
      return;
    }
    const row = await storeAccountService.updateProfile(
      req.storeTenant.id,
      req.storeCustomer.customerId,
      parsed.data,
    );
    res.json({ success: true, customer: customerPublic(row) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Profil güncellenemedi.';
    res.status(/bulunamadı/i.test(msg) ? 404 : 500).json({ success: false, error: msg });
  }
}

export async function listMyOrders(req: StoreCustomerAuthRequest, res: Response): Promise<void> {
  try {
    if (!req.storeCustomer || !req.storeTenant) {
      res.status(401).json({ success: false, error: 'Giriş yapmanız gerekiyor.' });
      return;
    }
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const filter = typeof req.query.filter === 'string' ? req.query.filter : undefined;
    const page   = typeof req.query.page === 'string' ? req.query.page : undefined;
    const limit  = typeof req.query.limit === 'string' ? req.query.limit : undefined;

    const parsed = parseStoreAccountOrdersListQuery({ status, filter, page, limit });

    if (parsed.invalid && (status?.trim() || filter?.trim())) {
      res.status(400).json({ success: false, error: 'Geçersiz sipariş filtresi.' });
      return;
    }

    const result = await storeAccountService.listOrders(
      req.storeTenant.id,
      req.storeCustomer.customerId,
      parsed.query,
    );
    res.json({ success: true, orders: result.orders, pagination: result.pagination });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Siparişler alınamadı.' });
  }
}

export async function getMyOrdersSummary(req: StoreCustomerAuthRequest, res: Response): Promise<void> {
  try {
    if (!req.storeCustomer || !req.storeTenant) {
      res.status(401).json({ success: false, error: 'Giriş yapmanız gerekiyor.' });
      return;
    }
    const summary = await storeAccountService.getOrdersSummary(
      req.storeTenant.id,
      req.storeCustomer.customerId,
    );
    res.json({ success: true, summary });
  } catch (e: unknown) {
    res.status(500).json({
      success: false,
      error: e instanceof Error ? e.message : 'Sipariş özeti alınamadı.',
    });
  }
}

export async function getMyOrder(req: StoreCustomerAuthRequest, res: Response): Promise<void> {
  try {
    if (!req.storeCustomer || !req.storeTenant) {
      res.status(401).json({ success: false, error: 'Giriş yapmanız gerekiyor.' });
      return;
    }
    const orderNumber = typeof req.params.orderNumber === 'string' ? req.params.orderNumber : '';
    const order = await storeAccountService.getOrderByNumber(
      req.storeTenant.id,
      req.storeCustomer.customerId,
      orderNumber,
    );
    if (!order) {
      res.status(404).json({ success: false, error: 'Sipariş bulunamadı.' });
      return;
    }
    res.json({ success: true, order });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Sipariş alınamadı.' });
  }
}

export async function listAddresses(req: StoreCustomerAuthRequest, res: Response): Promise<void> {
  try {
    if (!req.storeCustomer || !req.storeTenant) {
      res.status(401).json({ success: false, error: 'Giriş yapmanız gerekiyor.' });
      return;
    }
    const addresses = await storeAccountService.listAddresses(
      req.storeTenant.id,
      req.storeCustomer.customerId,
    );
    res.json({ success: true, addresses });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Adresler alınamadı.' });
  }
}

export async function createAddress(req: StoreCustomerAuthRequest, res: Response): Promise<void> {
  try {
    if (!req.storeCustomer || !req.storeTenant) {
      res.status(401).json({ success: false, error: 'Giriş yapmanız gerekiyor.' });
      return;
    }
    const parsed = customerAddressSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues.map(i => i.message).join('; ') });
      return;
    }
    const address = await storeAccountService.createAddress(
      req.storeTenant.id,
      req.storeCustomer.customerId,
      parsed.data,
    );
    res.status(201).json({ success: true, address });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Adres eklenemedi.' });
  }
}

export async function updateAddress(req: StoreCustomerAuthRequest, res: Response): Promise<void> {
  try {
    if (!req.storeCustomer || !req.storeTenant) {
      res.status(401).json({ success: false, error: 'Giriş yapmanız gerekiyor.' });
      return;
    }
    const parsed = customerAddressSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues.map(i => i.message).join('; ') });
      return;
    }
    const address = await storeAccountService.updateAddress(
      req.storeTenant.id,
      req.storeCustomer.customerId,
      req.params.id,
      parsed.data,
    );
    res.json({ success: true, address });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Adres güncellenemedi.';
    res.status(/bulunamadı/i.test(msg) ? 404 : 500).json({ success: false, error: msg });
  }
}

export async function deleteAddress(req: StoreCustomerAuthRequest, res: Response): Promise<void> {
  try {
    if (!req.storeCustomer || !req.storeTenant) {
      res.status(401).json({ success: false, error: 'Giriş yapmanız gerekiyor.' });
      return;
    }
    await storeAccountService.deleteAddress(
      req.storeTenant.id,
      req.storeCustomer.customerId,
      req.params.id,
    );
    res.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Adres silinemedi.';
    res.status(/bulunamadı/i.test(msg) ? 404 : 500).json({ success: false, error: msg });
  }
}
