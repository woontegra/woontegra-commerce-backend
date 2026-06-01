import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import {
  parseAddMessageBody,
  parseCreateSupportTicketBody,
  parseListSupportTicketsQuery,
  parseTicketId,
  SupportTicketError,
  supportTicketService,
} from './support-ticket.service';

function handleSupportError(res: Response, e: unknown, fallback: string): void {
  if (e instanceof SupportTicketError) {
    res.status(e.statusCode).json({ success: false, error: e.message, message: e.message });
    return;
  }
  const msg = e instanceof Error ? e.message : fallback;
  res.status(500).json({ success: false, error: msg, message: msg });
}

export async function getSupportTickets(req: AuthRequest, res: Response): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const query = parseListSupportTicketsQuery(req.query as Record<string, unknown>);
    const result = await supportTicketService.list(tenantId, query);
    res.json({
      success: true,
      tickets: result.tickets,
      summary: result.summary,
      pagination: result.pagination,
    });
  } catch (e: unknown) {
    handleSupportError(res, e, 'Destek talepleri alınamadı.');
  }
}

export async function getSupportTicketById(req: AuthRequest, res: Response): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const ticketId = parseTicketId(req.params.id);
    const ticket = await supportTicketService.getById(tenantId, ticketId);
    res.json({
      success: true,
      data: { ticket },
    });
  } catch (e: unknown) {
    handleSupportError(res, e, 'Destek talebi alınamadı.');
  }
}

export async function createSupportTicket(req: AuthRequest, res: Response): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const userId = req.user!.userId ?? req.user!.id ?? null;
    const input = parseCreateSupportTicketBody(req.body);
    const ticket = await supportTicketService.create(tenantId, userId, input);
    res.status(201).json({
      success: true,
      data: { ticket },
      message: 'Destek talebiniz oluşturuldu.',
    });
  } catch (e: unknown) {
    handleSupportError(res, e, 'Destek talebi oluşturulamadı.');
  }
}

export async function addSupportTicketMessage(req: AuthRequest, res: Response): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const userId = req.user!.userId ?? req.user!.id ?? null;
    const ticketId = parseTicketId(req.params.id);
    const message = parseAddMessageBody(req.body);
    const created = await supportTicketService.addMessage(tenantId, ticketId, userId, message);
    res.status(201).json({
      success: true,
      data: { message: created },
      message: 'Mesajınız gönderildi.',
    });
  } catch (e: unknown) {
    handleSupportError(res, e, 'Mesaj gönderilemedi.');
  }
}
