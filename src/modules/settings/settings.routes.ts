import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../common/middleware/authEnhanced';
import {
  getSettings, updateSettings,
  uploadLogo, logoUploader,
  uploadFavicon, faviconUploader,
  updateDomain,
  getBranding,
} from './settings.controller';

const router = Router();

// ── Public: tenant branding (used by store frontend) ──────────────────────────
router.get('/branding/:slug', getBranding);

// ── Protected ─────────────────────────────────────────────────────────────────
router.use(authenticate);

router.get('/',       getSettings  as any);
router.put('/',       updateSettings as any);
router.put('/domain', updateDomain as any);

// Logo upload — wrap multer errors
router.post('/logo', (req: Request, res: Response, next: NextFunction) => {
  logoUploader(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });
}, uploadLogo as any);

// Favicon upload
router.post('/favicon', (req: Request, res: Response, next: NextFunction) => {
  faviconUploader(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });
}, uploadFavicon as any);

export default router;
