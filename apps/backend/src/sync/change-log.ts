import { sql } from 'drizzle-orm';

import type { DbExecutor } from '../database.ts';
import { changeLog } from '../db/schema/index.ts';

// Serialisierte Sync-Clock und Änderungsprotokoll (Spezifikation 0, Abschnitt 10). Positionen werden in
// der Schreibtransaktion unter der Zeilensperre der Clock vergeben, also in Commit-Reihenfolge.
// Push und Pull (`sync.ts`) bauen darauf auf.

/**
 * Sperrt die Sync-Clock bis zum Ende der Transaktion, ohne eine Position zu vergeben. Ein Push nimmt die
 * Sperre zuerst; so gilt Last-Write-Wins in Server-Eingangsreihenfolge auch zwischen Prüfen und Schreiben.
 */
export async function lockSyncClock(tx: DbExecutor): Promise<void> {
  const result = await tx.execute(sql`select position from sync_clock where id = 1 for update`);
  if (result.rows.length !== 1) throw new Error('Sync-Clock fehlt');
}

/** Letzte vergebene Position, wie sie der Snapshot der laufenden Transaktion sieht. */
export async function currentServerVersion(tx: DbExecutor): Promise<bigint> {
  const result = await tx.execute<{ position: string }>(sql`select position::text as position from sync_clock where id = 1`);
  const position = result.rows[0]?.position;
  if (position === undefined) throw new Error('Sync-Clock fehlt');
  return BigInt(position);
}

/** Nächste Position der Sync-Clock; sperrt die Clock bis zum Ende der Transaktion. */
export async function nextServerVersion(tx: DbExecutor): Promise<bigint> {
  return nextServerVersions(tx, 1);
}

/**
 * Vergibt `count` aufeinanderfolgende Positionen in einem Schritt und liefert die erste; sperrt die Clock
 * wie `nextServerVersion`. Für Befehle, die viele Zeilen auf einmal anlegen, etwa das Schlüpfen.
 */
export async function nextServerVersions(tx: DbExecutor, count: number): Promise<bigint> {
  if (!Number.isInteger(count) || count < 1) throw new RangeError('Mindestens eine Position');
  const result = await tx.execute<{ position: string }>(
    sql`update sync_clock set position = position + ${count} where id = 1 returning position::text as position`,
  );
  const position = result.rows[0]?.position;
  if (position === undefined) throw new Error('Sync-Clock fehlt');
  return BigInt(position) - BigInt(count) + 1n;
}

export type Change = Readonly<{
  position: bigint;
  entityType: string;
  entityId: string;
  operation: 'upsert' | 'delete';
  /** Sichtbarkeitsgrenze; mindestens eine davon ist gesetzt. */
  ownerPersonId?: string;
  couplingId?: string;
  recipientPersonId?: string;
  createdAt: Date;
}>;

/** Trägt eine Änderung unter der zuvor mit `nextServerVersion` vergebenen Position ein. */
export async function recordChange(tx: DbExecutor, change: Change): Promise<void> {
  await recordChanges(tx, [change]);
}

/** Trägt mehrere Änderungen unter ihren zuvor vergebenen Positionen in einem Schritt ein. */
export async function recordChanges(tx: DbExecutor, changes: readonly Change[]): Promise<void> {
  if (changes.length === 0) return;
  await tx.insert(changeLog).values(
    changes.map((change) => ({
      position: change.position,
      entityType: change.entityType,
      entityId: change.entityId,
      operation: change.operation,
      ownerPersonId: change.ownerPersonId ?? null,
      couplingId: change.couplingId ?? null,
      recipientPersonId: change.recipientPersonId ?? null,
      createdAt: change.createdAt,
    })),
  );
}
