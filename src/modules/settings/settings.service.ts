import prisma from '../../config/database';

export class SettingsService {
  async getByTenant(tenantId: string) {
    let settings = await prisma.settings.findUnique({
      where: { tenantId },
    });

    if (!settings) {
      settings = await prisma.settings.create({
        data: {
          tenant: {
            connect: { id: tenantId },
          },
        },
      });
    }

    return settings;
  }

  async update(data: any, tenantId: string) {
    const existingSettings = await prisma.settings.findUnique({
      where: { tenantId },
    });

    if (!existingSettings) {
      return prisma.settings.create({
        data: {
          ...data,
          tenant: {
            connect: { id: tenantId },
          },
        },
      });
    }

    return prisma.settings.update({
      where: { tenantId },
      data,
    });
  }
}
