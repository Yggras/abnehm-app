import { randomUUID } from 'node:crypto';

import { and, eq, sum } from 'drizzle-orm';

import { EntityId, Instant, ServerVersion } from '@abnehm/contracts/base';
import { IslandProgress, type IslandRole } from '@abnehm/contracts/island';
import { islandProgress, spentOnIsland } from '@abnehm/game-rules/progress';
import { commonStage } from '@abnehm/game-rules/projects';

import { changeWriter, updated } from '../coupling/change-writer.ts';
import type { DbExecutor } from '../database.ts';
import { communityProject, couplingMember, island, islandObject, islandProgress as islandProgressTable, projectContribution } from '../db/schema/index.ts';
import { readBookings } from '../energy/bookings.ts';

// Projector Inselfortschritt (Spezifikation 4, Abschnitt 2.1; Vertrag `IslandProgress`: Spezifikation 0,
// Abschnitt 5). Er rechnet Level, Bedarf und beide Hälften mit den Spielregeln aus den Buchungen beider
// Personen und die gemeinsame Stufe des aktiven Projekts aus den Einzahlungen. Die Projektion ist
// jederzeit neu berechenbar; dauerhaft entstehen daraus nur Freischaltungen, Ereignisse und
// Projektwechsel, die ihre eigenen Befehle schreiben. Energiemengen und exakte Anteile verlassen den
// Projector nie: Gespeichert und gesendet wird nur, was `IslandProgress` kennt.

export type IslandProgressRequest = Readonly<{ islandId: EntityId; at: Date }>;

/** Berechnet den Inselfortschritt neu und schreibt ihn samt Serverversion, in der Transaktion des Aufrufers. */
export async function projectIslandProgress(tx: DbExecutor, { islandId, at }: IslandProgressRequest): Promise<IslandProgress> {
  const [found] = await tx.select({ couplingId: island.couplingId }).from(island).where(eq(island.id, islandId));
  if (found === undefined) throw new Error('Insel fehlt');
  const couplingId = EntityId.parse(found.couplingId);
  // Feste Reihenfolge der Mitglieder: nach Person, wie das Paar der Kopplung.
  const members = (await tx.select({ personId: couplingMember.personId }).from(couplingMember).where(eq(couplingMember.couplingId, couplingId)))
    .map((member) => EntityId.parse(member.personId))
    .sort();
  if (members.length !== 2) throw new Error('Eine Insel hat genau zwei Mitglieder');
  const [a, b] = members as [EntityId, EntityId];

  const holdings = {
    objectIds: new Set((await tx.select({ id: islandObject.id }).from(islandObject).where(eq(islandObject.islandId, islandId))).map((row) => row.id)),
    projectIds: new Set((await tx.select({ id: communityProject.id }).from(communityProject).where(eq(communityProject.islandId, islandId))).map((row) => row.id)),
  };
  const bookings = await readBookings(tx, members);
  const progress = islandProgress([spentOnIsland(bookings.get(a)!, holdings), spentOnIsland(bookings.get(b)!, holdings)]);

  const content = {
    members: [
      { personId: a, ...progress.halves[0] },
      { personId: b, ...progress.halves[1] },
    ],
    activeProject: await activeProject(tx, islandId),
  };
  const [current] = await tx.select({ id: islandProgressTable.id }).from(islandProgressTable).where(eq(islandProgressTable.islandId, islandId));
  const id = current?.id ?? randomUUID();
  const columns = { level: progress.level, levelNeed: progress.levelNeed, content, dataAsOf: at };
  let serverVersion = 0n;
  await changeWriter(tx, at)({ entityType: 'island_progress', couplingId }, async (stamp) => {
    serverVersion = stamp.serverVersion;
    if (current === undefined) await tx.insert(islandProgressTable).values({ id, islandId, couplingId, ...columns, ...stamp });
    else await tx.update(islandProgressTable).set({ ...columns, ...updated(stamp) }).where(eq(islandProgressTable.id, id));
    return id;
  });
  return islandProgressRecord({ islandId, couplingId, ...columns, serverVersion });
}

/** Der Inselfortschritt einer Zeile in der Form des Vertrags; geprüft, damit nie mehr gesendet wird. */
export function islandProgressRecord(row: Pick<typeof islandProgressTable.$inferSelect, 'islandId' | 'couplingId' | 'level' | 'levelNeed' | 'content' | 'dataAsOf' | 'serverVersion'>): IslandProgress {
  return IslandProgress.parse({
    islandId: row.islandId,
    couplingId: row.couplingId,
    level: row.level,
    levelNeed: row.levelNeed,
    ...row.content,
    dataAsOf: Instant.parse(row.dataAsOf.toISOString()),
    serverVersion: ServerVersion.parse(row.serverVersion.toString()),
  });
}

/** Das aktive Gemeinschaftsprojekt mit gemeinsamer Stufe aus den Einzahlungen je Anteil. */
async function activeProject(tx: DbExecutor, islandId: EntityId) {
  const [project] = await tx
    .select()
    .from(communityProject)
    .where(and(eq(communityProject.islandId, islandId), eq(communityProject.status, 'aktiv')));
  if (project === undefined) throw new Error('Eine geschlüpfte Insel hat genau ein aktives Gemeinschaftsprojekt');
  const paid = await tx
    .select({ role: projectContribution.role, amount: sum(projectContribution.amount).mapWith(Number) })
    .from(projectContribution)
    .where(eq(projectContribution.communityProjectId, project.id))
    .groupBy(projectContribution.role);
  const paidBy = (role: IslandRole) => paid.find((share) => share.role === role)?.amount ?? 0;
  return {
    projectId: project.id,
    templateKey: project.templateKey,
    sequenceNumber: project.sequenceNumber,
    stage: commonStage([
      { paid: paidBy('bauen'), need: project.buildNeed },
      { paid: paidBy('natur'), need: project.natureNeed },
    ]),
  };
}
