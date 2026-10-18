import { sql } from 'drizzle-orm';

import type { DbExecutor } from '../database.ts';
import { changeLog } from '../db/schema/index.ts';

// Serialisierte Sync-Clock und Änderungsprotokoll (Spezifikation 0, Abschnitt 10). Positionen werden in
// der Schreibtransaktion unter der Zeilensperre der Clock vergeben, also in Commit-Reihenfolge.
// Den vollständigen Push/Pull-Rahmen liefert das Sync-Ticket (#99) auf dieser Grundlage.

/** Nächste Position der Sync-Clock; sperrt die Clock bis zum Ende der Transaktion. */
export async function nextServerVersion(tx: DbExecutor): Promise<bigint> {
  const result = await tx.execute<{ position: string }>(
    sql`update sync_clock set position = position + 1 where id = 1 returning position::text as position`,
  );
  const position = result.rows[0]?.position;
  if (position === undefined) throw new Error('Sync-Clock fehlt');
  return BigInt(position);
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
  await tx.insert(changeLog).values({
    position: change.position,
    entityType: change.entityType,
    entityId: change.entityId,
    operation: change.operation,
    ownerPersonId: change.ownerPersonId ?? null,
    couplingId: change.couplingId ?? null,
    recipientPersonId: change.recipientPersonId ?? null,
    createdAt: change.createdAt,
  });
}
