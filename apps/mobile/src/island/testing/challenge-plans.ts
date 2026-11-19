import { EntityId, LocalDate, type BausteinKey, type Weekday } from '@abnehm/contracts/base';
import type { PlanReader } from '@abnehm/contracts/ports';

import { fakePlanReader } from '../../area-ports/testing/fakes';

// Wochenpläne für Tests der Challenge-Anteile (#210) über den `PlanReader`-Fake aus #104. Der Plan gilt
// für jede Person, die fragt; so brauchen Tests mit Geräten gegen den echten Server keine Personen-IDs im
// Voraus. Ziele und Werte sind erfunden.

type Bausteine = [BausteinKey, BausteinKey, BausteinKey];
export type ChallengeTestPlan = Readonly<Record<Weekday, Bausteine>>;

/** Jeden Tag Wasserziel, Sporteinheit und Ernährung erfasst: Alle vier Vorlagen passen. */
export const everyDayPlan: ChallengeTestPlan = {
  montag: ['wasserziel', 'sporteinheit', 'ernaehrung_erfasst'],
  dienstag: ['wasserziel', 'sporteinheit', 'ernaehrung_erfasst'],
  mittwoch: ['wasserziel', 'sporteinheit', 'ernaehrung_erfasst'],
  donnerstag: ['wasserziel', 'sporteinheit', 'ernaehrung_erfasst'],
  freitag: ['wasserziel', 'sporteinheit', 'ernaehrung_erfasst'],
  samstag: ['wasserziel', 'sporteinheit', 'ernaehrung_erfasst'],
  sonntag: ['wasserziel', 'sporteinheit', 'ernaehrung_erfasst'],
};

/** Sport am Montag, Mittwoch und Freitag, nie „Ernährung erfasst“: „Ernährung im Blick“ passt nicht. */
export const threeSportDaysPlan: ChallengeTestPlan = {
  montag: ['wasserziel', 'sporteinheit', 'gewogen'],
  dienstag: ['wasserziel', 'im_kalorienbudget', 'gewogen'],
  mittwoch: ['wasserziel', 'sporteinheit', 'im_kalorienbudget'],
  donnerstag: ['wasserziel', 'im_kalorienbudget', 'gewogen'],
  freitag: ['wasserziel', 'sporteinheit', 'gewogen'],
  samstag: ['wasserziel', 'im_kalorienbudget', 'gewogen'],
  sonntag: ['wasserziel', 'im_kalorienbudget', 'gewogen'],
};

const anyone = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b99');

/** `PlanReader` mit einem Wochenplan ab dem 1.10.2026 für jede Person; ohne Plan stets `leer`. */
export function weeklyPlanReader(days: ChallengeTestPlan | null): PlanReader {
  const reader = fakePlanReader(
    days === null
      ? {}
      : {
          goals: [
            {
              personId: anyone,
              id: EntityId.parse('2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c99'),
              validFrom: LocalDate.parse('2026-10-01'),
              calorieBudgetMilliKcal: 1_800_000,
              lowerBoundMilliKcal: 1_400_000,
              maintenanceReason: null,
              pace: 'entspannt',
              goalWeightG: 70_000,
              waterTargetMl: 2_000,
              weeklySportTargetMinutes: 150,
            },
          ],
          weeklyPlans: [{ id: EntityId.parse('3b5d7f9a-2c4e-4a6b-8d0f-3c5e7a9b1d99'), personId: anyone, validFrom: LocalDate.parse('2026-10-01'), days }],
        },
  );
  return { effectivePlan: (_personId, localDate) => reader.effectivePlan(anyone, localDate) };
}
