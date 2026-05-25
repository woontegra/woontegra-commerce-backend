import type { CreateStoreOrderInput } from './src/modules/store-public/store-order.dto';
type SA = CreateStoreOrderInput['shippingAddress'];
type BA = CreateStoreOrderInput['billingAddress'];
const _sa: SA = { fullName: 'a', phone: 'b', city: 'c', district: 'd', addressLine: 'e' };
