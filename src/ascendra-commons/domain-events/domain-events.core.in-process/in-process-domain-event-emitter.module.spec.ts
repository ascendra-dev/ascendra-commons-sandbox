import { describe, expect, it } from 'vitest';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import {
  DomainEventsModule,
  OnCriticalEvent,
  DOMAIN_EVENT_EMITTER,
  EVENT_LISTENER_CATALOG_PORT,
} from '../domain-events.core';
import type { DomainEvent, DomainEventEmitter, EventDeliveryAttempt, EventDeliveryRecorder } from '../domain-events.core';
import { InProcessDomainEventEmitterModule } from './in-process-domain-event-emitter.module';
import { InProcessDomainEventEmitter } from './in-process-domain-event-emitter.service';
import { DomainEventListenerCatalog } from './domain-event-listener-catalog.service';
import { IN_PROCESS_DOMAIN_EVENT_EMITTER } from './tokens';

class TestEvent implements DomainEvent {
  readonly occurredAt = new Date();
  constructor(public readonly value: string) {}
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
class TestListener {
  received: TestEvent[] = [];
  criticalReceived: TestEvent[] = [];
  secondCriticalRan: TestEvent[] = [];
  plainCritical: TestEvent[] = [];

  @OnEvent('test.happened')
  onTestHappened(event: TestEvent) {
    this.received.push(event);
  }

  @OnCriticalEvent('test.critical')
  async onTestCritical(event: TestEvent) {
    if (event.value === 'reject-me') throw new Error('listener failed on purpose');
    this.criticalReceived.push(event);
  }

  @OnCriticalEvent('test.critical')
  async onTestCriticalSecond(event: TestEvent) {
    this.secondCriticalRan.push(event);
  }

  @OnEvent('test.critical.plain')
  async onTestCriticalPlain(event: TestEvent) {
    if (event.value === 'reject-me') throw new Error('this should be swallowed by NestJS');
    this.plainCritical.push(event);
  }
}

async function build() {
  const moduleRef = await Test.createTestingModule({
    imports: [
      DomainEventsModule.forRoot({
        emitterToken: IN_PROCESS_DOMAIN_EVENT_EMITTER,
        imports: [InProcessDomainEventEmitterModule.forRoot()],
      }),
    ],
    providers: [TestListener],
  }).compile();
  await moduleRef.init(); // EventSubscribersLoader.onApplicationBootstrap scans decorators
  return moduleRef;
}

describe('InProcessDomainEventEmitterModule wired into DomainEventsModule — real DI + @OnEvent wiring', () => {
  it('DOMAIN_EVENT_EMITTER resolves to the in-process emitter', async () => {
    expect((await build()).get(DOMAIN_EVENT_EMITTER)).toBeInstanceOf(InProcessDomainEventEmitter);
  });

  it('emit() reaches a real @OnEvent()-decorated listener', async () => {
    const moduleRef = await build();
    moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER).emit('test.happened', new TestEvent('hello'));
    await wait(0);
    expect(moduleRef.get(TestListener).received[0]?.value).toBe('hello');
  });

  it('emitCritical() propagates an @OnCriticalEvent() listener rejection', async () => {
    const emitter = (await build()).get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER);
    await expect(emitter.emitCritical('test.critical', new TestEvent('reject-me'))).rejects.toThrow(
      'listener failed on purpose',
    );
  });

  it('emitCritical() resolves when the listener succeeds', async () => {
    const moduleRef = await build();
    await moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER).emitCritical('test.critical', new TestEvent('ok'));
    expect(moduleRef.get(TestListener).criticalReceived).toHaveLength(1);
  });

  it('with two @OnCriticalEvent() listeners, one throwing, emitCritical() still rejects and the other still ran', async () => {
    const moduleRef = await build();
    await expect(
      moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER).emitCritical('test.critical', new TestEvent('reject-me')),
    ).rejects.toThrow();
    expect(moduleRef.get(TestListener).secondCriticalRan).toHaveLength(1);
  });

  it('the gotcha, verified: a plain @OnEvent() listener\'s failure is swallowed and never reaches emitCritical()\'s caller', async () => {
    const moduleRef = await build();
    await expect(
      moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER).emitCritical('test.critical.plain', new TestEvent('reject-me')),
    ).resolves.toBeUndefined();
    expect(moduleRef.get(TestListener).plainCritical).toHaveLength(0);
  });

  it('{ global: false }: EventEmitter2 is not injectable by a module that never imported this one', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [] }).compile();
    expect(() => moduleRef.get(EventEmitter2, { strict: true })).toThrow();
  });

  it('EVENT_LISTENER_CATALOG_PORT resolves and discovers the real @OnEvent()/@OnCriticalEvent() bindings above', async () => {
    const moduleRef = await build();
    const entries = await moduleRef.get(EVENT_LISTENER_CATALOG_PORT).list();

    expect(entries).toContainEqual({
      eventName: 'test.happened',
      listenerClass: 'TestListener',
      listenerMethod: 'onTestHappened',
      critical: false,
    });
    expect(entries).toContainEqual({
      eventName: 'test.critical',
      listenerClass: 'TestListener',
      listenerMethod: 'onTestCritical',
      critical: true,
    });
  });

  it('EVENT_LISTENER_CATALOG_PORT is DomainEventListenerCatalog', async () => {
    expect((await build()).get(EVENT_LISTENER_CATALOG_PORT)).toBeInstanceOf(DomainEventListenerCatalog);
  });

  it('forRoot({ recorderToken }) wires a real recorder — the emitter logs deliveries through it', async () => {
    class FakeRecorder implements EventDeliveryRecorder {
      readonly attempts: EventDeliveryAttempt[] = [];
      async recordDelivery(attempt: EventDeliveryAttempt): Promise<void> {
        this.attempts.push(attempt);
      }
    }
    const FAKE_RECORDER_TOKEN = Symbol('FAKE_RECORDER_TOKEN');

    const moduleRef = await Test.createTestingModule({
      imports: [
        DomainEventsModule.forRoot({
          emitterToken: IN_PROCESS_DOMAIN_EVENT_EMITTER,
          imports: [
            InProcessDomainEventEmitterModule.forRoot({
              recorderToken: FAKE_RECORDER_TOKEN,
              imports: [{ module: class FakeRecorderModule {}, providers: [{ provide: FAKE_RECORDER_TOKEN, useClass: FakeRecorder }], exports: [FAKE_RECORDER_TOKEN] }],
            }),
          ],
        }),
      ],
      providers: [TestListener],
    }).compile();
    await moduleRef.init();

    moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER).emit('test.happened', new TestEvent('hello'), 'corr-1');
    await wait(0);

    const recorder = moduleRef.get<FakeRecorder>(FAKE_RECORDER_TOKEN);
    expect(recorder.attempts).toEqual([
      expect.objectContaining({ eventName: 'test.happened', status: 'delivered', correlationId: 'corr-1' }),
    ]);
  });
});
