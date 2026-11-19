/** @jest-environment node */
import { followBudgetSuggestionChecks } from './budget-suggestion-triggers';

// Nachweis für #150: Die Prüfung des Budgetvorschlags läuft beim App-Start im Vordergrund und bei jeder
// Rückkehr in den Vordergrund (Spezifikation 1, Abschnitt 7). Die Sperre auf einen Lauf je Tag belegt
// `budget-suggestion.test.ts` am Plan-Modul.

function world(initialActive: boolean, check: () => Promise<unknown> = async () => undefined) {
  let listener: ((active: boolean) => void) | null = null;
  const calls: string[] = [];
  const errors: unknown[] = [];
  const stop = followBudgetSuggestionChecks({
    check: () => {
      calls.push('pruefen');
      return check();
    },
    initialActive,
    observeForeground: (next) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
    onError: (error) => errors.push(error),
  });
  return { calls, errors, stop, foreground: (active: boolean) => listener?.(active), observed: () => listener !== null };
}

describe('Auslöser der Budgetvorschlag-Prüfung', () => {
  it('prüft beim App-Start im Vordergrund und bei jeder Rückkehr in den Vordergrund', () => {
    const { calls, foreground } = world(true);
    expect(calls).toEqual(['pruefen']);

    foreground(true);
    expect(calls).toEqual(['pruefen']);
    foreground(false);
    foreground(true);
    expect(calls).toEqual(['pruefen', 'pruefen']);
  });

  it('prüft nicht bei einer Öffnung im Hintergrund, aber sobald die App in den Vordergrund kommt', () => {
    const { calls, foreground } = world(false);
    expect(calls).toEqual([]);

    foreground(true);
    expect(calls).toEqual(['pruefen']);
  });

  it('meldet Fehler an onError und prüft danach weiter; die Rückgabe beendet die Beobachtung', async () => {
    const { calls, errors, foreground, stop, observed } = world(true, () => Promise.reject(new Error('Port defekt')));
    await Promise.resolve();
    expect(errors).toEqual([new Error('Port defekt')]);

    foreground(false);
    foreground(true);
    expect(calls).toHaveLength(2);
    stop();
    expect(observed()).toBe(false);
  });
});
