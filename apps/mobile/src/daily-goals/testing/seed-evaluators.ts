import { and, eq, isNull } from 'drizzle-orm';

import { countedWaterMl } from '@abnehm/contracts/tracker-rules';

import { sportEntry, waterEntry, weightEntry } from '../../local-db/schema';
import { sqliteOf } from '../../local-db/sqlite';
import { nutritionDailyGoals } from '../../nutrition/daily-goal-evaluators';
import type { DayFactsReader } from '../evaluators';
import { createDailyGoalRegistry, type DailyGoalRegistry } from '../registry';
import { noTestFacts, testBausteinEvaluators, testCheckInEvaluators, type TestDayFacts } from './test-evaluators';

// Evaluatoren für die Schritte der Seed-Manifeste (#113). Die Ernährung registriert ihre echten (#166).
// Für Wasser, Sport und Gewicht wertet der Persistenzdienst der Tagesziele (#105) in den Seed-Tests bis
// Spezifikation 3 (#178) mit den Test-Evaluatoren des Fundaments aus, deren Fakten hier aus den lokalen
// Tabellen der Bereiche kommen: gezählte Wassermenge nach den Tracker-Regeln, Dauer jeder sichtbaren,
// nicht ersetzten Sporteinheit und sichtbare Gewichtseinträge. Liefert ein Bereich seinen Evaluator,
// ersetzt er hier den stellvertretenden.

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
  return {
    ...noTestFacts,
    countedMl: countedWaterMl(waters, localDate),
    sessionMinutes: sessions.map(({ minutes }) => minutes),
    weightEntryCount: weights.length,
  };
};

/** Registry der Tagesziele: die echten der Ernährung, für die übrigen Bausteine die stellvertretenden. */
export function seedDailyGoalRegistry(): DailyGoalRegistry {
  const { wasserziel, sporteinheit, gewogen } = testBausteinEvaluators(readSeedFacts);
  const { wasser, sport, gewicht } = testCheckInEvaluators(readSeedFacts);
  return createDailyGoalRegistry({
    bausteine: [...nutritionDailyGoals.bausteine, wasserziel, sporteinheit, gewogen],
    checkIns: [...nutritionDailyGoals.checkIns, wasser, sport, gewicht],
  });
}
