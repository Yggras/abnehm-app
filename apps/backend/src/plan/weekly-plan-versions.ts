import { inArray } from 'drizzle-orm';

import { BausteinKey, EntityId, Instant, LocalDate, Weekday } from '@abnehm/contracts/base';
import { CreateWeeklyPlanVersion, planVersionOfKey, weeklyPlanVersionId, WeeklyPlanVersionRecord, type WeeklyPlanDays } from '@abnehm/contracts/plan';

import { policies } from '../authorization/authorization.ts';
import { weeklyPlanDay, weeklyPlanVersion } from '../db/schema/index.ts';
import { invalidatePartnerSummaries } from '../partner-projections/invalidations.ts';
import { nextServerVersion, recordChange } from '../sync/change-log.ts';
import { CommandRejection, type ServerCommand } from '../sync/commands.ts';
import type { ServerSyncEntity } from '../sync/registry.ts';
import { canonicalAfterWrite } from '../sync/sync.ts';
import { planCommandTarget } from './plan-keys.ts';

// Wochenplanversion auf dem Server (Spezifikation 1, Abschnitte 4 und 11): eine Zeile samt ihren sieben
// Wochentagen mit je drei verschiedenen, geordneten Bausteinen. Sie entsteht nur über den Fachbefehl
// `createWeeklyPlanVersion`; eine weitere Fassung desselben Tags ersetzt Zeile und Tage.

export const weeklyPlanVersionEntity: ServerSyncEntity = {
  entityType: 'weekly_plan_version',
  resource: 'weekly_plan_version',
  upsert: null,
  deletable: false,
  async read(tx, ids) {
    if (ids.length === 0) return new Map();
    const versions = await tx.select().from(weeklyPlanVersion).where(inArray(weeklyPlanVersion.id, [...ids]));
    const days = await tx.select().from(weeklyPlanDay).where(inArray(weeklyPlanDay.weeklyPlanVersionId, versions.map((version) => version.id)));
    return new Map(
      versions.map((version) => [
        version.id,
        {
          serverVersion: version.serverVersion,
          deletedAt: version.deletedAt,
          data: WeeklyPlanVersionRecord.parse({
            validFrom: LocalDate.parse(version.validFrom),
            days: daysOf(days.filter((day) => day.weeklyPlanVersionId === version.id)),
            personId: EntityId.parse(version.personId),
            createdAt: Instant.parse(version.createdAt.toISOString()),
            updatedAt: Instant.parse(version.updatedAt.toISOString()),
          }),
        },
      ]),
    );
  },
  async write() {
    throw new Error('Wochenplanversionen entstehen nur im Fachbefehl createWeeklyPlanVersion');
  },
  async remove() {
    throw new Error('Wochenplanversionen werden nicht gelöscht');
  },
};

export const createWeeklyPlanVersionCommand: ServerCommand<CreateWeeklyPlanVersion> = {
  type: 'createWeeklyPlanVersion',
  identity: 'none',
  policy: policies.resource('weekly_plan_version', 'befehl'),
  payload: CreateWeeklyPlanVersion,
  target: (operation) => planCommandTarget('wochenplan', operation.businessKey, weeklyPlanVersionId),
  canonicalRequest: (operation) => CreateWeeklyPlanVersion.parse(operation.payload),
  duplicate: () => [],
  async execute(tx, { actor, payload, businessKey, at }) {
    const key = planVersionOfKey('wochenplan', businessKey);
    if (key === null || key.validFrom !== payload.validFrom) throw new CommandRejection('invalid_payload');
    const id = weeklyPlanVersionId(actor.personId, payload.validFrom);
    const serverVersion = await nextServerVersion(tx);
    await tx
      .insert(weeklyPlanVersion)
      .values({ id, personId: actor.personId, validFrom: payload.validFrom, createdAt: at, updatedAt: at, serverVersion })
      .onConflictDoUpdate({ target: weeklyPlanVersion.id, set: { updatedAt: at, serverVersion } });
    for (const weekday of Weekday.options) {
      const [baustein1, baustein2, baustein3] = payload.days[weekday];
      await tx
        .insert(weeklyPlanDay)
        .values({ weeklyPlanVersionId: id, personId: actor.personId, weekday, baustein1, baustein2, baustein3 })
        .onConflictDoUpdate({ target: [weeklyPlanDay.weeklyPlanVersionId, weeklyPlanDay.weekday], set: { baustein1, baustein2, baustein3 } });
    }
    await recordChange(tx, { position: serverVersion, entityType: weeklyPlanVersionEntity.entityType, entityId: id, operation: 'upsert',
      ownerPersonId: actor.personId, createdAt: at });
    // Der Wochenplan bestimmt die Sporttage und damit, was in die Partner-Zusammenfassungen eingeht.
    await invalidatePartnerSummaries(tx, { type: 'plan', ownerPersonId: actor.personId, validFrom: payload.validFrom }, at);
    return { changes: [await canonicalAfterWrite(tx, weeklyPlanVersionEntity, id)], idMappings: [] };
  },
};

function daysOf(rows: readonly (typeof weeklyPlanDay.$inferSelect)[]): WeeklyPlanDays {
  return Object.fromEntries(
    rows.map((row) => [Weekday.parse(row.weekday), [BausteinKey.parse(row.baustein1), BausteinKey.parse(row.baustein2), BausteinKey.parse(row.baustein3)]]),
  ) as WeeklyPlanDays;
}
