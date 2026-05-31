export type BillingPlan = 'STARTER' | 'PRO' | 'ENTERPRISE';

/** TRIAL < STARTER < PRO (Professional) < ENTERPRISE */
export const PLAN_RANK: Record<BillingPlan, number> = {
  STARTER:    1,
  PRO:        2,
  ENTERPRISE: 3,
};

/** Backend / admin panel plan kodlarını normalize eder. */
export function normalizeBillingPlan(value: unknown): BillingPlan {
  const raw = String(value ?? '')
    .toUpperCase()
    .trim()
    .replace(/İ/g, 'I');

  if (
    raw === 'PRO'
    || raw === 'PROFESSIONAL'
    || raw === 'PROFESIONEL'
    || raw === 'PROFESSIONEL'
  ) {
    return 'PRO';
  }
  if (raw === 'ENTERPRISE') return 'ENTERPRISE';
  if (raw === 'STARTER' || raw === 'TRIAL') return 'STARTER';
  return 'STARTER';
}

/** Üst plan alt plan özelliklerine erişir (Enterprise >= Professional >= Starter). */
export function hasPlanAccess(currentPlan: unknown, requiredPlan: BillingPlan): boolean {
  const current = normalizeBillingPlan(currentPlan);
  return PLAN_RANK[current] >= PLAN_RANK[requiredPlan];
}
