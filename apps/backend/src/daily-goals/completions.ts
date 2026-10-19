import { and, asc, eq, inArray } from 'drizzle-orm';

import { EntityId, Instant, ServerVersion } from '@abnehm/contracts/base';
import { dailyGoalCompletionId, DailyGoalCompletionRecord, dailyGoalKey } from '@abnehm/contracts/daily-goals';
import { CompleteDailyGoalPayload, dailyBonusKey, energyBookingId, GrantDailyBonusPayload } from '@abnehm/contracts/energy';
import type { CanonicalRecord } from '@abnehm/contracts/sync';

import { policies } from '../authorization/authorization.ts';
import { dailyGoal, dailyGoalCompletion } from '../db/schema/index.ts';
import { insertBooking } from '../energy/bookings.ts';
import { nextServerVersion, recordChange } from '../sync/change-log.ts';
import { CommandRejection, type ServerCommand } from '../sync/commands.ts';
import type { ServerSyncEntity } from '../sync/registry.ts';

// Tageszielerfüllung plus Gutschrift (`completeDailyGoal`) und Tagesbonus plus Gutschrift
// (`grantDailyBonus`) auf dem Server (Spezifikation 0, Abschnitte 3, 4 und 10). Erzeugt werden beide nur
// vom Persistenzdienst der App. Der Server nimmt sie atomar an; bei gleichem fachlichen Schlüssel
// antwortet der Sync-Kern mit dem gespeicherten kanonischen Ergebnis, und das Gerät ersetzt sein
// Duplikat. IDs leiten App und Server gleich aus dem Schlüssel ab.

/** Sync-Entität der Tageszielerfüllung: nur lesbar, kein generisches Upsert oder Löschen. */
export const dailyGoalCompletionEntity: ServerSyncEntity = {
  entityType: 'daily_goal_completion',
  resource: 'daily_goal_completion',
  upsert: null,
  deletable: false,
  async read(tx, ids) {
    if (ids.length === 0) return new Map();
    const rows = await tx.select().from(dailyGoalCompletion).where(inArray(dailyGoalCompletion.id, [...ids]));
    return new Map(rows.map((row) => [row.id, { serverVersion: row.serverVersion, deletedAt: null, data: recordOf(row) }]));
  },
  async write() {
    throw new Error('Tageszielerfüllungen entstehen nur im Fachbefehl completeDailyGoal');
  },
  async remove() {
    throw new Error('Tageszielerfüllungen sind unveränderlich');
  },
};

export const completeDailyGoalCommand: ServerCommand = {
  type: 'completeDailyGoal',
  identity: 'none',
  policy: policies.resource('daily_goal_completion', 'befehl'),
  payload: CompleteDailyGoalPayload,
  target: (operation) => ({ id: dailyGoalCompletionId(operation.businessKey) }),
  // Der Erfüllungszeitpunkt eines zweiten Geräts ist kein anderer Fachwert: Es gilt der zuerst angenommene.
  canonicalRequest: (operation) => {
    const { dailyGoalId, localDate, slot, baustein } = CompleteDailyGoalPayload.parse(operation.payload);
    return { dailyGoalId, localDate, slot, baustein };
  },
  duplicate: () => [],
  async execute(tx, { actor, payload, businessKey, at }) {
    const input = CompleteDailyGoalPayload.parse(payload);
    const key = dailyGoalKey(actor.personId, input.localDate, input.slot);
    if (businessKey !== key) throw new CommandRejection('invalid_payload');
    const [goal] = await tx.select().from(dailyGoal).where(eq(dailyGoal.id, input.dailyGoalId));
    if (
      goal === undefined ||
      goal.personId !== actor.personId ||
      goal.localDate !== input.localDate ||
      goal.slot !== input.slot ||
      goal.baustein !== input.baustein
    ) {
      throw new CommandRejection('invalid_payload');
    }
    // Der erstmalige Erfüllungszeitpunkt ist ein Fachwert des Geräts; technische Zeitstempel setzt die Clock des Servers.
    const createdAt = Instant.parse(at.toISOString());
    const completion = DailyGoalCompletionRecord.parse({
      id: dailyGoalCompletionId(key),
      dailyGoalId: input.dailyGoalId,
      personId: actor.personId,
      localDate: input.localDate,
      slot: input.slot,
      baustein: input.baustein,
      firstCompletedAt: input.completedAt,
      completionKey: key,
      createdAt,
    });
    const serverVersion = await nextServerVersion(tx);
    await tx.insert(dailyGoalCompletion).values({ ...completion, firstCompletedAt: new Date(input.completedAt), createdAt: at, serverVersion });
    await recordChange(tx, { position: serverVersion, entityType: dailyGoalCompletionEntity.entityType, entityId: completion.id,
      operation: 'upsert', ownerPersonId: actor.personId, createdAt: at });
    const credit = await insertBooking(tx, {
      type: 'daily_goal_credit',
      id: energyBookingId(key),
      personId: actor.personId,
      amount: 1,
      localDate: input.localDate,
      bookingKey: key,
      createdAt,
      trigger: { dailyGoalCompletionId: completion.id, slot: input.slot },
    });
    const record: CanonicalRecord = { type: 'record', entityType: dailyGoalCompletionEntity.entityType, entityId: completion.id,
      serverVersion: ServerVersion.parse(serverVersion.toString()), data: completion };
    return { changes: [record, credit], idMappings: [] };
  },
};

export const grantDailyBonusCommand: ServerCommand = {
  type: 'grantDailyBonus',
  identity: 'none',
  policy: policies.resource('energy_booking', 'befehl'),
  payload: GrantDailyBonusPayload,
  target: (operation) => ({ id: energyBookingId(operation.businessKey) }),
  canonicalRequest: (operation) => GrantDailyBonusPayload.parse(operation.payload),
  duplicate: () => [],
  async execute(tx, { actor, payload, businessKey, at }) {
    const input = GrantDailyBonusPayload.parse(payload);
    const key = dailyBonusKey(actor.personId, input.localDate);
    if (businessKey !== key) throw new CommandRejection('invalid_payload');
    // Der Bonus verlangt alle drei Erfüllungen des Tags; hing eine vom Tagesende ab, gibt es sie erst danach.
    const completions = await tx
      .select({ id: dailyGoalCompletion.id })
      .from(dailyGoalCompletion)
      .where(and(eq(dailyGoalCompletion.personId, actor.personId), eq(dailyGoalCompletion.localDate, input.localDate)))
      .orderBy(asc(dailyGoalCompletion.slot));
    if (completions.length !== 3) throw new CommandRejection('invalid_payload');
    const bonus = await insertBooking(tx, {
      type: 'daily_bonus_credit',
      id: energyBookingId(key),
      personId: actor.personId,
      amount: 1,
      localDate: input.localDate,
      bookingKey: key,
      createdAt: Instant.parse(at.toISOString()),
      trigger: { dailyGoalCompletionIds: completions.map((completion) => EntityId.parse(completion.id)) as [EntityId, EntityId, EntityId] },
    });
    return { changes: [bonus], idMappings: [] };
  },
};

export const dailyGoalCommands: readonly ServerCommand[] = [completeDailyGoalCommand, grantDailyBonusCommand];

function recordOf(row: typeof dailyGoalCompletion.$inferSelect): DailyGoalCompletionRecord {
  const { id, dailyGoalId, personId, localDate, slot, baustein, completionKey } = row;
  return DailyGoalCompletionRecord.parse({
    id,
    dailyGoalId,
    personId,
    localDate,
    slot,
    baustein,
    firstCompletedAt: row.firstCompletedAt.toISOString(),
    completionKey,
    createdAt: row.createdAt.toISOString(),
  });
}
