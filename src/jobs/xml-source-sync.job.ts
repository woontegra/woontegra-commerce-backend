import cron from 'node-cron';
import { xmlLogger } from '../common/logging/loggers';
import { syncAllActiveXmlSources } from '../modules/xml-sources/xml-source.service';

/**
 * Aktif XML kaynaklarını periyodik senkronlar.
 * Ölçek: tenant başına sıralı iş; yoğun ortamda kuyruk (Bull) ile değiştirilebilir.
 */
export function startXmlSourceSyncJob(): void {
  // We tick frequently and let DB-stored schedules decide which sources are due.
  // Default: every minute.
  const schedule = process.env.XML_SOURCE_CRON_SCHEDULE ?? '* * * * *';
  cron.schedule(schedule, async () => {
    try {
      const r = await syncAllActiveXmlSources();
      xmlLogger.info({ action: 'cron_tick', status: 'success', ...r });
    } catch (e: any) {
      xmlLogger.error({ action: 'cron_tick', status: 'failure', error: e });
    }
  });
  xmlLogger.info({ action: 'cron_scheduled', status: 'success', schedule });
}
