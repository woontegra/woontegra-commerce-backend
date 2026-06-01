import {
  Prisma,
  SupportMessageSenderType,
  SupportTicketPriority,
  SupportTicketStatus,
} from '@prisma/client';
import prisma from '../../config/database';

export type CreateSupportTicketInput = {
  subject: string;
  message: string;
  priority: SupportTicketPriority;
  category: string;
};

export type ListSupportTicketsQuery = {
  status?: SupportTicketStatus;
  priority?: SupportTicketPriority;
  search?: string;
};

export type AdminListSupportTicketsQuery = ListSupportTicketsQuery & {
  tenantId?: string;
  page?: number;
  limit?: number;
};

export class SupportTicketError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'SupportTicketError';
  }
}

function mapPriorityInput(raw: unknown): SupportTicketPriority | null {
  const v = String(raw ?? '').trim().toUpperCase();
  if (v === 'LOW' || v === 'DÜŞÜK') return SupportTicketPriority.LOW;
  if (v === 'NORMAL' || v === 'MEDIUM' || v === 'ORTA') return SupportTicketPriority.NORMAL;
  if (v === 'HIGH' || v === 'YÜKSEK') return SupportTicketPriority.HIGH;
  return null;
}

function mapStatusInput(raw: unknown): SupportTicketStatus | null {
  const v = String(raw ?? '').trim().toUpperCase();
  if (v === 'OPEN' || v === 'AÇIK') return SupportTicketStatus.OPEN;
  if (v === 'WAITING_REPLY' || v === 'IN_PROGRESS') return SupportTicketStatus.WAITING_REPLY;
  if (v === 'RESOLVED') return SupportTicketStatus.RESOLVED;
  if (v === 'CLOSED') return SupportTicketStatus.CLOSED;
  return null;
}

export function parseCreateSupportTicketBody(body: unknown): CreateSupportTicketInput {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const subject = String(b.subject ?? '').trim();
  const message = String(b.message ?? '').trim();
  const category = String(b.category ?? 'GENERAL').trim() || 'GENERAL';
  const priority = mapPriorityInput(b.priority) ?? SupportTicketPriority.NORMAL;

  if (subject.length < 3) {
    throw new SupportTicketError('Konu en az 3 karakter olmalıdır.');
  }
  if (message.length < 10) {
    throw new SupportTicketError('Mesaj en az 10 karakter olmalıdır.');
  }

  return { subject, message, priority, category };
}

export function parseListSupportTicketsQuery(query: Record<string, unknown>): ListSupportTicketsQuery {
  const out: ListSupportTicketsQuery = {};
  const status = mapStatusInput(query.status);
  const priority = mapPriorityInput(query.priority);
  const search = String(query.search ?? '').trim();
  if (status) out.status = status;
  if (priority) out.priority = priority;
  if (search) out.search = search;
  return out;
}

export function parseAdminListSupportTicketsQuery(query: Record<string, unknown>): AdminListSupportTicketsQuery {
  const out: AdminListSupportTicketsQuery = parseListSupportTicketsQuery(query);
  const tenantId = String(query.tenantId ?? '').trim();
  if (tenantId) out.tenantId = tenantId;
  const page = Number(query.page);
  const limit = Number(query.limit);
  if (Number.isInteger(page) && page > 0) out.page = page;
  if (Number.isInteger(limit) && limit > 0) out.limit = Math.min(limit, 100);
  return out;
}

export function parseUpdateStatusBody(body: unknown): SupportTicketStatus {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const status = mapStatusInput(b.status);
  if (!status) {
    throw new SupportTicketError('Geçersiz talep durumu.');
  }
  return status;
}

export function parseAddMessageBody(body: unknown): string {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const message = String(b.message ?? '').trim();
  if (message.length < 2) {
    throw new SupportTicketError('Mesaj boş olamaz.');
  }
  if (message.length > 5000) {
    throw new SupportTicketError('Mesaj en fazla 5000 karakter olabilir.');
  }
  return message;
}

export function parseTicketId(raw: unknown): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new SupportTicketError('Geçersiz talep numarası.', 400);
  }
  return id;
}

function buildWhere(tenantId: string, q: ListSupportTicketsQuery): Prisma.SupportTicketWhereInput {
  const where: Prisma.SupportTicketWhereInput = { tenantId };
  if (q.status) where.status = q.status;
  if (q.priority) where.priority = q.priority;
  if (q.search) {
    const idNum = Number(q.search.replace(/^#/, ''));
    where.OR = [
      { subject: { contains: q.search, mode: 'insensitive' } },
      ...(Number.isFinite(idNum) ? [{ id: idNum }] : []),
    ];
  }
  return where;
}

function buildAdminWhere(q: AdminListSupportTicketsQuery): Prisma.SupportTicketWhereInput {
  const where: Prisma.SupportTicketWhereInput = {};
  if (q.tenantId) where.tenantId = q.tenantId;
  if (q.status) where.status = q.status;
  if (q.priority) where.priority = q.priority;
  if (q.search) {
    const idNum = Number(q.search.replace(/^#/, ''));
    where.OR = [
      { subject: { contains: q.search, mode: 'insensitive' } },
      { tenant: { name: { contains: q.search, mode: 'insensitive' } } },
      { tenant: { slug: { contains: q.search, mode: 'insensitive' } } },
      ...(Number.isFinite(idNum) ? [{ id: idNum }] : []),
    ];
  }
  return where;
}

function mapApiStatus(status: SupportTicketStatus): string {
  if (status === SupportTicketStatus.OPEN) return 'open';
  if (status === SupportTicketStatus.WAITING_REPLY) return 'in_progress';
  if (status === SupportTicketStatus.RESOLVED) return 'resolved';
  return 'closed';
}

function mapApiPriority(priority: SupportTicketPriority): string {
  if (priority === SupportTicketPriority.LOW) return 'low';
  if (priority === SupportTicketPriority.HIGH) return 'high';
  return 'medium';
}

function mapApiSenderType(senderType: SupportMessageSenderType): 'user' | 'support' {
  return senderType === SupportMessageSenderType.SUPPORT ? 'support' : 'user';
}

export function toApiMessage(row: {
  id: string;
  message: string;
  senderType: SupportMessageSenderType;
  isInternal: boolean;
  createdAt: Date;
}) {
  return {
    id: row.id,
    message: row.message,
    senderType: mapApiSenderType(row.senderType),
    isInternal: row.isInternal,
    createdAt: row.createdAt.toISOString(),
  };
}

type TicketRow = {
  id: number;
  subject: string;
  message: string;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  category: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  } | null;
  tenant?: {
    id: string;
    name: string;
    slug: string;
  };
  _count?: { messages: number };
  messages?: Array<{
    id: string;
    message: string;
    senderType: SupportMessageSenderType;
    isInternal: boolean;
    createdAt: Date;
  }>;
};

function toApiAdminTicket(row: TicketRow) {
  return {
    ...toApiTicket(row),
    tenant: row.tenant ?? undefined,
  };
}

export function toApiTicket(row: TicketRow) {
  const visibleMessages = (row.messages ?? []).filter(m => !m.isInternal);
  const lastMsg = visibleMessages[0];
  const messageCount = row._count?.messages ?? (visibleMessages.length || 1);

  return {
    id: row.id,
    subject: row.subject,
    status: mapApiStatus(row.status),
    priority: mapApiPriority(row.priority),
    category: row.category,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messageCount,
    lastMessage: lastMsg
      ? toApiMessage(lastMsg)
      : {
          id: String(row.id),
          message: row.message,
          senderType: 'user' as const,
          isInternal: false,
          createdAt: row.createdAt.toISOString(),
        },
    user: row.createdBy ?? undefined,
  };
}

function toApiTicketDetail(
  row: TicketRow,
  messages: Array<{
    id: string;
    message: string;
    senderType: SupportMessageSenderType;
    isInternal: boolean;
    createdAt: Date;
  }>,
) {
  const visibleMessages = messages.filter(m => !m.isInternal);
  const normalizedMessages =
    visibleMessages.length > 0
      ? visibleMessages.map(toApiMessage)
      : [
          {
            id: String(row.id),
            message: row.message,
            senderType: 'user' as const,
            isInternal: false,
            createdAt: row.createdAt.toISOString(),
          },
        ];

  return {
    ...toApiTicket({ ...row, messages: visibleMessages.length ? [visibleMessages[visibleMessages.length - 1]] : [] }),
    messages: normalizedMessages,
  };
}

async function computeSummary(tenantId: string) {
  const [total, open, waiting, resolved, closed] = await Promise.all([
    prisma.supportTicket.count({ where: { tenantId } }),
    prisma.supportTicket.count({ where: { tenantId, status: SupportTicketStatus.OPEN } }),
    prisma.supportTicket.count({ where: { tenantId, status: SupportTicketStatus.WAITING_REPLY } }),
    prisma.supportTicket.count({ where: { tenantId, status: SupportTicketStatus.RESOLVED } }),
    prisma.supportTicket.count({ where: { tenantId, status: SupportTicketStatus.CLOSED } }),
  ]);
  return { total, open, waiting, resolved: resolved + closed };
}

async function computeAdminSummary(where: Prisma.SupportTicketWhereInput = {}) {
  const [total, open, waiting, resolved, closed] = await Promise.all([
    prisma.supportTicket.count({ where }),
    prisma.supportTicket.count({ where: { ...where, status: SupportTicketStatus.OPEN } }),
    prisma.supportTicket.count({ where: { ...where, status: SupportTicketStatus.WAITING_REPLY } }),
    prisma.supportTicket.count({ where: { ...where, status: SupportTicketStatus.RESOLVED } }),
    prisma.supportTicket.count({ where: { ...where, status: SupportTicketStatus.CLOSED } }),
  ]);
  return { total, open, waiting, resolved, closed };
}

const ticketInclude = {
  createdBy: {
    select: { id: true, email: true, firstName: true, lastName: true },
  },
  _count: {
    select: { messages: true },
  },
  messages: {
    where: { isInternal: false },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: {
      id: true,
      message: true,
      senderType: true,
      isInternal: true,
      createdAt: true,
    },
  },
};

const adminTicketInclude = {
  ...ticketInclude,
  tenant: {
    select: { id: true, name: true, slug: true },
  },
};

export const supportTicketService = {
  async list(tenantId: string, query: ListSupportTicketsQuery) {
    const where = buildWhere(tenantId, query);
    const [rows, summary] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        include: ticketInclude,
        orderBy: { updatedAt: 'desc' },
      }),
      computeSummary(tenantId),
    ]);

    return {
      tickets: rows.map(toApiTicket),
      summary,
      pagination: { total: summary.total },
    };
  },

  async getById(tenantId: string, ticketId: number) {
    const row = await prisma.supportTicket.findFirst({
      where: { id: ticketId, tenantId },
      include: {
        createdBy: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        messages: {
          where: { isInternal: false },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            message: true,
            senderType: true,
            isInternal: true,
            createdAt: true,
          },
        },
      },
    });

    if (!row) {
      throw new SupportTicketError('Talep bulunamadı.', 404);
    }

    return toApiTicketDetail(row, row.messages);
  },

  async create(tenantId: string, createdByUserId: string | null, input: CreateSupportTicketInput) {
    const row = await prisma.$transaction(async tx => {
      const ticket = await tx.supportTicket.create({
        data: {
          tenantId,
          subject: input.subject,
          message: input.message,
          priority: input.priority,
          category: input.category,
          status: SupportTicketStatus.OPEN,
          createdByUserId: createdByUserId ?? undefined,
        },
        include: {
          createdBy: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
      });

      await tx.supportTicketMessage.create({
        data: {
          ticketId: ticket.id,
          tenantId,
          senderType: SupportMessageSenderType.USER,
          senderUserId: createdByUserId ?? undefined,
          message: input.message,
          isInternal: false,
        },
      });

      return ticket;
    });

    return toApiTicket({
      ...row,
      _count: { messages: 1 },
      messages: [
        {
          id: String(row.id),
          message: row.message,
          senderType: SupportMessageSenderType.USER,
          isInternal: false,
          createdAt: row.createdAt,
        },
      ],
    });
  },

  async addMessage(
    tenantId: string,
    ticketId: number,
    senderUserId: string | null,
    message: string,
  ) {
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: ticketId, tenantId },
      select: { id: true, status: true, tenantId: true },
    });

    if (!ticket) {
      throw new SupportTicketError('Talep bulunamadı.', 404);
    }

    if (ticket.status === SupportTicketStatus.CLOSED) {
      throw new SupportTicketError('Kapalı talebe mesaj eklenemez.');
    }

    const nextStatus =
      ticket.status === SupportTicketStatus.RESOLVED
        ? SupportTicketStatus.OPEN
        : SupportTicketStatus.OPEN;

    const created = await prisma.$transaction(async tx => {
      const msg = await tx.supportTicketMessage.create({
        data: {
          ticketId: ticket.id,
          tenantId: ticket.tenantId,
          senderType: SupportMessageSenderType.USER,
          senderUserId: senderUserId ?? undefined,
          message,
          isInternal: false,
        },
        select: {
          id: true,
          message: true,
          senderType: true,
          isInternal: true,
          createdAt: true,
        },
      });

      await tx.supportTicket.update({
        where: { id: ticket.id },
        data: { status: nextStatus },
      });

      return msg;
    });

    return toApiMessage(created);
  },
};

export const adminSupportTicketService = {
  async list(query: AdminListSupportTicketsQuery) {
    const where = buildAdminWhere(query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;

    const [rows, total, summary] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        include: adminTicketInclude,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.supportTicket.count({ where }),
      computeAdminSummary(),
    ]);

    return {
      tickets: rows.map(toApiAdminTicket),
      summary,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  },

  async getById(ticketId: number) {
    const row = await prisma.supportTicket.findFirst({
      where: { id: ticketId },
      include: {
        createdBy: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        tenant: {
          select: { id: true, name: true, slug: true },
        },
        messages: {
          where: { isInternal: false },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            message: true,
            senderType: true,
            isInternal: true,
            createdAt: true,
          },
        },
      },
    });

    if (!row) {
      throw new SupportTicketError('Talep bulunamadı.', 404);
    }

    return {
      ...toApiTicketDetail(row, row.messages),
      tenant: row.tenant,
    };
  },

  async addSupportMessage(ticketId: number, senderUserId: string | null, message: string) {
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: ticketId },
      select: { id: true, status: true, tenantId: true },
    });

    if (!ticket) {
      throw new SupportTicketError('Talep bulunamadı.', 404);
    }

    const created = await prisma.$transaction(async tx => {
      const msg = await tx.supportTicketMessage.create({
        data: {
          ticketId: ticket.id,
          tenantId: ticket.tenantId,
          senderType: SupportMessageSenderType.SUPPORT,
          senderUserId: senderUserId ?? undefined,
          message,
          isInternal: false,
        },
        select: {
          id: true,
          message: true,
          senderType: true,
          isInternal: true,
          createdAt: true,
        },
      });

      await tx.supportTicket.update({
        where: { id: ticket.id },
        data: { status: SupportTicketStatus.WAITING_REPLY },
      });

      return msg;
    });

    return toApiMessage(created);
  },

  async updateStatus(ticketId: number, status: SupportTicketStatus) {
    const existing = await prisma.supportTicket.findFirst({
      where: { id: ticketId },
      select: { id: true },
    });

    if (!existing) {
      throw new SupportTicketError('Talep bulunamadı.', 404);
    }

    const row = await prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status },
      include: {
        createdBy: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        tenant: {
          select: { id: true, name: true, slug: true },
        },
        _count: { select: { messages: true } },
        messages: {
          where: { isInternal: false },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            message: true,
            senderType: true,
            isInternal: true,
            createdAt: true,
          },
        },
      },
    });

    return toApiAdminTicket(row);
  },
};
