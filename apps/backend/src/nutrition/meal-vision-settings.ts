// Server-Konfiguration der KI-Fotoanalyse (Spezifikation 2, Abschnitt 8; #161): Prompt-Versionen,
// Effort-Stufen und Startwerte. Ohne Anthropic-SDK, damit `config.ts` es nicht lädt.

/**
 * Analyse-Prompts nach Version. Die Server-Konfiguration wählt die Version; eine neue Fassung kommt als
 * neuer Eintrag dazu, damit Messungen wie der Eigen-Test (#170) eine feste Fassung nennen können.
 * Der Hinweis auf unterschätzte große Portionen folgt Fridolfsson et al. 2025
 * (https://doi.org/10.1016/j.cdnut.2025.107556).
 */
export const mealVisionPrompts = {
  v1: [
    'Schätze die Mahlzeit auf diesem Foto für ein Ernährungstagebuch.',
    'Zerlege sie in ihre sichtbaren Bestandteile, höchstens 15. Gib für jeden Bestandteil an:',
    '- name: ein kurzer deutscher Name, etwa „Bratkartoffeln“ oder „Spiegelei“;',
    '- amount und unit: die geschätzte Menge in Gramm (unit "g") für feste Lebensmittel oder in Millilitern (unit "ml") für Getränke, Suppen und Soßen;',
    '- kcal, proteinG, carbsG und fatG: Energie in kcal sowie Eiweiß, Kohlenhydrate und Fett in Gramm für genau diese Menge, nicht je 100 g.',
    'Große Portionen werden oft unterschätzt. Schätze die Menge deshalb sorgfältig anhand von Teller, Besteck, Gläsern und Verpackungen.',
    'Bei Mengen in Gramm sind Eiweiß, Kohlenhydrate und Fett zusammen nie mehr als die Menge selbst.',
    'Ist auf dem Foto kein Essen und kein Getränk zu sehen, gib eine leere Liste zurück.',
  ].join('\n'),
} as const satisfies Readonly<Record<string, string>>;

export type MealVisionPromptVersion = keyof typeof mealVisionPrompts;

export const mealVisionEfforts = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type MealVisionEffort = (typeof mealVisionEfforts)[number];

/**
 * Server-Konfiguration des Modellaufrufs. Modell, Effort, Prompt-Version und `max_tokens` lassen sich
 * ohne App-Update ändern; Thinking bleibt adaptiv.
 */
export type MealVisionSettings = Readonly<{
  apiKey: string;
  model: string;
  effort: MealVisionEffort;
  promptVersion: MealVisionPromptVersion;
  maxTokens: number;
}>;

/** Startwerte (Spezifikation 2, Abschnitt 8): Modell aus #5, Effort `medium`, Prompt `v1`. */
export const mealVisionDefaults = {
  model: 'claude-sonnet-5-5',
  effort: 'medium',
  promptVersion: 'v1',
  // Adaptives Thinking zählt mit; 16.000 lässt ihm Raum und bleibt ohne Streaming unter den HTTP-Fristen des SDK.
  maxTokens: 16_000,
} as const satisfies Omit<MealVisionSettings, 'apiKey'>;
