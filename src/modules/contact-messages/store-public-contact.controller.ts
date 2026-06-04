import { Request, Response } from 'express';
import prisma from '../../config/database';
import { AppError } from '../../common/middleware/AppError';
import { resolveStoreTenant } from '../store-public/store-tenant.util';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function trimStr(v: unknown, max: number): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return '';
  return s.length > max ? s.slice(0, max) : s;
}

export async function submitStoreContact(req: Request, res: Response): Promise<void> {
  try {
    const tenant = await resolveStoreTenant(req);
    if (!tenant) {
      res.status(404).json({ status: 'error', error: 'Mağaza bulunamadı.' });
      return;
    }

    const body = req.body ?? {};
    const name = trimStr(body.name, 120);
    const email = trimStr(body.email, 200);
    const phone = trimStr(body.phone, 40) || null;
    const subject = trimStr(body.subject, 200);
    const message = trimStr(body.message, 8000);

    if (!name) throw new AppError('Ad soyad zorunludur.', 400);
    if (!email || !EMAIL_RE.test(email)) throw new AppError('Geçerli bir e-posta girin.', 400);
    if (!subject) throw new AppError('Konu zorunludur.', 400);
    if (!message || message.length < 10) {
      throw new AppError('Mesaj en az 10 karakter olmalıdır.', 400);
    }

    await prisma.contactMessage.create({
      data: {
        tenantId: tenant.id,
        name,
        email,
        phone,
        subject,
        message,
        status: 'NEW',
      },
    });

    res.status(201).json({
      status: 'success',
      message: 'Mesajınız alındı. En kısa sürede size dönüş yapacağız.',
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Mesaj gönderilemedi. Lütfen tekrar deneyin.' });
  }
}
