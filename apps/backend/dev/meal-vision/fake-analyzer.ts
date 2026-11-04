import { z } from 'zod';

import type { MealVisionAnalyzer, MealVisionImage, MealVisionOutcome } from '../../src/nutrition/meal-vision.ts';

// Fake für `MealVisionAnalyzer` (Spezifikation 2, Abschnitt 8; #161), Testfähigkeit `fake-fotoanalyse`
// (test/test-capabilities.ts). Es gibt ihn nur in Tests und im Development-Backend; das Produktions-Image
// kopiert diesen Ordner nicht, und das produktive Backend baut seinen Analyzer nur aus dem Claude-Adapter.

/** Was der Fake auf die nächste Analyse antwortet. */
export const FakeMealVisionBehavior = z.enum(['erfolg', 'leer', 'refusal', 'schemaverstoss', 'zeitueberschreitung']);
export type FakeMealVisionBehavior = z.infer<typeof FakeMealVisionBehavior>;

/** Body der Route `POST /dev/fotoanalyse` des Development-Backends. */
export const FakeMealVisionRequest = z.strictObject({ verhalten: FakeMealVisionBehavior });

/** Feste Schätzung von `erfolg`: Bratkartoffeln mit Spiegelei und eine Apfelschorle. */
export const fakeMealVisionAnalysis = {
  components: [
    { name: 'Bratkartoffeln', amount: 180, unit: 'g', kcal: 270, proteinG: 4, carbsG: 32, fatG: 13 },
    { name: 'Spiegelei', amount: 60, unit: 'g', kcal: 110, proteinG: 7.5, carbsG: 0.4, fatG: 8.8 },
    { name: 'Apfelschorle', amount: 330, unit: 'ml', kcal: 82.5, proteinG: 0, carbsG: 19.8, fatG: 0 },
  ],
} as const;

const usage = { inputTokens: 1_250, outputTokens: 420 } as const;

const outcomes: Readonly<Record<FakeMealVisionBehavior, MealVisionOutcome>> = {
  erfolg: { type: 'analysiert', analysis: { components: fakeMealVisionAnalysis.components.map((component) => ({ ...component })) }, usage },
  leer: { type: 'analysiert', analysis: { components: [] }, usage },
  // Der Claude-Adapter bildet Refusal und Schemaverstoß gleich ab; nur beim Refusal kennt er die Tokens.
  refusal: { type: 'fehlgeschlagen', usage },
  schemaverstoss: { type: 'fehlgeschlagen', usage: null },
  zeitueberschreitung: { type: 'nicht_erreichbar' },
};

export type FakeMealVision = Readonly<{
  analyzer: MealVisionAnalyzer;
  /** Stellt die Antwort für alle folgenden Analysen um. */
  behave(behavior: FakeMealVisionBehavior): void;
  /** Jedes Bild, das der Fake erhalten hat, in Reihenfolge. */
  received: readonly MealVisionImage[];
}>;

/** Kennung des Fakes; der Release-Test sucht sie als Marker im Produktions-Image. */
export const fakeMealVisionMarker = 'fake_fotoanalyse';

export function createFakeMealVision(initial: FakeMealVisionBehavior = 'erfolg'): FakeMealVision {
  let behavior = initial;
  const received: MealVisionImage[] = [];
  return {
    analyzer: {
      async analyze(image) {
        received.push(image);
        return outcomes[behavior];
      },
    },
    behave(next) {
      behavior = FakeMealVisionBehavior.parse(next);
    },
    received,
  };
}
