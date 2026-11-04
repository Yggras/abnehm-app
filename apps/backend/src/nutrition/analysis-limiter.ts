// Kostenschutz der KI-Fotoanalyse (Spezifikation 2, Abschnitt 8; #161): höchstens `MAX_ANALYSES_PER_DAY`
// Analysen je Person und lokalem Tag und eine laufende Analyse je Person. Die Zähler liegen wie die
// Begrenzungen der Anmeldung (`auth/login-limiter.ts`) im Speicher des einen Backend-Prozesses; ein
// Neustart setzt sie zurück. Fotoentwürfe taugen nicht als dauerhafter Zähler, weil „Verwerfen“ und
// Bestätigen sie löschen.

/** Analysen je Person und lokalem Tag (Designwert, nicht belegt). */
export const MAX_ANALYSES_PER_DAY = 20;

/**
 * Ergebnis von `start`: ein belegter Platz mit der Freigabe danach, oder die Ablehnung samt Grund.
 * `count` ist jeweils die Zahl der Analysen der Person an diesem Tag, die belegte eingeschlossen.
 */
export type AnalysisStart =
  | Readonly<{ type: 'belegt'; count: number; end(): void }>
  | Readonly<{ type: 'tageslimit' | 'laeuft_schon'; count: number }>;

export type AnalysisLimiter = Readonly<{
  /** Belegt den Platz der Person und zählt die Analyse, sofern weder das Tageslimit erreicht ist noch eine läuft. */
  start(personId: string, localDate: string): AnalysisStart;
}>;

export function createAnalysisLimiter(): AnalysisLimiter {
  const running = new Set<string>();
  // Je Person nur der aktuelle Tag; ein neuer Tag ersetzt den Eintrag, der Speicher wächst nicht.
  const today = new Map<string, { localDate: string; count: number }>();
  return {
    start(personId, localDate) {
      const counted = today.get(personId);
      const count = counted?.localDate === localDate ? counted.count : 0;
      if (count >= MAX_ANALYSES_PER_DAY) return { type: 'tageslimit', count };
      if (running.has(personId)) return { type: 'laeuft_schon', count };
      running.add(personId);
      today.set(personId, { localDate, count: count + 1 });
      return { type: 'belegt', count: count + 1, end: () => running.delete(personId) };
    },
  };
}
