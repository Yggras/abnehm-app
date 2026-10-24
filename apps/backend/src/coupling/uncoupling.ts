import { eq } from 'drizzle-orm';

import { EntityId } from '@abnehm/contracts/base';
import type { CanonicalChange } from '@abnehm/contracts/sync';

import type { DbExecutor } from '../database.ts';
import { coupling, couplingMember, island } from '../db/schema/index.ts';
import { revokeCoupling } from '../partner-projections/revocation.ts';
import { lockSyncClock } from '../sync/change-log.ts';
import { canonicalAfterWrite } from '../sync/sync.ts';
import { changeWriter, updated } from './change-writer.ts';
import { couplingEntity } from './coupling-entities.ts';
import { recordUncouplingAction, withdrawOpenSharedActions } from './shared-actions.ts';

// Entkopplungs-Kern (Spezifikation 0, Abschnitt 9). Entkoppeln ist einseitig: Der Kern nimmt eine
// gültige Entkopplung sofort an und archiviert in derselben Transaktion Kopplung und Insel, beendet
// offene gemeinsame Aktionen, lässt registrierte Beobachter ihre Vorgänge neutral beenden (Spezifikation
// 4: Challenge-Vorschläge und aktive Challenge) und erzeugt die Revocation-Notices. Ab dem Commit endet
// der Partnerzugriff; der Pull liefert dann nur noch Notices und den Archivstatus. Den Befehl
// `requestUncoupling` samt Intent und Sicherheitslog liefert Spezifikation 5.

export type UncouplingRequest = Readonly<{
  /** ID der gemeinsamen Aktion vom Typ `entkoppeln`; sie vergibt das Gerät. */
  actionId: EntityId;
  couplingId: EntityId;
  /** Ein Mitglied der Kopplung; geprüft hat das die Autorisierung des aufrufenden Befehls. */
  requesterPersonId: EntityId;
  at: Date;
}>;

/**
 * `abgelehnt` gibt es nur bei ungültigem Zustand, nämlich einer schon archivierten Kopplung. `changes`
 * sind Entkopplung und Archivstatus der Kopplung, die beide die antragstellende Person lesen darf.
 */
export type UncouplingResult = Readonly<{ status: 'angenommen' | 'abgelehnt'; partnerPersonId: EntityId; changes: CanonicalChange[] }>;

/** Beendet in der Transaktion des Kerns die eigenen Vorgänge der Kopplung neutral, ohne Push. */
export type UncouplingObserver = (tx: DbExecutor, context: Readonly<{ couplingId: EntityId; at: Date }>) => Promise<void>;

export type Uncoupling = {
  /** Meldet einen Beobachter an; Bereiche enden so mit der Kopplung, ohne den Kern zu ändern. */
  registerObserver(name: string, observer: UncouplingObserver): void;
  /** Läuft in der Transaktion des Aufrufers; wirft ein Beobachter, rollt die ganze Entkopplung zurück. */
  uncouple(tx: DbExecutor, request: UncouplingRequest): Promise<UncouplingResult>;
};

export function createUncoupling(): Uncoupling {
  const observers = new Map<string, UncouplingObserver>();

  return {
    registerObserver(name, observer) {
      if (observers.has(name)) throw new Error(`Entkopplungs-Beobachter ${name} ist schon angemeldet`);
      observers.set(name, observer);
    },
    async uncouple(tx, { actionId, couplingId, requesterPersonId, at }) {
      // Dieselbe Sperrfolge wie Push und Kopplungsannahme: zuerst die Sync-Clock, dann die Kopplung.
      await lockSyncClock(tx);
      const [current] = await tx.select({ status: coupling.status }).from(coupling).where(eq(coupling.id, couplingId)).for('update');
      const members = await tx.select({ personId: couplingMember.personId }).from(couplingMember).where(eq(couplingMember.couplingId, couplingId));
      const partner = members.find((member) => member.personId !== requesterPersonId);
      if (current === undefined || partner === undefined || !members.some((member) => member.personId === requesterPersonId)) {
        throw new Error('Entkoppeln kann nur ein Mitglied der Kopplung');
      }
      const partnerPersonId = EntityId.parse(partner.personId);
      const action = { id: actionId, couplingId, requesterPersonId, at };

      if (current.status === 'archiviert') {
        const rejected = await recordUncouplingAction(tx, { ...action, status: 'abgelehnt' });
        return { status: 'abgelehnt', partnerPersonId, changes: [rejected, await canonicalAfterWrite(tx, couplingEntity, couplingId)] };
      }
      const write = changeWriter(tx, at);
      // Die Mitglieder folgen dem Status per `ON UPDATE CASCADE`; damit endet der Partnerzugriff.
      await write({ entityType: 'coupling', couplingId }, async (stamp) => {
        await tx.update(coupling).set({ status: 'archiviert', endedAt: at, ...updated(stamp) }).where(eq(coupling.id, couplingId));
        return couplingId;
      });
      const [archivedIsland] = await tx.select({ id: island.id }).from(island).where(eq(island.couplingId, couplingId));
      if (archivedIsland === undefined) throw new Error('Insel der Kopplung fehlt');
      await write({ entityType: 'island', couplingId }, async (stamp) => {
        await tx.update(island).set({ state: 'archiviert', ...updated(stamp) }).where(eq(island.id, archivedIsland.id));
        return archivedIsland.id;
      });
      await withdrawOpenSharedActions(tx, couplingId, at);
      const accepted = await recordUncouplingAction(tx, { ...action, status: 'angenommen' });
      for (const observer of observers.values()) await observer(tx, { couplingId, at });
      await revokeCoupling(tx, couplingId, at);
      return { status: 'angenommen', partnerPersonId, changes: [accepted, await canonicalAfterWrite(tx, couplingEntity, couplingId)] };
    },
  };
}
