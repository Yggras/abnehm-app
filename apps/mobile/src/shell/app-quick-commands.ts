import { createQuickCommandRegistry } from './quick-commands';

/**
 * Registry der App. Die App-Sitzung meldet jede geöffnete Kontodatenbank samt den Handlern ihrer
 * Bereiche mit `opened` an (`src/session/device-session.ts`); Spezifikation 3 liefert dort den
 * Handler für `water.quick_add` aus dem Tracker-Modul. Fehlt ein Handler, zeigt ein Test-Artefakt
 * einen Platzhalter-Hinweis; im Release ist das ein Integrationsfehler.
 */
export const appQuickCommands = createQuickCommandRegistry();
