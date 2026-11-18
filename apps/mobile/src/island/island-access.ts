import { and, eq, isNull, ne } from 'drizzle-orm';

import type { Clock } from '@abnehm/clock';
import type { EntityId } from '@abnehm/contracts/base';
import { IslandRole } from '@abnehm/contracts/island';

import type { TransactionContext } from '../local-db';
import { couplingMember, island, islandObject } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import type { SyncWriter } from '../sync';

// Gemeinsame Prüfungen der Inselbefehle auf dem Gerät: Bauen (#191), Aufwerten und Platzieren (#194).

/** Abhängigkeiten der Inselbefehle im Spieldienst. */
export type IslandCommandDependencies = Readonly<{
  writer: SyncWriter;
  newId: () => EntityId;
  /** Zeitpunkt und lokaler Tag der Änderung. */
  clock: Clock;
}>;

/**
 * Die Rolle der Person auf einer geschlüpften, aktiven Insel in aktiver Kopplung, sonst `null`. Ohne
 * Rolle ist die Insel noch nicht geschlüpft.
 */
export function playingRole(tx: TransactionContext, at: Readonly<{ islandId: string; couplingId: string; personId: string }>): IslandRole | null {
  const db = sqliteOf(tx);
  const current = db.select({ state: island.state }).from(island).where(eq(island.id, at.islandId)).get();
  const member = db
    .select({ role: couplingMember.role, status: couplingMember.couplingStatus })
    .from(couplingMember)
    .where(and(eq(couplingMember.couplingId, at.couplingId), eq(couplingMember.personId, at.personId)))
    .get();
  if (current?.state !== 'aktiv' || member?.role == null || member.status !== 'aktiv') return null;
  return IslandRole.parse(member.role);
}

/** Das nicht gelöschte Objekt auf einem Feld, außer `except`; lokales Gegenstück zu `vacateField` am Server. */
export function occupantOf(tx: TransactionContext, fieldId: string, except?: string): string | undefined {
  return sqliteOf(tx)
    .select({ id: islandObject.id })
    .from(islandObject)
    .where(and(eq(islandObject.fieldId, fieldId), isNull(islandObject.deletedAt), except === undefined ? undefined : ne(islandObject.id, except)))
    .get()?.id;
}

/** `apply` der Inselbefehle: Sie entstehen nur im Spieldienst, der vorher prüft. */
export function onlyTheGameService(type: string): () => never {
  return () => {
    throw new Error(`${type} entsteht nur im Spieldienst`);
  };
}
