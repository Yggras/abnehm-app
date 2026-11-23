import { asc, eq, sum } from 'drizzle-orm';

import { EntityId, Instant } from '@abnehm/contracts/base';
import { energyBookingId, summarizeEnergy } from '@abnehm/contracts/energy';
import { ContributeToProject, contributeToProjectKey, type IslandRole } from '@abnehm/contracts/island';
import { islandContentId, islandEventId } from '@abnehm/contracts/island-records';
import { notificationIntentId } from '@abnehm/contracts/notifications';
import type { CanonicalChange } from '@abnehm/contracts/sync';
import { gameCatalog } from '@abnehm/game-rules/content';
import { commonStage, decideContribution, projectAt, projectOccasionKey, shareNeed } from '@abnehm/game-rules/projects';

import { policies } from '../authorization/authorization.ts';
import { changeWriter, updated } from '../coupling/change-writer.ts';
import type { DbExecutor } from '../database.ts';
import { communityProject, couplingMember, islandEvent, projectContribution } from '../db/schema/index.ts';
import { insertBooking, readBookings } from '../energy/bookings.ts';
import { CommandRejection, type ServerCommand } from '../sync/commands.ts';
import { insertNotificationIntent } from '../sync/notification-intents.ts';
import { canonicalAfterWrite } from '../sync/sync.ts';
import { gameRejection } from './game-rejection.ts';
import { communityProjectEntity, islandEventEntity, projectContributionEntity } from './island-entities.ts';
import { playingRole } from './playing-role.ts';
import { progressChanges } from './progress-change.ts';

// Gemeinschaftsprojekte auf dem Server (Spezifikation 4, Abschnitte 2.2, 2.5 und 8; Spezifikation 0, Abschnitt 4; #208).
// `contributeToProject` zahlt eigene Energie in den Anteil der aktuellen eigenen Rolle ein: Projekteinzahlung und
// `project_contribution_debit` entstehen atomar, höchstens bis zum Restbedarf des Anteils. Die Rolle kommt aus der
// Kopplung, nie aus der Nutzlast; einen Anteil des Partners kann niemand wählen. Die Autorisierung
// (`community_project`) lässt nur aktive Mitglieder der Kopplung zu, der das Projekt gehört.
//
// Sind danach beide Anteile voll, ist das Projekt im selben Befehl fertig: Das Wahrzeichen steht (abgeleitet aus
// dem fertigen Projekt und dem Katalog), das gemeinsame Ereignis „Projekt fertig“ mit dem Anlassschlüssel
// `projekt:<insel>:<nr>` und ein `projektabschluss`-Intent an beide entstehen, und das nächste Projekt beginnt
// sofort (`projectAt`: nach dem letzten Katalogprojekt ein Ausbau). Die Sperre auf der Projektzeile ordnet
// gleichzeitige Einzahlungen beider Personen; so wird ein Projekt genau einmal fertig. Danach rechnet
// `progressChanges` den Inselfortschritt mit dem neuen Projekt neu, samt möglichem Levelaufstieg.

export const contributeToProjectCommand: ServerCommand<ContributeToProject> = {
  type: 'contributeToProject',
  identity: 'none',
  policy: policies.resource('community_project', 'befehl'),
  payload: ContributeToProject,
  target: (operation) => ({ id: ContributeToProject.parse(operation.payload).projectId }),
  canonicalRequest: (operation) => ContributeToProject.parse(operation.payload),
  // Alle IDs vergibt das Gerät; ein Duplikat ist nur der Retry derselben Einzahlung.
  duplicate: () => [],
  async execute(tx, { actor, resource, payload, businessKey, at }) {
    if (businessKey !== contributeToProjectKey(payload.commandId)) throw new CommandRejection('invalid_payload');
    const couplingId = EntityId.parse(resource.couplingId);
    const [project] = await tx.select().from(communityProject).where(eq(communityProject.id, payload.projectId)).for('update');
    if (project === undefined) throw new Error('Gemeinschaftsprojekt fehlt trotz Autorisierung');
    const canonicalProject = () => canonicalAfterWrite(tx, communityProjectEntity, payload.projectId);
    if (project.status !== 'aktiv') throw new CommandRejection('conflict', await canonicalProject());
    const islandId = EntityId.parse(project.islandId);
    const role = await playingRole(tx, { islandId, couplingId, personId: actor.personId });
    if (role === null) throw new CommandRejection('conflict', await canonicalProject());

    const paid = await paidByRole(tx, payload.projectId);
    const need = { bauen: shareNeed(project, 'bauen'), natur: shareNeed(project, 'natur') };
    const bookings = (await readBookings(tx, [actor.personId])).get(actor.personId)!;
    const decision = decideContribution({
      requested: payload.amount,
      share: { paid: paid[role], need: need[role] },
      balance: summarizeEnergy(bookings).balance,
      checkedBy: 'server',
    });
    if (decision.type === 'verboten') throw gameRejection(decision, await canonicalProject());

    // Erst die Buchung, auf die die Einzahlung verweist; so kommt sie auf jedem Gerät auch zuerst an.
    const bookingId = energyBookingId(payload.commandId);
    const changes: CanonicalChange[] = [
      await insertBooking(tx, {
        type: 'project_contribution_debit',
        id: bookingId,
        personId: actor.personId,
        amount: -decision.amount,
        localDate: payload.localDate,
        bookingKey: payload.commandId,
        createdAt: Instant.parse(at.toISOString()),
        trigger: { commandId: payload.commandId, projectId: payload.projectId },
      }),
    ];
    await changeWriter(tx, at)({ entityType: 'project_contribution', ownerPersonId: actor.personId }, async ({ createdAt, serverVersion }) => {
      await tx.insert(projectContribution).values({
        id: payload.contributionId,
        communityProjectId: payload.projectId,
        personId: actor.personId,
        role,
        amount: decision.amount,
        energyBookingId: bookingId,
        commandId: payload.commandId,
        createdAt,
        serverVersion,
      });
      return payload.contributionId;
    });
    changes.push(await canonicalAfterWrite(tx, projectContributionEntity, payload.contributionId));

    paid[role] += decision.amount;
    const shares = [{ paid: paid.bauen, need: need.bauen }, { paid: paid.natur, need: need.natur }] as const;
    if (commonStage(shares) === 'geschafft') {
      changes.push(...(await completeProject(tx, { project: { ...project, islandId }, couplingId, at })));
    }
    changes.push(...(await progressChanges(tx, islandId, at)));
    return { changes, idMappings: [] };
  },
};

/** Eingezahlt je Anteil: alle Einzahlungen beider Personen mit der Rolle zum Zeitpunkt der Einzahlung. */
async function paidByRole(tx: DbExecutor, projectId: EntityId): Promise<Record<IslandRole, number>> {
  const rows = await tx
    .select({ role: projectContribution.role, amount: sum(projectContribution.amount).mapWith(Number) })
    .from(projectContribution)
    .where(eq(projectContribution.communityProjectId, projectId))
    .groupBy(projectContribution.role);
  const of = (role: IslandRole) => rows.find((row) => row.role === role)?.amount ?? 0;
  return { bauen: of('bauen'), natur: of('natur') };
}

type CompletedProject = Readonly<{ id: string; islandId: EntityId; sequenceNumber: number; templateKey: string }>;

/**
 * Projektabschluss im selben Befehl: Projekt fertig, gemeinsames Ereignis, je ein Intent an beide und das nächste
 * Projekt mit seinem beim Start festgeschriebenen Bedarf. Liefert die kanonischen Änderungen.
 */
async function completeProject(
  tx: DbExecutor,
  { project, couplingId, at }: Readonly<{ project: CompletedProject; couplingId: EntityId; at: Date }>,
): Promise<CanonicalChange[]> {
  const { islandId } = project;
  const write = changeWriter(tx, at);
  await write({ entityType: 'community_project', couplingId }, async (stamp) => {
    await tx.update(communityProject).set({ status: 'fertig', completedAt: at, ...updated(stamp) }).where(eq(communityProject.id, project.id));
    return project.id;
  });
  const changes = [await canonicalAfterWrite(tx, communityProjectEntity, EntityId.parse(project.id))];

  const next = projectAt(gameCatalog, project.sequenceNumber + 1);
  const nextId = islandContentId('community_project', islandId, String(next.sequenceNumber));
  await write({ entityType: 'community_project', couplingId }, async (stamp) => {
    await tx.insert(communityProject).values({
      id: nextId, islandId, couplingId, sequenceNumber: next.sequenceNumber, templateKey: next.templateKey, buildNeed: next.need, natureNeed: next.need, status: 'aktiv', ...stamp,
    });
    return nextId;
  });
  changes.push(await canonicalAfterWrite(tx, communityProjectEntity, nextId));

  // Der Anlassschlüssel ist eindeutig je Insel; das Ereignis entsteht also höchstens einmal.
  const occasionKey = projectOccasionKey(islandId, project.sequenceNumber);
  const eventId = islandEventId(islandId, occasionKey);
  await write({ entityType: 'island_event', couplingId }, async (stamp) => {
    await tx.insert(islandEvent).values({
      id: eventId, islandId, couplingId, type: 'projektabschluss', templateKey: project.templateKey, responsiblePersonId: null, occasionKey, status: 'abgeschlossen', reward: null,
      occurredAt: at, ...stamp,
    });
    return eventId;
  });
  changes.push(await canonicalAfterWrite(tx, islandEventEntity, eventId));

  const members = await tx.select({ personId: couplingMember.personId }).from(couplingMember).where(eq(couplingMember.couplingId, couplingId)).orderBy(asc(couplingMember.personId));
  for (const { personId } of members) {
    const recipientPersonId = EntityId.parse(personId);
    await insertNotificationIntent(tx, {
      intentId: notificationIntentId({ sourceEventId: eventId, recipientPersonId, type: 'projektabschluss' }),
      sourceEventId: eventId,
      recipientPersonId,
      type: 'projektabschluss',
      messageKey: 'projektabschluss',
      createdAt: Instant.parse(at.toISOString()),
      payload: { templateKey: project.templateKey },
    });
  }
  return changes;
}
