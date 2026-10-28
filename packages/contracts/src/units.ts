import { z } from 'zod';

// Gemeinsame Messwerte mehrerer Bereiche; nicht als Teilpfad exportiert. Mengen sind ganze Zahlen
// in den Einheiten aus Spezifikation 0, Abschnitt 8.

/** Körpergewicht in g im Bereich, den das Schema der Gewichtseinträge erlaubt (Spezifikation 3). */
export const bodyWeightG = z.int().min(20_000).max(350_000);

/** Eingabegrenzen der Körpergröße in cm (Designwert aus Spezifikation 1, Abschnitt 3). */
export const heightCmLimits = { min: 120, max: 230 } as const;

/** Verschiedene Mahlzeiten mit mindestens einem nicht gelöschten Ernährungseintrag. */
export const mealCategoryCount = z.int().min(0).max(4);
