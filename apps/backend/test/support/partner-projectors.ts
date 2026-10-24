import { randomUUID } from 'node:crypto';

import { and, between, eq, gte, isNull, lte } from 'drizzle-orm';

import { EntityId, LocalDate, type MealKey } from '@abnehm/contracts/base';
import { EffectivePlan, type PlanReader } from '@abnehm/contracts/ports';

import type { DbExecutor } from '../../src/database.ts';
import { nutritionEntry, sportEntry, waterEntry, weightEntry } from '../../src/db/schema/index.ts';
import type { PartnerSummaryProjector, ReaderPort } from '../../src/partner-projections/projector.ts';
import type { ConformanceRecorders } from './partner-projector-conformance.ts';

// Test-Projectors für den Projektionsmechanismus (#106) und das Konformitäts-Testkit. Die echten
// Projectors liefern Spezifikation 2 (`ernaehrung`) und 3 (`wasser`, `sport`, `gewicht`); diese hier
// rechnen bewusst schlicht, lesen aber wie dort nur die Tabelle ihres Bereichs und den `PlanReader`.

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

type Ports = { planReader: ReaderPort<PlanReader> };

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

export function testWaterProjector({ planReader }: Ports): PartnerSummaryProjector<'wasser'> {
  return {
    area: 'wasser',
    async project(tx, { ownerPersonId, period }) {
      const plan = await planReader(tx).effectivePlan(ownerPersonId, period.localDate);
      const rows = await tx
        .select({ amountMl: waterEntry.amountMl })
        .from(waterEntry)
        .where(and(eq(waterEntry.personId, ownerPersonId), eq(waterEntry.localDate, period.localDate), isNull(waterEntry.deletedAt)));
      const ml = rows.reduce((sum, row) => sum + row.amountMl, 0);
      if (plan.type === 'leer') return { progressPercent: 0 };
      return { progressPercent: Math.min(100, Math.round((100 * ml) / plan.goal.waterTargetMl)) };
    },
  };
}

/** Wochenziel aus der Fassung, die am Ende der Woche gilt; ausgeblendete Importe zählen nicht. */
export function testSportProjector({ planReader }: Ports): PartnerSummaryProjector<'sport'> {
  return {
    area: 'sport',
    async project(tx, { ownerPersonId, period }) {
      const plan = await planReader(tx).effectivePlan(ownerPersonId, period.to);
      const rows = await tx
        .select({ minutes: sportEntry.durationMinutes })
        .from(sportEntry)
        .where(
          and(
            eq(sportEntry.personId, ownerPersonId),
            between(sportEntry.localDate, period.from, period.to),
            isNull(sportEntry.deletedAt),
            isNull(sportEntry.hiddenAt),
            isNull(sportEntry.replacedByEntryId),
          ),
        );
      return {
        countedMinutes: rows.reduce((sum, row) => sum + row.minutes, 0),
        weeklyTargetMinutes: plan.type === 'leer' ? 150 : plan.goal.weeklySportTargetMinutes,
      };
    },
  };
}

/** Schlichte Veränderung erstes zu letztem Tagesgewicht im Zeitraum; der echte Trend kommt aus #38. */
export function testWeightProjector(): PartnerSummaryProjector<'gewicht'> {
  return {
    area: 'gewicht',
    async project(tx, { ownerPersonId, period }) {
      const rows = await tx
        .select({ localDate: weightEntry.localDate, weightG: weightEntry.weightG })
        .from(weightEntry)
        .where(and(eq(weightEntry.personId, ownerPersonId), gte(weightEntry.localDate, period.from), lte(weightEntry.localDate, period.to),
          isNull(weightEntry.deletedAt), isNull(weightEntry.hiddenAt)))
        .orderBy(weightEntry.localDate);
      const days = new Set(rows.map((row) => row.localDate));
      if (days.size < 3) return { changeKg: null, direction: 'noch_nicht_verfuegbar' };
      const changeKg = Math.round((rows.at(-1)!.weightG - rows[0]!.weightG) / 100) / 10 || 0;
      return { changeKg, direction: changeKg < 0 ? 'sinkend' : changeKg > 0 ? 'steigend' : 'stabil' };
    },
  };
}

/** Schreibt die Bereichsdaten der Test-Projectors direkt in Postgres. */
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
