import type { DbExecutor } from '../database.ts';
import { nextServerVersion, recordChange } from '../sync/change-log.ts';

// Schreibhilfe der Kopplung (Spezifikation 0, Abschnitte 8 und 10): Jede Zeile, die Kopplungsannahme,
// gemeinsame Aktionen und Entkopplungs-Kern schreiben, erhält eine eigene Serverversion und einen
// Eintrag im Änderungsprotokoll, damit sie im Pull ankommt.

export type Stamp = { createdAt: Date; updatedAt: Date; serverVersion: bigint };
type Scope = { entityType: string } & ({ couplingId: string } | { ownerPersonId: string });

/** Vergibt je Zeile eine Serverversion und trägt die Änderung mit ihrer Sichtbarkeitsgrenze ein. */
export function changeWriter(tx: DbExecutor, at: Date) {
  return async (scope: Scope, writeRow: (stamp: Stamp) => Promise<string>) => {
    const serverVersion = await nextServerVersion(tx);
    const entityId = await writeRow({ createdAt: at, updatedAt: at, serverVersion });
    await recordChange(tx, { position: serverVersion, operation: 'upsert', createdAt: at, ...scope, entityId });
  };
}

/** Bei einer Änderung bleibt `created_at` erhalten. */
export const updated = ({ updatedAt, serverVersion }: Stamp) => ({ updatedAt, serverVersion });
