import type { Clock } from '@abnehm/clock';

import { errorCodeForLog } from '../log.ts';

/**
 * Ein zeitgesteuerter Serverjob. `run` muss idempotent sein: Nach einem Neustart oder einem Fehler
 * läuft er erneut, und zwei Läufe dürfen nichts doppelt bewirken.
 */
export type Job = Readonly<{
  /** Eindeutiger, sprechender Name; erscheint in Logs. */
  name: string;
  /** Abstand zwischen zwei Läufen in Millisekunden. */
  intervalMs: number;
  run(): Promise<void>;
}>;

/**
 * Registry der Serverjobs (Spezifikation 0, Abschnitt 9; erster Job ist der Cleanup-Lauf des
 * Sicherheitslogs). Bereiche melden ihre Jobs mit `register` an, ohne die Registry zu ändern.
 * Fällig ist ein Job beim ersten Durchgang und danach, sobald laut Uhr sein Intervall seit dem
 * letzten Start vergangen ist; in Tests löst die Testuhr ihn über `runDue` aus.
 */
export type JobRegistry = {
  register(job: Job): void;
  /** Führt alle fälligen Jobs aus und wartet auf sie. Ein noch laufender Job startet nicht doppelt. */
  runDue(): Promise<void>;
  /** Prüft im Backend-Prozess regelmäßig auf fällige Jobs; liefert die Funktion zum Anhalten. */
  start(options?: { pollIntervalMs?: number }): () => Promise<void>;
};

/** Wie oft der Backend-Prozess auf fällige Jobs prüft (Designwert). */
const DEFAULT_POLL_INTERVAL_MS = 60_000;

/** Ein angemeldeter Job samt Zeitpunkt seines letzten Starts und seinem laufenden Durchgang. */
type Entry = { job: Job; lastStartedAt: number | null; running: Promise<void> | null };

export function createJobRegistry({ clock }: { clock: Clock }): JobRegistry {
  const jobs = new Map<string, Entry>();

  async function runOne(entry: Entry) {
    entry.lastStartedAt = Date.parse(clock.read().instant);
    try {
      await entry.job.run();
    } catch (error) {
      console.error(`[jobs] ${entry.job.name} fehlgeschlagen:`, errorCodeForLog(error));
    }
  }

  function runDue(): Promise<void> {
    const now = Date.parse(clock.read().instant);
    const runs = [...jobs.values()].map((entry) => {
      if (entry.running !== null) return entry.running;
      if (entry.lastStartedAt !== null && now - entry.lastStartedAt < entry.job.intervalMs) return Promise.resolve();
      entry.running = runOne(entry).finally(() => {
        entry.running = null;
      });
      return entry.running;
    });
    return Promise.all(runs).then(() => undefined);
  }

  return {
    register(job) {
      if (jobs.has(job.name)) throw new Error(`Job bereits registriert: ${job.name}`);
      if (!Number.isInteger(job.intervalMs) || job.intervalMs <= 0) throw new Error(`Ungültiges Intervall für ${job.name}`);
      jobs.set(job.name, { job, lastStartedAt: null, running: null });
    },
    runDue,
    // Ohne Angabe so oft wie der kürzeste Job, höchstens im Standardabstand: Die Arbeitsschleife des
    // Push-Zustellers läuft alle paar Sekunden (Spezifikation 5, Abschnitt 9).
    start({ pollIntervalMs = Math.min(DEFAULT_POLL_INTERVAL_MS, ...[...jobs.values()].map((entry) => entry.job.intervalMs)) } = {}) {
      void runDue();
      const timer = setInterval(() => void runDue(), pollIntervalMs);
      return async () => {
        clearInterval(timer);
        await Promise.all([...jobs.values()].map((entry) => entry.running));
      };
    },
  };
}
