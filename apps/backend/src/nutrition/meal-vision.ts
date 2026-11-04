import type { MealPhotoAnalysis } from '@abnehm/contracts/nutrition';

// Naht `MealVisionAnalyzer` (Spezifikation 2, Abschnitte 1 und 8; #161): KI-Bildanalyse einer Mahlzeit
// auf dem Server. Produktiv implementiert sie der Claude-Adapter (`claude-meal-vision.ts`); Tests und das
// Development-Backend nutzen den Fake der Testfähigkeit `fake-fotoanalyse`, den es in Produktion nicht gibt.
// Diese Datei enthält nur die Naht, damit ihre Nutzer das Anthropic-SDK nicht laden.

/** Ein bereinigtes Foto: neu kodiertes JPEG ohne Metadaten. Mehr erfährt der Anbieter nicht (#22). */
export type MealVisionImage = Readonly<{ jpeg: Uint8Array }>;

/** Verbrauch eines Modellaufrufs; neben Anzahl, Dauer und Fehlercode das Einzige, was ins Log geht. */
export type TokenUsage = Readonly<{ inputTokens: number; outputTokens: number }>;

/**
 * Ergebnis einer Analyse. `analysiert` enthält die geprüfte Antwort in g bzw. ml, auch eine leere
 * Liste; `fehlgeschlagen` steht für Refusal, `max_tokens`, Schemaverstoß und abgelehnte Anfragen;
 * `nicht_erreichbar` für Netzfehler, Zeitüberschreitung, Überlast und Serverfehler des Anbieters.
 */
export type MealVisionOutcome =
  | Readonly<{ type: 'analysiert'; analysis: MealPhotoAnalysis; usage: TokenUsage }>
  | Readonly<{ type: 'fehlgeschlagen'; usage: TokenUsage | null }>
  | Readonly<{ type: 'nicht_erreichbar' }>;

export type MealVisionAnalyzer = Readonly<{ analyze(image: MealVisionImage): Promise<MealVisionOutcome> }>;
