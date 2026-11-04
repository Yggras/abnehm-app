import { and, eq, isNull } from 'drizzle-orm';

import { countedWaterMl } from '@abnehm/contracts/tracker-rules';

import { nutritionEntry, sportEntry, waterEntry, weightEntry } from '../../local-db/schema';
import { sqliteOf } from '../../local-db/sqlite';
import type { DayFactsReader } from '../evaluators';
import { createDailyGoalRegistry, type DailyGoalRegistry } from '../registry';
import { testBausteinEvaluators, testCheckInEvaluators, type TestDayFacts } from './test-evaluators';

// Stellvertretende Evaluatoren für die Schritte der Seed-Manifeste (#113). Die echten registrieren die
// Spezifikationen 2 und 3; bis dahin wertet der Persistenzdienst der Tagesziele (#105) in den Seed-Tests
// mit den Test-Evaluatoren des Fundaments aus, deren Fakten hier aus den lokalen Tabellen der Bereiche
// kommen: gezählte Wassermenge nach den Tracker-Regeln, Dauer jeder sichtbaren, nicht ersetzten
// Sporteinheit, sichtbare Gewichtseinträge, erfasste Mahlzeitenkategorien und Aufnahme in ganzen kcal.
// Liefert ein Bereich seinen Evaluator, ersetzt er hier den stellvertretenden.

const readSeedFacts: DayFactsReader<TestDayFacts> = (tx, personId, localDate) => {
  const db = sqliteOf(tx);
  const waters = db
    .select({ amountMl: waterEntry.amountMl, localDate: waterEntry.localDate, deletedAt: waterEntry.deletedAt })
    .from(waterEntry)
    .where(eq(waterEntry.personId, personId))
    .all();
  const sessions = db
    .select({ minutes: sportEntry.durationMinutes })
    .from(sportEntry)
    .where(and(eq(sportEntry.personId, personId), eq(sportEntry.localDate, localDate), isNull(sportEntry.deletedAt), isNull(sportEntry.hiddenAt), isNull(sportEntry.replacedByEntryId)))
    .all();
  const weights = db
    .select({ id: weightEntry.id })
    .from(weightEntry)
    .where(and(eq(weightEntry.personId, personId), eq(weightEntry.localDate, localDate), isNull(weightEntry.deletedAt), isNull(weightEntry.hiddenAt)))
    .all();
  const meals = db
    .select({ meal: nutritionEntry.meal, milliKcal: nutritionEntry.totalMilliKcal })
    .from(nutritionEntry)
    .where(and(eq(nutritionEntry.personId, personId), eq(nutritionEntry.localDate, localDate), isNull(nutritionEntry.deletedAt)))
    .all();
  return {
    recordedMealCategories: new Set(meals.map(({ meal }) => meal)).size,
    intakeKcal: Math.round(meals.reduce((sum, { milliKcal }) => sum + milliKcal, 0) / 1_000),
    countedMl: countedWaterMl(waters, localDate),
    sessionMinutes: sessions.map(({ minutes }) => minutes),
    weightEntryCount: weights.length,
  };
};

/** Registry der Tagesziele mit den stellvertretenden Evaluatoren über den lokalen Tabellen. */
export function seedDailyGoalRegistry(): DailyGoalRegistry {
  return createDailyGoalRegistry({
    bausteine: Object.values(testBausteinEvaluators(readSeedFacts)),
    checkIns: Object.values(testCheckInEvaluators(readSeedFacts)),
  });
}
