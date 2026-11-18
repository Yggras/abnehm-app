import type { LocalDate } from '@abnehm/contracts/base';

/** Meldet ein Ereignis an den Beobachter; die Rückgabe beendet die Beobachtung. */
type Observe = (listener: () => void) => () => void;

/**
 * Auslöser von „Tagesziele sicherstellen“ (Spezifikation 1, Abschnitt 5): sofort beim Öffnen der
 * Kontodatenbank (App-Start), bei jeder Rückkehr in den Vordergrund und beim lokalen Tageswechsel bei
 * geöffneter App. Den Tageswechsel erkennt ein Takt, der nur auslöst, wenn sich der lokale Tag seit dem
 * letzten Sicherstellen geändert hat. Ein Fehler geht an `onError`; die Auslöser laufen weiter. Die
 * Rückgabe beendet alle Auslöser.
 */
export function followDailyGoalTriggers({
  ensure,
  today,
  observeForeground,
  observeTicks,
  onError,
}: Readonly<{
  ensure: () => void;
  /** Heutiger Tag der Geräteuhr. */
  today: () => LocalDate;
  observeForeground: Observe;
  /** Regelmäßiger Takt, in Test-Artefakten zusätzlich jeder Sprung der Testuhr. */
  observeTicks: Observe;
  onError: (error: unknown) => void;
}>): () => void {
  let ensuredFor: LocalDate | null = null;
  const run = () => {
    try {
      ensuredFor = today();
      ensure();
    } catch (error) {
      onError(error);
    }
  };
  run();
  const stopForeground = observeForeground(run);
  const stopTicks = observeTicks(() => {
    if (today() !== ensuredFor) run();
  });
  return () => {
    stopForeground();
    stopTicks();
  };
}
