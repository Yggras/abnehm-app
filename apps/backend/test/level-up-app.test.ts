import { describe, expect, it } from 'vitest';

import { EntityId } from '@abnehm/contracts/base';
import { islandEventId } from '@abnehm/contracts/island-records';
import { notificationIntentId } from '@abnehm/contracts/notifications';
import { notificationTexts } from '@abnehm/contracts/notification-texts';

import { energyBooking } from '../src/db/schema/index.ts';
import { correctBooking } from '../src/island/booking-correction.ts';
import { buildOp, fieldKeys } from './support/building.ts';
import { closingField, levelEventsOf, levelIntents, levelUpWorld, type LevelUpWorld } from './support/level-up.ts';
import { pullAll, push } from './support/sync.ts';

// Nachweis für #200 am Server: Levelaufstieg im selben Befehl mit echter Hono-App, isoliertem Postgres und
// Testuhr (Spezifikation 4, Abschnitt 2.2 und Testnaht 2). Anna hat ihre Hälfte gefüllt, Philipp schließt
// mit einer Laterne die Lücke. Der ausgelieferte Katalog hat noch keine Level-Freischaltungen (#214, #217);
// sie prüft `level-up.test.ts` mit dem Test-Katalog.

const levelOccasion = (world: LevelUpWorld, level: number) => `level:${world.islandId}:${level}`;

async function closeTheGap(world: LevelUpWorld) {
  const operation = buildOp({ fieldId: world.fieldId(closingField) });
  const [result] = await push(world.backend, world.actor, [operation]);
  return { operation, result };
}

describe('Levelaufstieg im Baubefehl', { timeout: 60_000 }, () => {
  it('Tracer: Philipps Bau hebt die Insel auf Level 2; Ereignis, je ein Intent an beide und Projektion im selben Befehl', async () => {
    const world = await levelUpWorld();

    const { result } = await closeTheGap(world);

    expect(result).toMatchObject({ type: 'applied' });
    if (result?.type !== 'applied') return;
    const eventId = islandEventId(world.islandId, levelOccasion(world, 2));
    const progress = result.changes?.find((change) => change.entityType === 'island_progress');
    expect(progress).toMatchObject({ type: 'record', data: { level: 2, levelNeed: 12 } });
    expect(result.changes?.find((change) => change.entityType === 'island_event')).toMatchObject({
      type: 'record',
      entityId: eventId,
      data: { type: 'levelaufstieg', occasionKey: levelOccasion(world, 2), status: 'abgeschlossen', responsiblePersonId: null, reward: null },
    });

    const [event] = await levelEventsOf(world);
    expect(event).toMatchObject({ id: eventId, type: 'levelaufstieg' });
    const intents = await levelIntents(world);
    expect(intents.map((intent) => intent.recipientPersonId).sort()).toEqual([world.anna.personId, world.philipp.personId].sort());
    for (const intent of intents) {
      expect(intent).toMatchObject({
        intentId: notificationIntentId({ sourceEventId: eventId, recipientPersonId: EntityId.parse(intent.recipientPersonId), type: 'levelaufstieg' }),
        sourceEventId: eventId,
        messageKey: 'levelaufstieg',
        payload: { level: 2 },
        status: 'offen',
      });
      // Der Text aus Spezifikation 4, Abschnitt 12.
      expect(notificationTexts.renderStored(intent.messageKey, intent.payload)).toEqual({
        type: 'rendered',
        text: { title: 'Momo ist jetzt auf Level 2 🎉', body: 'Das habt ihr gemeinsam geschafft. Schaut auf eurer Insel vorbei.' },
      });
    }
  });

  it('Anna bekommt Ereignis und Projektion mit ihrem nächsten Pull', async () => {
    const world = await levelUpWorld();
    const { changes: before } = await pullAll(world.backend, world.anna.device);
    const cursor = before.at(-1);
    expect(cursor).toBeDefined();

    await closeTheGap(world);

    const { changes } = await pullAll(world.backend, world.anna.device);
    expect(changes.find((change) => change.entityType === 'island_progress')).toMatchObject({ data: { level: 2 } });
    expect(changes.flatMap((change) => (change.entityType === 'island_event' && change.type === 'record' ? [change.data] : []))).toContainEqual(
      expect.objectContaining({ type: 'levelaufstieg', occasionKey: levelOccasion(world, 2) }),
    );
  });

  it('ist idempotent bei Retry: dieselbe Operation erzeugt weder ein zweites Ereignis noch weitere Intents', async () => {
    const world = await levelUpWorld();
    const { operation } = await closeTheGap(world);

    const [retry] = await push(world.backend, world.actor, [operation]);

    expect(retry).toMatchObject({ type: 'already_applied' });
    expect(await levelEventsOf(world)).toHaveLength(1);
    expect(await levelIntents(world)).toHaveLength(2);
  });

  it('weitere Bauten ohne neues Level erzeugen nichts Neues', async () => {
    const world = await levelUpWorld();
    await closeTheGap(world);

    const [result] = await push(world.backend, world.actor, [buildOp({ fieldId: world.fieldId(fieldKeys.philippsRollenbereich), blueprintKey: 'holzweg' })]);

    expect(result).toMatchObject({ type: 'applied' });
    if (result?.type !== 'applied') return;
    expect(result.changes?.map((change) => change.entityType)).toEqual(['island_object', 'energy_booking', 'island_progress']);
    expect(await levelEventsOf(world)).toHaveLength(1);
    expect(await levelIntents(world)).toHaveLength(2);
  });

  it('ein Level, das die Insel nach einer Gegenbuchung erneut erreicht, feiert sie nicht noch einmal', async () => {
    const world = await levelUpWorld();
    const { operation } = await closeTheGap(world);
    const db = world.backend.database.db;
    const [debit] = (await db.select().from(energyBooking)).filter((booking) => booking.bookingKey === operation.payload.commandId);

    // Die Korrektur nimmt Philipps letzte Laterne zurück: Level 1. Eine weitere Laterne erreicht Level 2 wieder.
    const corrected = await db.transaction((tx) => correctBooking(tx, { originalBookingId: EntityId.parse(debit!.id), at: new Date(world.clock.read().instant) }));
    expect(corrected.find((change) => change.entityType === 'island_progress')).toMatchObject({ data: { level: 1 } });
    const [again] = await push(world.backend, world.actor, [buildOp({ fieldId: world.fieldId(fieldKeys.philippsRollenbereich) })]);

    expect(again).toMatchObject({ type: 'applied' });
    if (again?.type !== 'applied') return;
    expect(again.changes?.find((change) => change.entityType === 'island_progress')).toMatchObject({ data: { level: 2 } });
    expect(again.changes?.some((change) => change.entityType === 'island_event')).toBe(false);
    expect(await levelEventsOf(world)).toHaveLength(1);
    expect(await levelIntents(world)).toHaveLength(2);
  });
});
