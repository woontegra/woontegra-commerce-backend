import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import {
  parseCreateSupportTicketBody,
  parseListSupportTicketsQuery,
  supportTicketService,
} from './support-ticket.service';

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
    const msg = e instanceof Error ? e.message : 'Destek talepleri alınamadı.';
    res.status(500).json({ success: false, error: msg, message: msg });
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
    const msg = e instanceof Error ? e.message : 'Destek talebi oluşturulamadı.';
    const status = /en az/i.test(msg) ? 400 : 500;
    res.status(status).json({ success: false, error: msg, message: msg });
  }
}
