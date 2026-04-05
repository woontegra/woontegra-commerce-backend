import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { SettingsService } from './settings.service';

export class SettingsController {
  private settingsService: SettingsService;

  constructor() {
    this.settingsService = new SettingsService();
  }

  get = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const settings = await this.settingsService.getByTenant(tenantId);

      res.status(200).json({
        status: 'success',
        data: settings,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch settings' });
    }
  };

  update = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const settings = await this.settingsService.update(req.body, tenantId);

      res.status(200).json({
        status: 'success',
        data: settings,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update settings' });
    }
  };
}
