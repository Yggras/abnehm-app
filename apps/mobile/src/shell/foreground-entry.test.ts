/** @jest-environment node */
import { runOnForegroundEntry } from './foreground-entry';

// Nachweis für #150 (und den Health-Import aus #183): Auslösen beim App-Start im Vordergrund und bei jeder
// Rückkehr in den Vordergrund. Die Sperre der Budgetvorschlag-Prüfung auf einen Lauf je Tag belegt
// `src/plan/budget-suggestion.test.ts` am Plan-Modul.

function world(initialActive: boolean) {
  let listener: ((active: boolean) => void) | null = null;
  let runs = 0;
  const stop = runOnForegroundEntry(
    {
      initialActive,
      observeForeground: (next) => {
        listener = next;
        return () => {
          listener = null;
        };
      },
    },
    () => {
      runs += 1;
    },
  );
  return { runs: () => runs, stop, foreground: (active: boolean) => listener?.(active), observed: () => listener !== null };
}

describe('Eintritt in den Vordergrund', () => {
  it('löst beim App-Start im Vordergrund und bei jeder Rückkehr in den Vordergrund aus, nicht bei wiederholtem „aktiv“', () => {
    const { runs, foreground } = world(true);
    expect(runs()).toBe(1);

    foreground(true);
    expect(runs()).toBe(1);
    foreground(false);
    foreground(true);
    expect(runs()).toBe(2);
  });

  it('löst nicht bei einer Öffnung im Hintergrund aus, aber sobald die App in den Vordergrund kommt', () => {
    const { runs, foreground } = world(false);
    expect(runs()).toBe(0);

    foreground(true);
    expect(runs()).toBe(1);
  });

  it('die Rückgabe beendet die Beobachtung', () => {
    const { stop, observed } = world(true);
    stop();
    expect(observed()).toBe(false);
  });
});
