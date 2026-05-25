export type TenantShippingSettingsView = {
  isActive:              boolean;
  displayName:           string;
  standardShippingCost:  number;
  freeShippingThreshold: number | null;
  description:           string | null;
};

export type StoreShippingCalculateItem = {
  productId:  string;
  variantId?: string | null;
  quantity:   number;
};

export type StoreShippingCalculateResult = {
  success: true;
  subtotal: number;
  shipping: {
    method:                'STANDARD';
    displayName:           string;
    shippingTotal:         number;
    freeShippingApplied:   boolean;
    freeShippingThreshold: number | null;
  };
  fees: {
    cashOnDeliveryFee: number;
  };
  grandTotal: number;
};
