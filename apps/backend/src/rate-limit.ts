import type { Clock } from '@abnehm/clock';

// Gleitende Zeitfenster für Begrenzungen (Anmeldung, Einladungscodes). Die Zähler liegen im Speicher des
// einen Backend-Prozesses; ein Neustart setzt sie zurück.

const MAX_TRACKED_KEYS = 10_000;

export type WindowLimit = Readonly<{ max: number; windowMs: number }>;

export type SlidingWindows = {
  /** Ob unter dem Schlüssel im Fenster schon `limit.max` Ereignisse liegen. */
  exhausted(key: string, limit: WindowLimit): boolean;
  /** Zählt ein Ereignis jetzt. */
  add(key: string, limit: WindowLimit): void;
  clear(key: string): void;
};

/** `longestWindowMs` ist das längste verwendete Fenster; danach ist jeder Eintrag verfallen. */
export function createSlidingWindows({ clock, longestWindowMs }: { clock: Clock; longestWindowMs: number }): SlidingWindows {
  const events = new Map<string, number[]>();
  const now = () => Date.parse(clock.read().instant);

  /** Ereignisse im Fenster; ältere fallen heraus, leere Einträge verschwinden. */
  function recent(key: string, windowMs: number, at: number): number[] {
    const kept = (events.get(key) ?? []).filter((time) => at - time < windowMs);
    if (kept.length === 0) events.delete(key);
    else events.set(key, kept);
    return kept;
  }

  return {
    exhausted(key, limit) {
      return recent(key, limit.windowMs, now()).length >= limit.max;
    },
    add(key, limit) {
      const at = now();
      // Viele verschiedene Schlüssel (etwa wechselnde IPs) dürfen den Speicher nicht füllen.
      if (events.size > MAX_TRACKED_KEYS) {
        for (const known of [...events.keys()]) recent(known, longestWindowMs, at);
      }
      events.set(key, [...recent(key, limit.windowMs, at), at]);
    },
    clear(key) {
      events.delete(key);
    },
  };
}
