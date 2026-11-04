import { describe, expect, it } from 'vitest';

import { createClaudeMealVisionAnalyzer } from '../src/nutrition/claude-meal-vision.ts';
import { mealVisionPrompts, type MealVisionSettings } from '../src/nutrition/meal-vision-settings.ts';

// Produktiver `MealVisionAnalyzer` (Spezifikation 2, Abschnitt 8; #161) gegen einen gefälschten
// HTTP-Transport des Anthropic-SDK: Form der Anfrage, Datensparsamkeit und die Abbildung jeder
// Antwort auf das Ergebnis der Naht. Die Antworten folgen dem Messages-API-Format
// (https://platform.claude.com/docs/en/api/messages).

const settings: MealVisionSettings = {
  apiKey: 'sk-test-schluessel',
  model: 'claude-sonnet-5-5',
  effort: 'medium',
  promptVersion: 'v1',
  maxTokens: 16_000,
};

/** Ein bereinigtes JPEG; der Adapter reicht die Bytes unverändert weiter. */
const image = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3, 4, 0xff, 0xd9]);

const potatoes = { name: 'Bratkartoffeln', amount: 180, unit: 'g', kcal: 270, proteinG: 4, carbsG: 32, fatG: 13 };

function message(text: string | null, stopReason = 'end_turn') {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content: text === null ? [] : [{ type: 'text', text }],
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: stopReason === 'refusal' ? { type: 'refusal', category: null, explanation: null } : null,
    usage: { input_tokens: 1_234, output_tokens: 321, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
}

type Captured = { url: string; headers: Headers; body: Record<string, unknown> };

/** Transport, der jede Anfrage festhält und mit `reply` antwortet. */
type Reply = (init: RequestInit) => Response | Promise<Response>;

function transport(reply: Reply) {
  const requests: Captured[] = [];
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    requests.push({ url: String(input), headers: new Headers(init.headers), body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return reply(init);
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const apiError = (status: number, type: string) => json(status, { type: 'error', error: { type, message: 'Testfehler' } });

function analyzerWith(reply: Reply, timeoutMs?: number) {
  const fake = transport(reply);
  return { analyzer: createClaudeMealVisionAnalyzer(settings, { fetch: fake.fetch, timeoutMs }), requests: fake.requests };
}

describe('Claude-MealVisionAnalyzer', () => {
  it('schickt nur Bild und Prompt, das Bild vor dem Text, mit Modell, Effort, adaptivem Thinking und Structured Outputs', async () => {
    const { analyzer, requests } = analyzerWith(() => json(200, message(JSON.stringify({ components: [potatoes] }))));
    await analyzer.analyze({ jpeg: image });

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request!.url).toMatch(/\/v1\/messages$/);
    // SDK 1.x sendet den Schlüssel als Bearer-Token (node_modules/@anthropic-ai/sdk/client.js, `apiKeyAuth`).
    expect(request!.headers.get('authorization')).toBe('Bearer sk-test-schluessel');
    const { output_config: outputConfig, messages, ...rest } = request!.body as {
      output_config: { effort: string; format: { type: string; schema: unknown } };
      messages: unknown;
    };
    // Keine weiteren Felder: kein System-Prompt, keine Metadaten, keine Personen-, Konto- oder Verlaufsdaten (#22).
    expect(rest).toEqual({ model: 'claude-sonnet-5-5', max_tokens: 16_000, thinking: { type: 'adaptive' } });
    expect(outputConfig.effort).toBe('medium');
    expect(outputConfig.format.type).toBe('json_schema');
    expect(messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from(image).toString('base64') } },
          { type: 'text', text: mealVisionPrompts.v1 },
        ],
      },
    ]);
  });

  it('der Prompt verlangt deutsche Namen, Menge in g bzw. ml, Nährwerte dafür und warnt vor unterschätzten großen Portionen', () => {
    expect(mealVisionPrompts.v1).toMatch(/deutsch/i);
    expect(mealVisionPrompts.v1).toMatch(/Gramm/);
    expect(mealVisionPrompts.v1).toMatch(/Millilitern/);
    expect(mealVisionPrompts.v1).toMatch(/für genau diese Menge/);
    expect(mealVisionPrompts.v1).toMatch(/[Gg]roße Portionen werden oft unterschätzt/);
  });

  it('liefert die geparste Analyse samt Tokens', async () => {
    const { analyzer } = analyzerWith(() => json(200, message(JSON.stringify({ components: [potatoes] }))));
    expect(await analyzer.analyze({ jpeg: image })).toEqual({
      type: 'analysiert',
      analysis: { components: [potatoes] },
      usage: { inputTokens: 1_234, outputTokens: 321 },
    });
  });

  it('liefert eine leere Liste unverändert; „kein Essen“ entscheidet der Server', async () => {
    const { analyzer } = analyzerWith(() => json(200, message(JSON.stringify({ components: [] }))));
    expect(await analyzer.analyze({ jpeg: image })).toMatchObject({ type: 'analysiert', analysis: { components: [] } });
  });

  it.each([
    ['Refusal ohne Text', () => json(200, message(null, 'refusal'))],
    ['Refusal mit Text', () => json(200, message('Dazu kann ich nichts sagen.', 'refusal'))],
    ['max_tokens mit abgeschnittenem JSON', () => json(200, message('{"components":[{"name":"Brat', 'max_tokens'))],
    ['max_tokens mit vollständigem JSON', () => json(200, message(JSON.stringify({ components: [potatoes] }), 'max_tokens'))],
    ['Schemaverstoß: Menge über 5 kg', () => json(200, message(JSON.stringify({ components: [{ ...potatoes, amount: 6_000 }] })))],
    ['Schemaverstoß: Makros über der Menge', () => json(200, message(JSON.stringify({ components: [{ ...potatoes, carbsG: 200 }] })))],
    ['Schemaverstoß: zusätzliches Feld', () => json(200, message(JSON.stringify({ components: [{ ...potatoes, confidence: 0.9 }] })))],
    ['abgelehnte Anfrage (400)', () => apiError(400, 'invalid_request_error')],
    ['ungültiger Schlüssel (401)', () => apiError(401, 'authentication_error')],
  ])('%s → fehlgeschlagen', async (_, reply) => {
    const { analyzer } = analyzerWith(reply);
    expect(await analyzer.analyze({ jpeg: image })).toMatchObject({ type: 'fehlgeschlagen' });
  });

  it('nennt die Tokens auch bei einem Refusal', async () => {
    const { analyzer } = analyzerWith(() => json(200, message(null, 'refusal')));
    expect(await analyzer.analyze({ jpeg: image })).toEqual({ type: 'fehlgeschlagen', usage: { inputTokens: 1_234, outputTokens: 321 } });
  });

  it.each([
    ['Rate Limit (429)', () => apiError(429, 'rate_limit_error')],
    ['Serverfehler (500)', () => apiError(500, 'api_error')],
    ['überlastet (529)', () => apiError(529, 'overloaded_error')],
    ['Netzfehler', () => Promise.reject(new TypeError('fetch failed'))],
  ])('%s → nicht erreichbar, ohne eigenen Wiederholungsversuch', async (_, reply) => {
    const { analyzer, requests } = analyzerWith(reply);
    expect(await analyzer.analyze({ jpeg: image })).toEqual({ type: 'nicht_erreichbar' });
    expect(requests).toHaveLength(1);
  });

  it('Zeitüberschreitung → nicht erreichbar', async () => {
    // Antwortet nie; erst das Abbrechen des SDK nach Ablauf der Frist beendet die Anfrage.
    const hanging: Reply = ({ signal }) =>
      new Promise<Response>((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('abgebrochen', 'AbortError'))));
    const { analyzer } = analyzerWith(hanging, 50);
    expect(await analyzer.analyze({ jpeg: image })).toEqual({ type: 'nicht_erreichbar' });
  });
});
