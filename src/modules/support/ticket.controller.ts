import { Request, Response } from 'express';
import { AppError } from '../../common/middleware/error.middleware';
import prisma from '../../config/database';

export const createTicket = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { subject, description, category, priority } = req.body;

    if (!subject || !description || !category) {
      return res.status(400).json({ error: 'Subject, description, and category are required' });
    }

    // Generate ticket number
    const ticketNumber = `TKT-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

    const ticket = await prisma.supportTicket.create({
      data: {
        ticketNumber,
        userId: user.id,
        tenantId: user.tenantId,
        subject,
        description,
        category,
        priority: priority || 'medium',
        status: 'open'
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    // Create initial message from user
    await prisma.supportMessage.create({
      data: {
        ticketId: ticket.id,
        senderId: user.id,
        content: description,
        messageType: 'text',
        isInternal: false
      }
    });

    res.status(201).json({
      success: true,
      message: 'Ticket created successfully',
      data: ticket
    });
  } catch (error) {
    console.error('Create ticket error:', error);
    res.status(500).json({ error: 'Failed to create ticket' });
  }
};

export const getTickets = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { page = 1, limit = 10, status, category, priority } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {
      OR: [
        { userId: user.id },
        { assignedToId: user.id }
      ]
    };

    if (status) {
      where.status = status;
    }

    if (category) {
      where.category = category;
    }

    if (priority) {
      where.priority = priority;
    }

    const [tickets, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true
            }
          },
          assignedTo: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true
            }
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1
          },
          _count: {
            select: { messages: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit)
      }),
      prisma.supportTicket.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        tickets,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get tickets error:', error);
    res.status(500).json({ error: 'Failed to get tickets' });
  }
};

export const getTicketById = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { id } = req.params;

    const ticket = await prisma.supportTicket.findFirst({
      where: {
        id,
        OR: [
          { userId: user.id },
          { assignedToId: user.id }
        ]
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true
          }
        },
        assignedTo: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true
          }
        },
        messages: {
          include: {
            sender: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true
              }
            },
            attachments: true
          },
          orderBy: { createdAt: 'asc' }
        },
        attachments: true
      }
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.json({
      success: true,
      data: ticket
    });
  } catch (error) {
    console.error('Get ticket error:', error);
    res.status(500).json({ error: 'Failed to get ticket' });
  }
};

export const updateTicketStatus = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { id } = req.params;
    const { status, assignedToId } = req.body;

    const ticket = await prisma.supportTicket.findFirst({
      where: {
        id,
        OR: [
          { userId: user.id },
          { assignedToId: user.id }
        ]
      }
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const updateData: any = {
      status,
      updatedAt: new Date()
    };

    if (status === 'resolved') {
      updateData.resolvedAt = new Date();
    }

    if (assignedToId) {
      updateData.assignedToId = assignedToId;
    }

    const updatedTicket = await prisma.supportTicket.update({
      where: { id },
      data: updateData,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true
          }
        },
        assignedTo: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Ticket updated successfully',
      data: updatedTicket
    });
  } catch (error) {
    console.error('Update ticket error:', error);
    res.status(500).json({ error: 'Failed to update ticket' });
  }
};

export const addMessage = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { id } = req.params;
    const { content, messageType = 'text', isInternal = false } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    // Check if user has access to this ticket
    const ticket = await prisma.supportTicket.findFirst({
      where: {
        id,
        OR: [
          { userId: user.id },
          { assignedToId: user.id }
        ]
      }
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const message = await prisma.supportMessage.create({
      data: {
        ticketId: id,
        senderId: user.id,
        content,
        messageType,
        isInternal
      },
      include: {
        sender: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    // Update ticket status if needed
    if (ticket.status === 'waiting_customer' && !isInternal) {
      await prisma.supportTicket.update({
        where: { id },
        data: { status: 'in_progress' }
      });
    }

    res.status(201).json({
      success: true,
      message: 'Message added successfully',
      data: message
    });
  } catch (error) {
    console.error('Add message error:', error);
    res.status(500).json({ error: 'Failed to add message' });
  }
};

export const getSupportCategories = async (req: Request, res: Response) => {
  try {
    const categories = await prisma.supportCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' }
    });

    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Failed to get categories' });
  }
};

export const getTicketStats = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const stats = await prisma.supportTicket.groupBy({
      by: ['status'],
      where: {
        OR: [
          { userId: user.id },
          { assignedToId: user.id }
        ]
      },
      _count: true
    });

    const categoryStats = await prisma.supportTicket.groupBy({
      by: ['category'],
      where: {
        OR: [
          { userId: user.id },
          { assignedToId: user.id }
        ]
      },
      _count: true
    });

    const priorityStats = await prisma.supportTicket.groupBy({
      by: ['priority'],
      where: {
        OR: [
          { userId: user.id },
          { assignedToId: user.id }
        ]
      },
      _count: true
    });

    res.json({
      success: true,
      data: {
        byStatus: stats,
        byCategory: categoryStats,
        byPriority: priorityStats
      }
    });
  } catch (error) {
    console.error('Get ticket stats error:', error);
    res.status(500).json({ error: 'Failed to get ticket stats' });
  }
};
