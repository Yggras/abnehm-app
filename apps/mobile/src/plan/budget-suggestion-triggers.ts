/**
 * Auslöser von „Budgetvorschlag prüfen“ (Spezifikation 1, Abschnitt 7): der App-Start, sofern die App
 * dabei im Vordergrund ist (nicht bei einer Öffnung im Hintergrund, etwa für den Health-Push), und jede
 * Rückkehr in den Vordergrund. Dass höchstens eine Prüfung je lokalem Tag läuft, sichert das Plan-Modul;
 * ein Tageswechsel bei geöffneter App löst nichts aus. Ein Fehler geht an `onError`; die Auslöser laufen
 * weiter. Die Rückgabe beendet sie.
 */
export function followBudgetSuggestionChecks({
  check,
  initialActive,
  observeForeground,
  onError,
}: Readonly<{
  check: () => Promise<unknown>;
  /** Ob die App beim Öffnen der Kontodatenbank im Vordergrund ist. */
  initialActive: boolean;
  /** Meldet jede Änderung, ob die App im Vordergrund ist. */
  observeForeground: (listener: (active: boolean) => void) => () => void;
  onError: (error: unknown) => void;
}>): () => void {
  const run = () => {
    check().catch(onError);
  };
  let active = initialActive;
  if (active) run();
  return observeForeground((next) => {
    if (next && !active) run();
    active = next;
  });
}
