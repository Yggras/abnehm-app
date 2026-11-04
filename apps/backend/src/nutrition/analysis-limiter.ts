// Kostenschutz der KI-Fotoanalyse (Spezifikation 2, Abschnitt 8; #161): höchstens `MAX_ANALYSES_PER_DAY`
// Analysen je Person und lokalem Tag und eine laufende Analyse je Person. Die Zähler liegen wie die
// Begrenzungen der Anmeldung (`auth/login-limiter.ts`) im Speicher des einen Backend-Prozesses; ein
// Neustart setzt sie zurück. Fotoentwürfe taugen nicht als dauerhafter Zähler, weil „Verwerfen“ und
// Bestätigen sie löschen.

/** Analysen je Person und lokalem Tag (Designwert, nicht belegt). */
export const MAX_ANALYSES_PER_DAY = 20;

/** Ein belegter Platz: die wievielte Analyse des Tages und die Freigabe danach. */
export type AnalysisSlot = Readonly<{ count: number; end(): void }>;

export type AnalysisLimiter = Readonly<{
  /** Belegt den Platz der Person und zählt die Analyse, oder `null` bei erreichtem Limit. */
  start(personId: string, localDate: string): AnalysisSlot | null;
}>;

export function createAnalysisLimiter(): AnalysisLimiter {
  const running = new Set<string>();
  // Je Person nur der aktuelle Tag; ein neuer Tag ersetzt den Eintrag, der Speicher wächst nicht.
  const today = new Map<string, { localDate: string; count: number }>();
  return {
    start(personId, localDate) {
      const counted = today.get(personId);
      const count = counted?.localDate === localDate ? counted.count : 0;
      if (running.has(personId) || count >= MAX_ANALYSES_PER_DAY) return null;
      running.add(personId);
      today.set(personId, { localDate, count: count + 1 });
      return { count: count + 1, end: () => running.delete(personId) };
    },
  };
}
