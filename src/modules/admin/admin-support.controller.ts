import {
  parseAddMessageBody,
  parseAdminListSupportTicketsQuery,
  parseTicketId,
  parseUpdateStatusBody,
  adminSupportTicketService,
  SupportTicketError,
} from '../support/support-ticket.service';

function handleSupportError(res: import('express').Response, e: unknown, fallback: string): void {
  if (e instanceof SupportTicketError) {
    res.status(e.statusCode).json({ success: false, error: e.message, message: e.message });
    return;
  }
  const msg = e instanceof Error ? e.message : fallback;
  res.status(500).json({ success: false, error: msg, message: msg });
}

export async function getAdminSupportTickets(req: import('../../common/middleware/auth.middleware').AuthRequest, res: import('express').Response): Promise<void> {
  try {
    const query = parseAdminListSupportTicketsQuery(req.query as Record<string, unknown>);
    const result = await adminSupportTicketService.list(query);
    res.json({
      success: true,
      data: result,
      tickets: result.tickets,
      summary: result.summary,
      pagination: result.pagination,
    });
  } catch (e: unknown) {
    handleSupportError(res, e, 'Destek talepleri alınamadı.');
  }
}

export async function getAdminSupportTicketById(req: import('../../common/middleware/auth.middleware').AuthRequest, res: import('express').Response): Promise<void> {
  try {
    const ticketId = parseTicketId(req.params.id);
    const ticket = await adminSupportTicketService.getById(ticketId);
    res.json({
      success: true,
      data: { ticket },
    });
  } catch (e: unknown) {
    handleSupportError(res, e, 'Destek talebi alınamadı.');
  }
}

export async function addAdminSupportTicketMessage(req: import('../../common/middleware/auth.middleware').AuthRequest, res: import('express').Response): Promise<void> {
  try {
    const userId = req.user!.userId ?? req.user!.id ?? null;
    const ticketId = parseTicketId(req.params.id);
    const message = parseAddMessageBody(req.body);
    const created = await adminSupportTicketService.addSupportMessage(ticketId, userId, message);
    res.status(201).json({
      success: true,
      data: { message: created },
      message: 'Cevap gönderildi.',
    });
  } catch (e: unknown) {
    handleSupportError(res, e, 'Mesaj gönderilemedi.');
  }
}

export async function patchAdminSupportTicketStatus(req: import('../../common/middleware/auth.middleware').AuthRequest, res: import('express').Response): Promise<void> {
  try {
    const ticketId = parseTicketId(req.params.id);
    const status = parseUpdateStatusBody(req.body);
    const ticket = await adminSupportTicketService.updateStatus(ticketId, status);
    res.json({
      success: true,
      data: { ticket },
      message: 'Talep durumu güncellendi.',
    });
  } catch (e: unknown) {
    handleSupportError(res, e, 'Talep durumu güncellenemedi.');
  }
}
