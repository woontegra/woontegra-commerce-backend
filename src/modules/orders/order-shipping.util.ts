const SHIPPING_TEXT_MAX = 200;
const SHIPPING_URL_MAX = 2048;

export type OrderShippingInput = {
  shippingCarrier?:         string | null;
  shippingTrackingNumber?:  string | null;
  shippingTrackingUrl?:     string | null;
};

export function sanitizeShippingTrackingUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim() ?? '';
  if (!trimmed) return null;
  if (trimmed.length > SHIPPING_URL_MAX) {
    throw new Error('Takip linki çok uzun (en fazla 2048 karakter).');
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('Takip linki http:// veya https:// ile başlamalıdır.');
  }
  return trimmed;
}

export function normalizeShippingInput(input: OrderShippingInput): {
  shippingCarrier:        string | null;
  shippingTrackingNumber: string | null;
  shippingTrackingUrl:    string | null;
} {
  const carrier = input.shippingCarrier?.trim().slice(0, SHIPPING_TEXT_MAX) || null;
  const tracking = input.shippingTrackingNumber?.trim().slice(0, SHIPPING_TEXT_MAX) || null;
  const url = input.shippingTrackingUrl
    ? sanitizeShippingTrackingUrl(input.shippingTrackingUrl)
    : null;

  return {
    shippingCarrier:        carrier,
    shippingTrackingNumber: tracking,
    shippingTrackingUrl:    url,
  };
}
