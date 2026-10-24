import { eq } from 'drizzle-orm';

import { EntityId } from '@abnehm/contracts/base';

import type { DbExecutor } from '../database.ts';
import { coupling, couplingMember, island } from '../db/schema/index.ts';
import { revokeCoupling } from '../partner-projections/revocation.ts';
import { lockSyncClock, nextServerVersion, recordChange } from '../sync/change-log.ts';
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

/** `abgelehnt` gibt es nur bei ungültigem Zustand, nämlich einer schon archivierten Kopplung. */
export type UncouplingResult = Readonly<{ status: 'angenommen' | 'abgelehnt'; partnerPersonId: EntityId }>;

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
        await recordUncouplingAction(tx, { ...action, status: 'abgelehnt' });
        return { status: 'abgelehnt', partnerPersonId };
      }
      // Die Mitglieder folgen dem Status per `ON UPDATE CASCADE`; damit endet der Partnerzugriff.
      await stamped(tx, 'coupling', couplingId, at, (serverVersion) =>
        tx.update(coupling).set({ status: 'archiviert', endedAt: at, updatedAt: at, serverVersion }).where(eq(coupling.id, couplingId)).returning({ id: coupling.id }),
      );
      await stamped(tx, 'island', couplingId, at, (serverVersion) =>
        tx.update(island).set({ state: 'archiviert', updatedAt: at, serverVersion }).where(eq(island.couplingId, couplingId)).returning({ id: island.id }),
      );
      await withdrawOpenSharedActions(tx, couplingId, at);
      await recordUncouplingAction(tx, { ...action, status: 'angenommen' });
      for (const observer of observers.values()) await observer(tx, { couplingId, at });
      await revokeCoupling(tx, couplingId, at);
      return { status: 'angenommen', partnerPersonId };
    },
  };
}

/** Schreibt eine Zeile der Kopplung unter neuer Serverversion und trägt sie ins Änderungsprotokoll ein. */
async function stamped(tx: DbExecutor, entityType: 'coupling' | 'island', couplingId: EntityId, at: Date, write: (serverVersion: bigint) => Promise<{ id: string }[]>) {
  const serverVersion = await nextServerVersion(tx);
  const [row] = await write(serverVersion);
  if (row === undefined) throw new Error(`${entityType} der Kopplung fehlt`);
  await recordChange(tx, { position: serverVersion, entityType, entityId: row.id, operation: 'upsert', couplingId, createdAt: at });
}
