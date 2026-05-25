import prisma from '../config/database';

/**
 * Tenant’ta en az bir ürün varsa, o tenant’taki tüm kullanıcıların onboarding’ini tamamlar.
 * (Manuel / XML / CSV / API ürün oluşturma sonrası çağrılır.)
 */
export async function syncOnboardingCompletionForTenant(tenantId: string): Promise<void> {
  const pendingUsers = await prisma.user.count({
    where: { tenantId, onboardingCompleted: false },
  });
  if (pendingUsers === 0) return;

  const count = await prisma.product.count({ where: { tenantId } });
  if (count < 1) return;

  await prisma.user.updateMany({
    where: { tenantId, onboardingCompleted: false },
    data: {
      onboardingCompleted: true,
      onboardingStep:      4,
    },
  });
}
