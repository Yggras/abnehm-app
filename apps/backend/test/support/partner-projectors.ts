import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import { EntityId, LocalDate, type MealKey } from '@abnehm/contracts/base';
import { EffectivePlan, type PlanReader } from '@abnehm/contracts/ports';

import type { DbExecutor } from '../../src/database.ts';
import { nutritionEntry, sportEntry, waterEntry, weightEntry } from '../../src/db/schema/index.ts';
import type { PartnerSummaryProjector, ReaderPort } from '../../src/partner-projections/projector.ts';
import type { ConformanceRecorders } from './partner-projector-conformance.ts';

// Testgerüst für den Projektionsmechanismus (#106) und das Konformitäts-Testkit: der `PlanReader`-Fake,
// Schreiber für die Bereichsdaten und ein Test-Projector für Ernährung, bis Spezifikation 2 den echten
// liefert. Wasser, Sport und Gewicht haben seit #181 ihre echten Projectors.

const now = new Date('2026-10-14T12:00:00.000Z');
const stamps = { createdAt: now, updatedAt: now, serverVersion: 1n };
const dayOf = (localDate: string) => ({ localDate, timeZone: 'Europe/Berlin', utcOffsetMinutes: 120 });

export type TestPlan = Readonly<{ validFrom: string; waterTargetMl: number; weeklySportTargetMinutes: number }>;

/**
 * `PlanReader` im Speicher, wie ihn Spezifikation 1 auf Postgres liefert: je Tag die Fassung mit dem
 * größten `validFrom` ≤ Tag. `set` legt eine Fassung an oder ersetzt die mit demselben `validFrom`.
 */
export function testPlans() {
  const versions = new Map<string, TestPlan[]>();
  const reader: PlanReader = {
    async effectivePlan(personId, localDate) {
      const plan = (versions.get(personId) ?? [])
        .filter((version) => version.validFrom <= localDate)
        .reduce<TestPlan | undefined>((best, version) => (best === undefined || version.validFrom > best.validFrom ? version : best), undefined);
      if (plan === undefined) return EffectivePlan.parse({ type: 'leer', localDate });
      return EffectivePlan.parse({
        type: 'gueltig',
        localDate,
        goal: {
          id: randomUUID(),
          validFrom: plan.validFrom,
          calorieBudgetMilliKcal: 1_800_000,
          lowerBoundMilliKcal: 1_200_000,
          maintenanceReason: null,
          pace: 'entspannt',
          goalWeightG: 70_000,
          waterTargetMl: plan.waterTargetMl,
          weeklySportTargetMinutes: plan.weeklySportTargetMinutes,
        },
        weeklyPlanDay: { weeklyPlanVersionId: randomUUID(), validFrom: plan.validFrom, bausteine: ['gewogen', 'wasserziel', 'sporteinheit'] },
      });
    },
  };
  return {
    set(personId: string, plan: TestPlan) {
      versions.set(personId, [...(versions.get(personId) ?? []).filter((version) => version.validFrom !== plan.validFrom), plan]);
    },
    planReader: (() => reader) satisfies ReaderPort<PlanReader>,
  };
}

export function testNutritionProjector(): PartnerSummaryProjector<'ernaehrung'> {
  return {
    area: 'ernaehrung',
    async project(tx, { ownerPersonId, period }) {
      const rows = await tx
        .selectDistinct({ meal: nutritionEntry.meal })
        .from(nutritionEntry)
        .where(and(eq(nutritionEntry.personId, ownerPersonId), eq(nutritionEntry.localDate, period.localDate), isNull(nutritionEntry.deletedAt)));
      return { recordedMealCategories: rows.length };
    },
  };
}

/** Schreibt die Bereichsdaten für das Konformitäts-Testkit direkt in Postgres. */
export const testRecorders: ConformanceRecorders = {
  ernaehrung: {
    async meal(tx, ownerPersonId, localDate, meal: MealKey, { deleted = false } = {}) {
      await insertNutritionEntry(tx, ownerPersonId, localDate, meal, deleted ? now : null);
    },
  },
  wasser: {
    async water(tx, ownerPersonId, localDate, amountMl) {
      await tx.insert(waterEntry).values({ id: randomUUID(), personId: ownerPersonId, amountMl, origin: 'manuell', loggedAt: now, ...dayOf(localDate), ...stamps });
    },
  },
  sport: {
    async session(tx, ownerPersonId, localDate, durationMinutes, { counted = true } = {}) {
      const id = randomUUID();
      // Ein nicht zählender Eintrag ist hier ein ausgeblendeter Import.
      const origin = counted
        ? { origin: 'manuell' }
        : { origin: 'apple_health', externalKey: `import-${id}`, sourceAppId: 'com.apple.health', sourceAppName: 'Health', hiddenAt: now };
      await tx.insert(sportEntry).values({ id, personId: ownerPersonId, activityType: 'laufen', startedAt: now, durationMinutes, ...origin, ...dayOf(localDate), ...stamps });
    },
  },
  gewicht: {
    async weighIn(tx, ownerPersonId, localDate, weightG) {
      await tx.insert(weightEntry).values({ id: randomUUID(), personId: ownerPersonId, weightG, measuredAt: now, origin: 'manuell', ...dayOf(localDate), ...stamps });
    },
  },
};

async function insertNutritionEntry(tx: DbExecutor, personId: string, localDate: string, meal: MealKey, deletedAt: Date | null) {
  await tx.insert(nutritionEntry).values({
    id: EntityId.parse(randomUUID()),
    personId,
    consumedAt: now,
    ...dayOf(LocalDate.parse(localDate)),
    meal,
    captureMethod: 'suche',
    foodRefType: 'bls',
    foodRefKey: 'C133000',
    baseAmount: 100_000,
    displayUnit: 'g',
    displayAmountMilli: 100_000,
    snapshotName: 'Haferflocken',
    snapshotBaseUnit: 'g',
    snapshotReferenceAmount: 100_000,
    snapshotMilliKcal: 370_000,
    snapshotProteinMg: 13_000,
    snapshotCarbsMg: 59_000,
    snapshotFatMg: 7_000,
    snapshotPortions: [],
    snapshotSource: 'bls',
    totalMilliKcal: 370_000,
    totalProteinMg: 13_000,
    totalCarbsMg: 59_000,
    totalFatMg: 7_000,
    ...stamps,
    deletedAt,
  });
}
