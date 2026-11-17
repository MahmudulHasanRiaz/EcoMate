import { SecurityEventEmitterService } from './security-event-emitter.service';
import { runWithTenant } from '../../tenancy/tenant-context';

function makeEmitter() {
  const eventQueue = { add: jest.fn().mockResolvedValue({}) } as any;
  const aggregateQueue = { add: jest.fn().mockResolvedValue({}) } as any;
  const emitter = new SecurityEventEmitterService(eventQueue, aggregateQueue);
  return { emitter, eventQueue };
}

const baseInput = {
  eventType: 'failed_login',
  severity: 'LOW',
  category: 'AUTHENTICATION',
  source: 'security_service',
  actorType: 'USER',
  userId: 'user-1',
} as any;

/**
 * Phase 8: impersonated actions must be attributable in the tenant audit
 * trail (SecurityEvent.metadata), instead of looking like the owner's own
 * actions. The stamp comes from the ALS tenant context, which
 * DualModeAuthGuard sets when the request authenticates with an
 * impersonated JWT.
 */
describe('SecurityEventEmitterService impersonation stamping', () => {
  it('stamps impersonation (flag + platform actor) into event metadata', async () => {
    const { emitter, eventQueue } = makeEmitter();
    await runWithTenant(
      {
        tenantId: 'tenant-1',
        slug: 'acme',
        impersonation: { impersonated: true, actor: 'ops@ecomate.bd' },
      },
      () =>
        emitter.emit({
          ...baseInput,
          metadata: { ip: '10.0.0.1' },
        }),
    );

    expect(eventQueue.add).toHaveBeenCalledTimes(1);
    const jobData = eventQueue.add.mock.calls[0][1];
    expect(jobData.metadata).toEqual({
      ip: '10.0.0.1',
      impersonation: { impersonated: true, actor: 'ops@ecomate.bd' },
    });
  });

  it('stamps the flag even when no platform actor identity is present', async () => {
    const { emitter, eventQueue } = makeEmitter();
    await runWithTenant(
      {
        tenantId: 'tenant-1',
        slug: 'acme',
        impersonation: { impersonated: true, actor: null },
      },
      () => emitter.emit(baseInput),
    );

    const jobData = eventQueue.add.mock.calls[0][1];
    expect(jobData.metadata).toEqual({
      impersonation: { impersonated: true },
    });
  });

  it('leaves ordinary (non-impersonated) events unmarked', async () => {
    const { emitter, eventQueue } = makeEmitter();
    await runWithTenant({ tenantId: 'tenant-1', slug: 'acme' }, () =>
      emitter.emit({ ...baseInput, metadata: { ip: '10.0.0.1' } }),
    );

    const jobData = eventQueue.add.mock.calls[0][1];
    expect(jobData.metadata).toEqual({ ip: '10.0.0.1' });
  });

  it('leaves events emitted without any tenant context unmarked', async () => {
    const { emitter, eventQueue } = makeEmitter();
    await emitter.emit(baseInput);

    const jobData = eventQueue.add.mock.calls[0][1];
    expect(jobData.metadata).toEqual({});
  });
});
