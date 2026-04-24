import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { PrismaClient } from '@prisma/client';
import { AppError } from '../../common/middleware/error.middleware';

const prisma = new PrismaClient();

export class BlogController {
  getAll = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { published } = req.query;
      const tenantId = req.user!.tenantId;

      const posts = await prisma.post.findMany({
        where: {
          tenantId,
          ...(published === 'true' && { isPublished: true }),
        },
        include: {
          author: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      res.status(200).json({
        status: 'success',
        data: posts,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch posts' });
    }
  };

  getById = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const tenantId = req.user!.tenantId;

      const post = await prisma.post.findFirst({
        where: { id, tenantId },
        include: {
          author: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      if (!post) {
        throw new AppError('Post not found', 404);
      }

      res.status(200).json({
        status: 'success',
        data: post,
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to fetch post' });
      }
    }
  };

  getBySlug = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const slug = req.params.slug as string;
      const tenantId = req.user!.tenantId;

      const post = await prisma.post.findFirst({
        where: { slug, tenantId, isPublished: true },
        include: {
          author: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      if (!post) {
        throw new AppError('Post not found', 404);
      }

      res.status(200).json({
        status: 'success',
        data: post,
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to fetch post' });
      }
    }
  };

  create = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const authorId = req.user!.id;
      const { title, content, slug, excerpt, coverImage, isPublished } = req.body;

      if (!title || !content || !slug) {
        throw new AppError('Title, content, and slug are required', 400);
      }

      const post = await prisma.post.create({
        data: {
          title,
          content,
          slug,
          excerpt,
          coverImage,
          isPublished: isPublished || false,
          publishedAt: isPublished ? new Date() : null,
          tenantId,
          authorId,
        },
        include: {
          author: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      res.status(201).json({
        status: 'success',
        data: post,
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        res.status(400).json({ error: 'Bu slug zaten kullanılıyor' });
      } else if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to create post' });
      }
    }
  };

  update = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const tenantId = req.user!.tenantId;
      const { title, content, slug, excerpt, coverImage, isPublished } = req.body;

      // Check if post exists and belongs to tenant
      const existingPost = await prisma.post.findFirst({
        where: { id, tenantId },
      });

      if (!existingPost) {
        throw new AppError('Post not found', 404);
      }

      const post = await prisma.post.update({
        where: { id },
        data: {
          title,
          content,
          slug,
          excerpt,
          coverImage,
          isPublished,
          publishedAt: isPublished && !existingPost.isPublished ? new Date() : existingPost.publishedAt,
        },
        include: {
          author: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      res.status(200).json({
        status: 'success',
        data: post,
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to update post' });
      }
    }
  };

  delete = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const tenantId = req.user!.tenantId;

      // Check if post exists and belongs to tenant
      const existingPost = await prisma.post.findFirst({
        where: { id, tenantId },
      });

      if (!existingPost) {
        throw new AppError('Post not found', 404);
      }

      await prisma.post.delete({
        where: { id },
      });

      res.status(200).json({
        status: 'success',
        message: 'Post deleted successfully',
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to delete post' });
      }
    }
  };
}
