import { Router } from 'express';
import { WishlistController } from './wishlist.controller';
import { WishlistService } from './wishlist.service';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../../common/middleware/authEnhanced';

const router = Router();
const prisma = new PrismaClient();
const wishlistService = new WishlistService(prisma);
const wishlistController = new WishlistController(wishlistService);

// All routes require authentication
router.use(authenticate);

// Get user's wishlist
router.get('/', wishlistController.getWishlist.bind(wishlistController));

// Add item to wishlist
router.post('/add', wishlistController.addToWishlist.bind(wishlistController));

// Remove item from wishlist
router.delete('/remove', wishlistController.removeFromWishlist.bind(wishlistController));

// Clear entire wishlist
router.delete('/clear', wishlistController.clearWishlist.bind(wishlistController));

// Check if product is in wishlist
router.get('/check', wishlistController.checkInWishlist.bind(wishlistController));

export default router;
