import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DomainEventsModule } from './domain-events.module';
import type { DomainEventEmitter } from './domain-event-emitter.port';
import { DOMAIN_EVENT_EMITTER } from './tokens';

const FAKE_EMITTER = Symbol('FAKE_EMITTER');

const emit = vi.fn();
const emitCritical = vi.fn().mockResolvedValue(undefined);

@Module({
  providers: [{ provide: FAKE_EMITTER, useValue: { emit, emitCritical } satisfies DomainEventEmitter }],
  exports: [FAKE_EMITTER],
})
class FakeEmitterModule {}

describe('DomainEventsModule.forRoot — token wiring', () => {
  it('throws without emitterToken', () => {
    // @ts-expect-error — deliberately omitting the required field
    expect(() => DomainEventsModule.forRoot({})).toThrow(/requires emitterToken/);
  });

  it('aliases DOMAIN_EVENT_EMITTER to emitterToken from imports', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DomainEventsModule.forRoot({ emitterToken: FAKE_EMITTER, imports: [FakeEmitterModule] })],
    }).compile();

    const emitter = moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER);
    emitter.emit('x.happened', { occurredAt: new Date() });
    await emitter.emitCritical('x.happened', { occurredAt: new Date() });

    expect(emit).toHaveBeenCalledWith('x.happened', expect.anything());
    expect(emitCritical).toHaveBeenCalled();
  });

  it('re-exports DOMAIN_EVENT_EMITTER so an importing feature module can inject it', async () => {
    @Module({})
    class FeatureModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        DomainEventsModule.forRoot({ emitterToken: FAKE_EMITTER, imports: [FakeEmitterModule] }),
        FeatureModule,
      ],
    }).compile();

    expect(moduleRef.get(DOMAIN_EVENT_EMITTER)).toBeDefined();
  });
});
