import { createQuickCommandRegistry, type QuickCommandHandlers } from './quick-commands';

/**
 * Handler der Bereiche je `commandKey` aus dem festen Katalog. Spezifikation 3 trägt hier den
 * Handler für `water.quick_add` ein; bis dahin zeigt der Development Build einen Platzhalter-Hinweis.
 */
const handlers: QuickCommandHandlers = {};

/**
 * Registry der App. Sie bucht in der geöffneten Kontodatenbank (`LocalDatabases.current`); die
 * reicht das Auth-Modul herein, das Konten öffnet und sperrt
 * ([#97](https://github.com/Yggras/abnehm-app/issues/97)). Bis dahin ist keine geöffnet.
 */
export const appQuickCommands = createQuickCommandRegistry(() => null, handlers);
