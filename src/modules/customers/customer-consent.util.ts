export type CustomerConsentInput = {
  kvkkConsent:      boolean;
  marketingConsent: boolean;
};

export function consentFieldsForCreate(input: CustomerConsentInput, now = new Date()) {
  return {
    kvkkConsent:         input.kvkkConsent,
    kvkkConsentAt:       input.kvkkConsent ? now : null,
    marketingConsent:    input.marketingConsent,
    marketingConsentAt:  input.marketingConsent ? now : null,
  };
}

export function consentFieldsForUpdate(
  existing: {
    kvkkConsent:        boolean;
    kvkkConsentAt:      Date | null;
    marketingConsent:   boolean;
    marketingConsentAt: Date | null;
  },
  input: CustomerConsentInput,
  now = new Date(),
) {
  const data: {
    kvkkConsent?:        boolean;
    kvkkConsentAt?:      Date | null;
    marketingConsent?:   boolean;
    marketingConsentAt?: Date | null;
  } = {};

  if (input.kvkkConsent && !existing.kvkkConsent) {
    data.kvkkConsent    = true;
    data.kvkkConsentAt  = now;
  }

  if (input.marketingConsent && !existing.marketingConsent) {
    data.marketingConsent   = true;
    data.marketingConsentAt = now;
  }

  return data;
}
