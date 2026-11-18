import type { DbExecutor } from '../database.ts';
import { nextServerVersion, nextServerVersions, recordChange, recordChanges } from '../sync/change-log.ts';

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

/**
 * Wie `changeWriter`, aber für viele neue Zeilen derselben Entität in einem Schritt: ein Block
 * aufeinanderfolgender Serverversionen in der Reihenfolge von `ids`, ein gemeinsamer Eintrag ins
 * Änderungsprotokoll. `writeRows` legt je ID die Zeile mit ihrem Stempel an.
 */
export function batchChangeWriter(tx: DbExecutor, at: Date) {
  return async (scope: Scope, ids: readonly string[], writeRows: (stamped: readonly (Stamp & { id: string })[]) => Promise<void>) => {
    if (ids.length === 0) return;
    const first = await nextServerVersions(tx, ids.length);
    const stamped = ids.map((id, index) => ({ id, createdAt: at, updatedAt: at, serverVersion: first + BigInt(index) }));
    await writeRows(stamped);
    await recordChanges(
      tx,
      stamped.map(({ id, serverVersion }) => ({ position: serverVersion, operation: 'upsert' as const, createdAt: at, ...scope, entityId: id })),
    );
  };
}

/** Bei einer Änderung bleibt `created_at` erhalten. */
export const updated = ({ updatedAt, serverVersion }: Stamp) => ({ updatedAt, serverVersion });
