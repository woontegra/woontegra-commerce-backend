import { describe, it, expect, vi, afterEach } from 'vitest';
import { runWithTrace } from '../../src/common/logging/trace-context';
import { logBusinessEvent } from '../../src/common/logging/business-events';
import * as winstonFactory from '../../src/common/logging/create-winston';

describe('logBusinessEvent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.env.LOG_FILE = 'false';
  });

  it('event, tenantId ve metadata yazar', () => {
    const spy = vi.spyOn(winstonFactory, 'writeStructured');

    runWithTrace({ traceId: 't-1' }, () => {
      logBusinessEvent('xml_sync', 'tenant-1', { sourceId: 'src-1', imported: 2 });
    });

    expect(spy).toHaveBeenCalledWith(
      'info',
      'business',
      expect.objectContaining({
        action:   'xml_sync',
        tenantId: 'tenant-1',
        event:    'xml_sync',
        metadata: { sourceId: 'src-1', imported: 2 },
      }),
    );
  });
});
