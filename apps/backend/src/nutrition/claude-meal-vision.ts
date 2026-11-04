import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { MealPhotoAnalysis } from '@abnehm/contracts/nutrition';

import { mealVisionPrompts, type MealVisionSettings } from './meal-vision-settings.ts';
import type { MealVisionAnalyzer } from './meal-vision.ts';

// Produktiver `MealVisionAnalyzer` (Spezifikation 2, Abschnitt 8; #161): Claude über `@anthropic-ai/sdk`
// mit `client.messages.parse` und Structured Outputs (`zodOutputFormat`).

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
