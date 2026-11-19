import { describe, expect, it } from 'vitest';

import { ServerPushData } from '@abnehm/contracts/notifications';

import { pullAll } from './support/sync.ts';
import { attemptsOf, encourage, intentStatus, minutes, nowOf, pushWorld } from './support/push-delivery.ts';

// Push-Zusteller (Spezifikation 5, Abschnitt 9 und Testing Decisions; #142) mit isoliertem Postgres,
// echter Hono-App, Testuhr und Fake-Expo-Push-Port.

describe('Push-Zusteller', () => {
  it('Tracer Bullet: Philipp feuert Anna an; ihr iPhone erhält den Push, nach der Quittung ist er zugestellt', async () => {
    const world = await pushWorld();
    const { backend, clock, fake } = world;
    const { encouragementId, intentId } = await encourage(world);

    await backend.pushDelivery.deliverDue(nowOf(clock));

    expect(fake.reached()).toEqual([
      {
        to: 'ExponentPushToken[anna-iphone]',
        title: 'Philipp feuert dich an',
        body: 'Gemeinsam für Momo 🐣',
        data: { intentId, target: { type: 'partner', focus: 'received_encouragement' } },
        ttl: 86_400,
        channelId: 'partner_momo',
        interruptionLevel: 'active',
      },
    ]);
    expect(ServerPushData.safeParse(fake.reached()[0]!.data).success).toBe(true);
    expect(await attemptsOf(backend, intentId)).toMatchObject([{ status: 'gesendet', attemptCount: 1 }]);
    expect(await intentStatus(backend, intentId)).toBe('offen');

    // Quittungen frühestens 15 Minuten nach dem Senden.
    clock.advanceBy(minutes(15) - 1);
    await backend.pushDelivery.processReceipts(nowOf(clock));
    expect(fake.receiptRequests).toEqual([]);

    clock.advanceBy(1);
    await backend.pushDelivery.processReceipts(nowOf(clock));
    expect(fake.receiptRequests).toHaveLength(1);
    expect(await attemptsOf(backend, intentId)).toMatchObject([{ status: 'quittiert' }]);
    expect(await intentStatus(backend, intentId)).toBe('zugestellt');

    // Der Endstatus steht auf der Anfeuerung und kommt per Pull an.
    const pulled = (await pullAll(backend, world.philipp.device)).changes.find((change) => change.entityId === encouragementId);
    expect(pulled).toMatchObject({ type: 'record', data: { pushStatus: 'zugestellt' } });
  });
});
