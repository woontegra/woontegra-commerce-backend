import { describe, it, expect } from 'vitest';
import { normalizeLogRecord } from '../../src/common/logging/normalize';
import { runWithTrace } from '../../src/common/logging/trace-context';

describe('normalizeLogRecord', () => {
  it('standart alanları üretir', () => {
    const r = normalizeLogRecord('info', 'auth', {
      action:   'login',
      status:   'success',
      tenantId: 't1',
      userId:   'u1',
      message:  'User logged in',
    });

    expect(r.module).toBe('auth');
    expect(r.action).toBe('login');
    expect(r.status).toBe('success');
    expect(r.tenantId).toBe('t1');
    expect(r.userId).toBe('u1');
    expect(r.timestamp).toBeTruthy();
  });

  it('trace context traceId ekler', () => {
    runWithTrace({ traceId: 'trace-abc-123' }, () => {
      const r = normalizeLogRecord('info', 'app', { action: 'test', message: 'ok' });
      expect(r.traceId).toBe('trace-abc-123');
    });
  });

  it('Error nesnesinden stack trace çıkarır', () => {
    const err = new Error('boom');
    const r = normalizeLogRecord('error', 'billing', {
      action: 'checkout',
      error:  err,
    });

    expect(r.stack).toContain('boom');
    expect(r.errorMessage).toBe('boom');
    expect(r.status).toBe('failure');
  });
});
