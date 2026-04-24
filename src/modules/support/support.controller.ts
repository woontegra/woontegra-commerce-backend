import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { asyncHandler } from '../../common/middleware/errorHandler';
import { createValidationError, createNotFoundError, createForbiddenError } from '../../common/middleware/AppError';
import { logger } from '../../utils/logger';
import { authenticate, requireTenantAccess } from '../../common/middleware/authEnhanced';

const prisma = new PrismaClient();

interface CreateTicketDto {
  subject: string;
  message: string;
  priority?: 'low' | 'medium' | 'high';
}

interface CreateMessageDto {
  ticketId: number;
  message: string;
}

interface CloseTicketDto {
  ticketId: number;
}

export class SupportController {
  // Create new support ticket
  createTicket = asyncHandler(async (req: Request, res: Response) => {
    const { tenantId, userId } = (req as any).user;
    const { subject, message, priority = 'medium' }: CreateTicketDto = req.body;

    // Validation
    if (!subject || !message) {
      throw createValidationError('Subject and message are required');
    }

    // Create ticket
    const ticket = await prisma.supportTicket.create({
      data: {
        tenantId,
        userId,
        subject,
        status: 'open',
        priority,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    // Create initial message
    await prisma.supportMessage.create({
      data: {
        ticketId: ticket.id,
        senderId: userId,
        message,
        isInternal: false,
      },
    });

    // Log ticket creation
    logger.info({
      message: 'Support ticket created',
      ticketId: ticket.id,
      subject,
      priority,
      userId,
      tenantId,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({
      success: true,
      data: {
        ticket,
        message: 'Support ticket created successfully',
      },
    });
  });

  // Get all tickets for the tenant
  getTickets = asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = (req as any).user;
    const { page = 1, limit = 20, status, priority } = req.query;

    // Build where clause
    const where: any = { tenantId };
    
    if (status) {
      where.status = status;
    }
    
    if (priority) {
      where.priority = priority;
    }

    // Get tickets with pagination
    const [tickets, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          messages: {
            where: { isInternal: false },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          _count: {
            select: { _all: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.supportTicket.count({ where }),
    ]);

    // Calculate pagination info
    const totalPages = Math.ceil(total / Number(limit));
    const hasNext = Number(page) < totalPages;
    const hasPrev = Number(page) > 1;

    res.json({
      success: true,
      data: {
        tickets: tickets.map(ticket => ({
          id: ticket.id,
          subject: ticket.subject,
          status: ticket.status,
          priority: ticket.priority,
          createdAt: ticket.createdAt,
          updatedAt: ticket.updatedAt,
          messageCount: ticket._count?._all || 0,
          lastMessage: ticket.messages[0] || null,
          user: ticket.user,
        })),
        pagination: {
          currentPage: Number(page),
          totalPages,
          total,
          limit: Number(limit),
          hasNext,
          hasPrev,
        },
      },
    });
  });

  // Get ticket details with messages
  getTicket = asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = (req as any).user;
    const { id } = req.params;

    const ticket = await prisma.supportTicket.findFirst({
      where: {
        id: Number(id),
        tenantId,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!ticket) {
      throw createNotFoundError('Ticket');
    }

    res.json({
      success: true,
      data: {
        ticket: {
          id: ticket.id,
          subject: ticket.subject,
          status: ticket.status,
          priority: ticket.priority,
          createdAt: ticket.createdAt,
          updatedAt: ticket.updatedAt,
          user: ticket.user,
        },
        messages: ticket.messages,
      },
    });
  });

  // Add message to ticket
  addMessage = asyncHandler(async (req: Request, res: Response) => {
    const { tenantId, userId } = (req as any).user;
    const { ticketId, message }: CreateMessageDto = req.body;

    // Validation
    if (!ticketId || !message) {
      throw createValidationError('Ticket ID and message are required');
    }

    // Check if ticket exists and belongs to tenant
    const ticket = await prisma.supportTicket.findFirst({
      where: {
        id: Number(ticketId),
        tenantId,
      },
    });

    if (!ticket) {
      throw createNotFoundError('Ticket');
    }

    if (ticket.status === 'closed') {
      throw createForbiddenError('Cannot add message to closed ticket');
    }

    // Create message
    const newMessage = await prisma.supportMessage.create({
      data: {
        ticketId: Number(ticketId),
        senderId: userId,
        message,
        isInternal: false,
      },
    });

    // Update ticket status if it was open
    if (ticket.status === 'open') {
      await prisma.supportTicket.update({
        where: { id: Number(ticketId) },
        data: { status: 'in_progress' },
      });
    }

    // Log message
    logger.info({
      message: 'Support message added',
      ticketId: Number(ticketId),
      userId,
      message,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({
      success: true,
      data: {
        message: newMessage,
        ticketStatus: 'in_progress',
      },
    });
  });

  // Close ticket
  closeTicket = asyncHandler(async (req: Request, res: Response) => {
    const { tenantId, userId } = (req as any).user;
    const { ticketId }: CloseTicketDto = req.body;

    // Validation
    if (!ticketId) {
      throw createValidationError('Ticket ID is required');
    }

    // Check if ticket exists and belongs to tenant
    const ticket = await prisma.supportTicket.findFirst({
      where: {
        id: Number(ticketId),
        tenantId,
      },
    });

    if (!ticket) {
      throw createNotFoundError('Ticket');
    }

    // Only ticket owner or admin can close ticket
    if (ticket.userId !== userId) {
      throw createForbiddenError('You can only close your own tickets');
    }

    // Close ticket
    await prisma.supportTicket.update({
      where: { id: Number(ticketId) },
      data: { status: 'closed' },
    });

    // Log ticket closure
    logger.info({
      message: 'Support ticket closed',
      ticketId: Number(ticketId),
      userId,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      data: {
        message: 'Ticket closed successfully',
      },
    });
  });

  // Get ticket statistics
  getTicketStats = asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = (req as any).user;

    const stats = await prisma.supportTicket.groupBy({
      by: ['status', 'priority'],
      where: { tenantId },
      _count: true,
    });

    const totalTickets = await prisma.supportTicket.count({
      where: { tenantId },
    });

    res.json({
      success: true,
      data: {
        total: totalTickets,
        byStatus: stats.reduce((acc, curr) => {
          acc[curr.by] = (acc[curr.by] || 0) + curr._count;
          return acc;
        }, {}),
        byPriority: stats.reduce((acc, curr) => {
          acc[curr.by] = (acc[curr.by] || 0) + curr._count;
          return acc;
        }, {}),
      },
    });
  });

  // Admin: Add internal message
  addInternalMessage = asyncHandler(async (req: Request, res: Response) => {
    const { tenantId, userId } = (req as any).user;
    const { ticketId, message }: CreateMessageDto = req.body;

    // Validation
    if (!ticketId || !message) {
      throw createValidationError('Ticket ID and message are required');
    }

    // Check if ticket exists and belongs to tenant
    const ticket = await prisma.supportTicket.findFirst({
      where: {
        id: Number(ticketId),
        tenantId,
      },
    });

    if (!ticket) {
      throw createNotFoundError('Ticket');
    }

    // Create internal message
    const newMessage = await prisma.supportMessage.create({
      data: {
        ticketId: Number(ticketId),
        senderId: userId,
        message,
        isInternal: true,
      },
    });

    // Update ticket status if needed
    if (ticket.status === 'open') {
      await prisma.supportTicket.update({
        where: { id: Number(ticketId) },
        data: { status: 'in_progress' },
      });
    }

    // Log internal message
    logger.info({
      message: 'Internal support message added',
      ticketId: Number(ticketId),
      userId,
      message,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({
      success: true,
      data: {
        message: newMessage,
        ticketStatus: 'in_progress',
      },
    });
  });
}
