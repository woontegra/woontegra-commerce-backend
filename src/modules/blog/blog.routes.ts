import { Router } from 'express';
import { BlogController } from './blog.controller';

const router = Router();
const blogController = new BlogController();

router.get('/', (req, res) => blogController.getAll(req, res));
router.get('/slug/:slug', (req, res) => blogController.getBySlug(req, res));
router.get('/:id', (req, res) => blogController.getById(req, res));
router.post('/', (req, res) => blogController.create(req, res));
router.put('/:id', (req, res) => blogController.update(req, res));
router.delete('/:id', (req, res) => blogController.delete(req, res));

export default router;
