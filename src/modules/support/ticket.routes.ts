import { Router } from 'express';
import { ticketController } from './ticket.controller';
import { authenticateToken } from '../../common/middleware/auth.middleware';
import { uploadMiddleware } from '../../common/middleware/upload.middleware';

const router = Router();

// Apply authentication to all support routes
router.use(authenticateToken);

// Ticket routes
router.post('/tickets', ticketController.createTicket);
router.get('/tickets', ticketController.getTickets);
router.get('/tickets/stats', ticketController.getTicketStats);
router.get('/tickets/:id', ticketController.getTicketById);
router.put('/tickets/:id/status', ticketController.updateTicketStatus);
router.post('/tickets/:id/messages', ticketController.addMessage);

// Support categories
router.get('/categories', ticketController.getSupportCategories);

// File upload for ticket attachments
router.post('/tickets/:id/attachments', uploadMiddleware.single('file'), async (req, res) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { id } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
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

    const attachment = await prisma.ticketAttachment.create({
      data: {
        ticketId: id,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        filePath: file.path
      }
    });

    res.status(201).json({
      success: true,
      message: 'File uploaded successfully',
      data: attachment
    });
  } catch (error) {
    console.error('Upload attachment error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

export default router;
