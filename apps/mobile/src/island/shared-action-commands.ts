import { DecideSharedAction, RequestSharedAction } from '@abnehm/contracts/island';

import type { LocalCommand } from '../sync';

// Lokale Fachbefehle der gemeinsamen Aktionen für die Sync-Engine (Spezifikation 0, Abschnitt 9) für
// Rollenwahl, Rollentausch und Deko schenken. Gemeinsame Aktionen sind offline nur vorgemerkt
// (Spezifikation 4, Abschnitt 11): keine lokale Fachzeile, deshalb auch nichts zu bereinigen, wenn der
// Server ablehnt. Arten mit lokaler Vormerkung, etwa ein vorgemerktes Deko-Stück, ergänzen ihre
// Reconciliation hier.

const onlyQueued = { referencePaths: [], apply: () => [], reconcileRejected: () => {} } as const;

export const sharedActionCommands: readonly LocalCommand[] = [
  { type: 'requestSharedAction', payload: RequestSharedAction, ...onlyQueued },
  { type: 'decideSharedAction', payload: DecideSharedAction, ...onlyQueued },
];
