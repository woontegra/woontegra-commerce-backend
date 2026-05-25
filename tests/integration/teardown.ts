import { disconnectIntegrationDb } from './helpers/db';

export default async function globalTeardown() {
  await disconnectIntegrationDb();
}
