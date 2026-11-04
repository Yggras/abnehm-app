import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { MealPhotoAnalysis } from '@abnehm/contracts/nutrition';

import type { MealVisionAnalyzer } from './meal-vision.ts';

// Produktiver `MealVisionAnalyzer` (Spezifikation 2, Abschnitt 8; #161): Claude über `@anthropic-ai/sdk`
// mit `client.messages.parse` und Structured Outputs (`zodOutputFormat`).

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

/**
 * Frist eines Modellaufrufs (Designwert, nicht belegt): unter den 60 s, nach denen die App aufgibt.
 * Der Adapter wiederholt nicht selbst; `photo_analysis_unavailable` ist für die App wiederholbar.
 */
const DEFAULT_TIMEOUT_MS = 50_000;

/** Statuscodes, bei denen der Anbieter vorübergehend nicht antwortet (https://platform.claude.com/docs/en/api/errors). */
const unavailableStatus = (status: number) => status === 408 || status === 409 || status === 429 || status >= 500;

/**
 * Der Analyzer des produktiven Backends: immer der Claude-Adapter. Ohne Schlüssel startet das Backend
 * nicht; es gibt keine Einstellung, die stattdessen einen Fake wählt.
 */
export function productionMealVisionAnalyzer(settings: MealVisionSettings | null): MealVisionAnalyzer {
  if (settings === null) throw new Error('Ungültige Backend-Konfiguration: ANTHROPIC_API_KEY_FILE fehlt');
  return createClaudeMealVisionAnalyzer(settings);
}

/** Produktiver Analyzer. `transport` ersetzt nur in Tests den HTTP-Transport und die Frist des SDK. */
export function createClaudeMealVisionAnalyzer(
  settings: MealVisionSettings,
  transport: { fetch?: typeof globalThis.fetch; timeoutMs?: number } = {},
): MealVisionAnalyzer {
  const client = new Anthropic({
    apiKey: settings.apiKey,
    maxRetries: 0,
    timeout: transport.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(transport.fetch === undefined ? {} : { fetch: transport.fetch }),
  });
  const format = zodOutputFormat(MealPhotoAnalysis);

  return {
    async analyze({ jpeg }) {
      try {
        const message = await client.messages.parse({
          model: settings.model,
          max_tokens: settings.maxTokens,
          thinking: { type: 'adaptive' },
          output_config: { effort: settings.effort, format },
          messages: [
            {
              role: 'user',
              // Das Bild steht vor dem Text (https://platform.claude.com/docs/en/build-with-claude/vision).
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from(jpeg).toString('base64') } },
                { type: 'text', text: mealVisionPrompts[settings.promptVersion] },
              ],
            },
          ],
        });
        const usage = { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens };
        if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens' || message.parsed_output === null) {
          return { type: 'fehlgeschlagen', usage };
        }
        return { type: 'analysiert', analysis: message.parsed_output, usage };
      } catch (error) {
        // Reihenfolge vom Speziellen zum Allgemeinen: Verbindungsfehler und Zeitüberschreitung sind
        // Unterklassen von `APIError`, und `APIError` ist eine von `AnthropicError`.
        if (error instanceof Anthropic.APIConnectionError) return { type: 'nicht_erreichbar' };
        if (error instanceof Anthropic.APIError) {
          return error.status !== undefined && unavailableStatus(error.status) ? { type: 'nicht_erreichbar' } : { type: 'fehlgeschlagen', usage: null };
        }
        // Übrig bleibt der Parser des SDK: Text ohne gültiges JSON oder mit Verstoß gegen `MealPhotoAnalysis`,
        // auch eine bei `max_tokens` abgeschnittene Antwort.
        if (error instanceof Anthropic.AnthropicError) return { type: 'fehlgeschlagen', usage: null };
        throw error;
      }
    },
  };
}
