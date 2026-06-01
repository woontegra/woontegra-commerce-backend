import {
  Prisma,
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
    throw new Error('Konu en az 3 karakter olmalıdır.');
  }
  if (message.length < 10) {
    throw new Error('Mesaj en az 10 karakter olmalıdır.');
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

export function toApiTicket(row: {
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
}) {
  const status =
    row.status === SupportTicketStatus.OPEN ? 'open'
    : row.status === SupportTicketStatus.WAITING_REPLY ? 'in_progress'
    : row.status === SupportTicketStatus.RESOLVED ? 'resolved'
    : 'closed';

  const priority =
    row.priority === SupportTicketPriority.LOW ? 'low'
    : row.priority === SupportTicketPriority.HIGH ? 'high'
    : 'medium';

  return {
    id: row.id,
    subject: row.subject,
    status,
    priority,
    category: row.category,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messageCount: 1,
    lastMessage: {
      id: row.id,
      message: row.message,
      createdAt: row.createdAt.toISOString(),
      isInternal: false,
    },
    user: row.createdBy ?? undefined,
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

export const supportTicketService = {
  async list(tenantId: string, query: ListSupportTicketsQuery) {
    const where = buildWhere(tenantId, query);
    const [rows, summary] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        include: {
          createdBy: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
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

  async create(tenantId: string, createdByUserId: string | null, input: CreateSupportTicketInput) {
    const row = await prisma.supportTicket.create({
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
    return toApiTicket(row);
  },
};
