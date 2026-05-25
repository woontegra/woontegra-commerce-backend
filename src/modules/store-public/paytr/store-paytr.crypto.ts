import crypto from 'crypto';

export function buildPaytrIframeToken(params: {
  merchantId:     string;
  merchantKey:    string;
  merchantSalt:   string;
  userIp:         string;
  merchantOid:    string;
  email:          string;
  paymentAmount:  string;
  userBasket:     string;
  noInstallment:  string;
  maxInstallment: string;
  currency:       string;
  testMode:       string;
}): string {
  const hashSTR =
    params.merchantId +
    params.userIp +
    params.merchantOid +
    params.email +
    params.paymentAmount +
    params.userBasket +
    params.noInstallment +
    params.maxInstallment +
    params.currency +
    params.testMode;
  const paytrToken = hashSTR + params.merchantSalt;
  return crypto.createHmac('sha256', params.merchantKey).update(paytrToken).digest('base64');
}

export function verifyPaytrCallbackHash(params: {
  merchantKey:  string;
  merchantSalt: string;
  merchantOid:  string;
  status:       string;
  totalAmount:  string;
  hash:         string;
}): boolean {
  const paytrToken = params.merchantOid + params.merchantSalt + params.status + params.totalAmount;
  const token = crypto
    .createHmac('sha256', params.merchantKey)
    .update(paytrToken)
    .digest('base64');
  return token === params.hash;
}
