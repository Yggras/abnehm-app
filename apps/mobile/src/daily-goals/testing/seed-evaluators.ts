import { nutritionDailyGoals } from '../../nutrition/daily-goal-evaluators';
import { trackerDailyGoals } from '../../trackers/daily-goal-evaluators';
import { createDailyGoalRegistry, type DailyGoalRegistry } from '../registry';

// Evaluatoren für die Schritte der Seed-Manifeste (#113): dieselben wie im Composition Root, also die
// echten der Ernährung (#166) und von Wasser, Sport und Gewicht (#178). Die Seed-Tests werten Tagesziele
// damit genau so aus wie die App.

/** Registry der Tagesziele mit den echten Evaluatoren aller Bausteine. */
export function seedDailyGoalRegistry(): DailyGoalRegistry {
  return createDailyGoalRegistry({
    bausteine: [...nutritionDailyGoals.bausteine, ...trackerDailyGoals.bausteine],
    checkIns: [...nutritionDailyGoals.checkIns, ...trackerDailyGoals.checkIns],
  });
}
