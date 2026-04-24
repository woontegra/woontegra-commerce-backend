export enum Plan {
  STARTER = 'STARTER',
  PRO = 'PRO',
  ENTERPRISE = 'ENTERPRISE',
}

export interface PlanLimits {
  maxProducts: number;
  maxVariantsPerProduct: number;
  pageBuilderAccess: boolean;
  blogAccess: boolean;
  analyticsAccess: boolean;
  customDomain: boolean;
  prioritySupport: boolean;
}

export const PLAN_CONFIG: Record<Plan, PlanLimits> = {
  [Plan.STARTER]: {
    maxProducts: 50,
    maxVariantsPerProduct: 3,
    pageBuilderAccess: false,
    blogAccess: false,
    analyticsAccess: false,
    customDomain: false,
    prioritySupport: false,
  },
  [Plan.PRO]: {
    maxProducts: 500,
    maxVariantsPerProduct: 10,
    pageBuilderAccess: true,
    blogAccess: true,
    analyticsAccess: true,
    customDomain: false,
    prioritySupport: false,
  },
  [Plan.ENTERPRISE]: {
    maxProducts: -1, // Unlimited
    maxVariantsPerProduct: -1, // Unlimited
    pageBuilderAccess: true,
    blogAccess: true,
    analyticsAccess: true,
    customDomain: true,
    prioritySupport: true,
  },
};

export const PLAN_NAMES = {
  [Plan.STARTER]: 'Starter',
  [Plan.PRO]: 'Pro',
  [Plan.ENTERPRISE]: 'Enterprise',
};

/** USD prices (legacy, kept for reference) */
export const PLAN_PRICES = {
  [Plan.STARTER]:    { monthly: 0,   yearly: 0    },
  [Plan.PRO]:        { monthly: 49,  yearly: 490  },
  [Plan.ENTERPRISE]: { monthly: 199, yearly: 1990 },
};

/** TRY prices — used by the iyzico billing module */
export const PLAN_PRICES_TRY = {
  [Plan.STARTER]:    { monthly: 0,    yearly: 0     },
  [Plan.PRO]:        { monthly: 599,  yearly: 5990  },
  [Plan.ENTERPRISE]: { monthly: 1299, yearly: 12990 },
};

export function getPlanLimits(plan: Plan): PlanLimits {
  return PLAN_CONFIG[plan];
}

export function canAccessFeature(plan: Plan, feature: keyof PlanLimits): boolean {
  const limits = getPlanLimits(plan);
  return limits[feature] as boolean;
}

export function isWithinLimit(plan: Plan, limitType: 'maxProducts' | 'maxVariantsPerProduct', currentCount: number): boolean {
  const limits = getPlanLimits(plan);
  const limit = limits[limitType];
  
  // -1 means unlimited
  if (limit === -1) return true;
  
  return currentCount < limit;
}
