import { and, eq } from 'drizzle-orm';

import type { EntityId } from '@abnehm/contracts/base';
import { IslandRole } from '@abnehm/contracts/island';

import type { DbExecutor } from '../database.ts';
import { couplingMember, island } from '../db/schema/index.ts';

/**
 * Die Rolle der Person auf einer geschlüpften, aktiven Insel, sonst `null`; ohne Rolle ist die Insel noch
 * nicht geschlüpft. Die aktive Kopplung prüft vorher die Autorisierung. Gemeinsam für Bauen (#191),
 * Aufwerten und Platzieren (#194).
 */
export async function playingRole(tx: DbExecutor, at: Readonly<{ islandId: string; couplingId: EntityId; personId: EntityId }>): Promise<IslandRole | null> {
  const [current] = await tx.select({ state: island.state }).from(island).where(eq(island.id, at.islandId));
  if (current?.state !== 'aktiv') return null;
  const [member] = await tx
    .select({ role: couplingMember.role })
    .from(couplingMember)
    .where(and(eq(couplingMember.couplingId, at.couplingId), eq(couplingMember.personId, at.personId)));
  return member?.role == null ? null : IslandRole.parse(member.role);
}
