import { Meilisearch } from 'meilisearch';
import { logger } from './logger';

const host   = process.env.MEILISEARCH_HOST   || 'http://127.0.0.1:7700';
const apiKey = process.env.MEILISEARCH_API_KEY || 'masterKey';

export const meiliClient = new Meilisearch({ host, apiKey });

export async function pingMeilisearch(): Promise<boolean> {
  try {
    await meiliClient.health();
    logger.info({ message: '[Meilisearch] Connected', host });
    return true;
  } catch {
    logger.warn({ message: '[Meilisearch] Not reachable — search features disabled', host });
    return false;
  }
}
