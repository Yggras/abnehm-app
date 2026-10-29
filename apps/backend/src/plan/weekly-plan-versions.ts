import { inArray } from 'drizzle-orm';

import { EntityId, Instant, LocalDate, Weekday } from '@abnehm/contracts/base';
import { CreateWeeklyPlanVersion, weeklyPlanDaysOf, WeeklyPlanVersionRecord } from '@abnehm/contracts/plan';

import { policies } from '../authorization/authorization.ts';
import { weeklyPlanDay, weeklyPlanVersion } from '../db/schema/index.ts';
import type { ServerCommand } from '../sync/commands.ts';
import type { ServerSyncEntity } from '../sync/registry.ts';
import { planCommandTarget, savePlanVersion } from './plan-versions.ts';

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
            days: weeklyPlanDaysOf(days.filter((day) => day.weeklyPlanVersionId === version.id)),
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
  target: (operation) => planCommandTarget('wochenplan', operation.businessKey),
  canonicalRequest: (operation) => CreateWeeklyPlanVersion.parse(operation.payload),
  duplicate: () => [],
  async execute(tx, { actor, payload, businessKey, at }) {
    return savePlanVersion(tx, { kind: 'wochenplan', entity: weeklyPlanVersionEntity, personId: actor.personId,
      validFrom: payload.validFrom, businessKey, at, async write(id, serverVersion) {
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
      } });
  },
};
