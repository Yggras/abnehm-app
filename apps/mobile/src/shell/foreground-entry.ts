/** Meldet jede Änderung, ob die App im Vordergrund ist; die Rückgabe beendet die Beobachtung. */
export type ObserveForeground = (listener: (active: boolean) => void) => () => void;

/**
 * Führt `run` beim Eintritt in den Vordergrund aus: sofort, wenn die App beim Start schon im Vordergrund ist
 * (`initialActive`, nicht bei einer Öffnung im Hintergrund), und bei jedem Wechsel von inaktiv zu aktiv.
 * Mehrere Meldungen „aktiv“ hintereinander lösen nur einmal aus. Fehler behandelt `run` selbst. Die
 * Rückgabe beendet die Beobachtung. Auslöser des Health-Imports (#183) und der Budgetvorschlag-Prüfung (#150).
 */
export function runOnForegroundEntry(
  { initialActive, observeForeground }: Readonly<{ initialActive: boolean; observeForeground: ObserveForeground }>,
  run: () => void,
): () => void {
  let active = initialActive;
  if (active) run();
  return observeForeground((next) => {
    if (next && !active) run();
    active = next;
  });
}
