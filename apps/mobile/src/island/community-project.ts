import { and, asc, eq, isNull, sum } from 'drizzle-orm';

import { EntityId } from '@abnehm/contracts/base';
import { energyBookingId } from '@abnehm/contracts/energy';
import { ContributeToProject, contributeToProjectKey, type CommonStage, type IslandProgress, type IslandRole } from '@abnehm/contracts/island';
import { gameCatalog } from '@abnehm/game-rules/content';
import { contributionOption, decideContribution, landmarks, projectTemplate, shareNeed, type ContributionDecision, type ContributionOption, type Landmark } from '@abnehm/game-rules/projects';

import { appendBooking, energyBookingEntity, readEnergy, removeUnconfirmedBooking } from '../energy';
import type { ReadContext, TransactionContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import { communityProject, projectContribution } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import type { LocalCommand } from '../sync';
import { onlyTheGameService, playingRole, type IslandCommandDependencies } from './island-access';

// Gemeinschaftsprojekte in der App (Spezifikation 4, Abschnitte 2.1, 8 und 11; #208). Einzahlen geht offline:
// Projekteinzahlung und `project_contribution_debit` stehen lokal sofort mit ihrer Outbox-Operation in einer
// Transaktion, der eigene Anteil und die eigene Hälfte wachsen damit. Den eigenen exakten Anteil rechnet das
// Gerät nur aus den eigenen Einzahlungen; den gemeinsamen Stand kennt es nur als Stufe aus dem Inselfortschritt.
// Projektabschluss, Wahrzeichen und das nächste Projekt kommen erst mit dem Sync. Lehnt der Server dauerhaft ab,
// verschwinden Einzahlung und Buchung in derselben Transaktion wie die Operation; kürzt er den Betrag auf den
// Restbedarf, ersetzt der kanonische Datensatz den lokalen.

/** Das aktive Gemeinschaftsprojekt aus Sicht der Person. */
export type IslandProject = Readonly<{
  projectId: EntityId;
  /** Ein neues Wahrzeichen oder der Ausbau eines vorhandenen. */
  kind: 'projekt' | 'ausbau';
  templateKey: string;
  /** Name aus dem Spielkatalog; `null`, wenn der Katalog dieser App den Schlüssel noch nicht kennt. */
  name: string | null;
  /** Bauplatz des Wahrzeichens, das entsteht bzw. wächst; dort steht das Gerüst. `null` wie `name`. */
  site: string | null;
  ownRole: IslandRole;
  /** Eigene Einzahlungen in den Anteil der eigenen Rolle und dessen Bedarf; exakt nur für die Person selbst. */
  own: Readonly<{ paid: number; need: number }>;
  /** Was das Gerät zum Einzahlen anbietet, nach den Spielregeln (`contributionOption`). */
  contribution: ContributionOption;
  /** Gemeinsamer Fortschritt nur als Stufe, aus dem Inselfortschritt. */
  stage: CommonStage;
}>;

/**
 * Das aktive Projekt der Projektion und die Wahrzeichen der fertigen, erkannt an ihren gespeicherten
 * Vorlagenschlüsseln; `null`, solange das Projekt lokal fehlt. `energy` ist der angezeigte eigene Bestand.
 */
export function readProjects(
  tx: ReadContext,
  { islandId, progress, personId, ownRole, energy }: Readonly<{ islandId: EntityId; progress: IslandProgress; personId: EntityId; ownRole: IslandRole; energy: number }>,
): Readonly<{ project: IslandProject; landmarks: readonly Landmark[] }> | null {
  const db = sqliteOf(tx);
  const rows = db.select().from(communityProject).where(eq(communityProject.islandId, islandId)).orderBy(asc(communityProject.sequenceNumber)).all();
  const active = rows.find((row) => row.id === progress.activeProject.projectId);
  if (active === undefined) return null;
  const template = projectTemplate(gameCatalog, active.templateKey);
  const own = { paid: ownPaid(tx, active.id, personId, ownRole), need: shareNeed(active, ownRole) };
  return {
    project: {
      projectId: EntityId.parse(active.id),
      kind: template?.kind ?? 'projekt',
      templateKey: active.templateKey,
      name: template?.name ?? null,
      site: template?.site ?? null,
      ownRole,
      own,
      contribution: contributionOption(own, energy),
      stage: progress.activeProject.stage,
    },
    landmarks: landmarks(gameCatalog, rows.filter((row) => row.status === 'fertig').map((row) => row.templateKey)),
  };
}

/** Summe der eigenen Einzahlungen in den Anteil einer Rolle. */
function ownPaid(tx: ReadContext, projectId: string, personId: string, role: IslandRole): number {
  const [row] = sqliteOf(tx)
    .select({ paid: sum(projectContribution.amount).mapWith(Number) })
    .from(projectContribution)
    .where(and(eq(projectContribution.communityProjectId, projectId), eq(projectContribution.personId, personId), eq(projectContribution.role, role)))
    .all();
  return row?.paid ?? 0;
}

export type ContributeOutcome =
  | Readonly<{ type: 'eingezahlt'; amount: number }>
  | Exclude<ContributionDecision, { type: 'erlaubt' }>
  /** Nur auf dem Gerät: kein aktives Projekt einer geschlüpften, aktiven Insel. */
  | Readonly<{ type: 'verboten'; reason: 'kein_projekt' }>;

/** Zahlt in den Anteil der eigenen Rolle am aktiven Projekt ein, in der Transaktion des Aufrufers. */
export function contributeToProject(
  tx: TransactionContext,
  { writer, newId, clock }: IslandCommandDependencies,
  request: Readonly<{ projectId: EntityId; amount: number }>,
): ContributeOutcome {
  const own = readOwnPerson(tx);
  const db = sqliteOf(tx);
  const project = db.select().from(communityProject).where(eq(communityProject.id, request.projectId)).get();
  const role = own && project && playingRole(tx, { islandId: project.islandId, couplingId: project.couplingId, personId: own.id });
  if (own === undefined || project === undefined || role == null || project.status !== 'aktiv') return { type: 'verboten', reason: 'kein_projekt' };
  const personId = EntityId.parse(own.id);

  const decision = decideContribution({
    requested: request.amount,
    share: { paid: ownPaid(tx, project.id, personId, role), need: shareNeed(project, role) },
    balance: readEnergy(tx, personId).balance,
    checkedBy: 'geraet',
  });
  if (decision.type === 'verboten') return decision;

  const { instant, localDate } = clock.read();
  const payload = ContributeToProject.parse({ commandId: newId(), contributionId: newId(), projectId: project.id, amount: decision.amount, localDate });
  const bookingId = energyBookingId(payload.commandId);
  // Erst die Buchung, auf die die Einzahlung verweist.
  appendBooking(tx, {
    type: 'project_contribution_debit',
    id: bookingId,
    personId,
    amount: -decision.amount,
    localDate,
    bookingKey: payload.commandId,
    createdAt: instant,
    trigger: { commandId: payload.commandId, projectId: payload.projectId },
  });
  db.insert(projectContribution).values({
    id: payload.contributionId,
    communityProjectId: payload.projectId,
    personId,
    role,
    amount: decision.amount,
    energyBookingId: bookingId,
    commandId: payload.commandId,
    createdAt: instant,
    serverVersion: null,
  }).run();
  writer.command(tx, {
    type: 'contributeToProject',
    businessKey: contributeToProjectKey(payload.commandId),
    payload,
    knownServerVersion: null,
    affectedRefs: [
      { entityType: energyBookingEntity.entityType, entityId: bookingId },
      { entityType: 'project_contribution', entityId: payload.contributionId },
    ],
    referencePaths: [],
  });
  return { type: 'eingezahlt', amount: decision.amount };
}

/**
 * Der Fachbefehl für die lokale Befehls-Registry. Erzeugen darf ihn nur der Spieldienst (`contributeToProject`
 * oben), der vorher prüft; die Registry braucht ihn für die Reconciliation einer dauerhaften Ablehnung.
 */
export const contributeToProjectCommand: LocalCommand<ContributeToProject> = {
  type: 'contributeToProject',
  payload: ContributeToProject,
  referencePaths: [],
  apply: onlyTheGameService('contributeToProject'),
  reconcileRejected(tx, operation) {
    const { commandId, contributionId } = ContributeToProject.parse(operation.payload);
    // Erst die Einzahlung, sie verweist auf die Buchung.
    sqliteOf(tx).delete(projectContribution).where(and(eq(projectContribution.id, contributionId), isNull(projectContribution.serverVersion))).run();
    removeUnconfirmedBooking(tx, energyBookingId(commandId));
  },
};

/** Die Fachbefehle der Gemeinschaftsprojekte für alle Befehls-Registries. */
export const communityProjectCommands: readonly LocalCommand[] = [contributeToProjectCommand];
