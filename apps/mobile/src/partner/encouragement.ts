import { and, eq, isNull, ne } from 'drizzle-orm';

import type { Clock } from '@abnehm/clock';
import { EntityId, type DisplayName, type LocalDate } from '@abnehm/contracts/base';
import {
  EncouragementRecord,
  encouragementPushStatus,
  remainingEncouragementPushes,
  SendEncouragement,
  sendEncouragementKey,
  type EncouragementKey,
} from '@abnehm/contracts/partner';

import type { ReadContext, TransactionContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import { coupling, couplingMember, encouragement } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import type { LocalCommand, SyncWriter } from '../sync';
import { serverManagedEntity } from '../sync/sqlite-entity';

// Anfeuern in der App (Spezifikation 5, Abschnitte 4 und 10; #123). Die Anfeuerung entsteht lokal sofort
// samt Outbox-Operation `sendEncouragement` in einer Transaktion; offline geht sie beim nächsten Push
// raus. Der Server bestimmt Empfänger und Push-Status selbst und bestätigt mit dem kanonischen Datensatz;
// lehnt er dauerhaft ab, verschwindet die Zeile mit der Operation. Ohne React Native, damit Node-Tests laden.

/** Die Anfeuerung im App-Sync: nur per Pull und als Ergebnis der Fachbefehle, kein generisches Update. */
export const encouragementEntity = serverManagedEntity({
  entityType: 'encouragement',
  ownerField: 'couplingId',
  record: EncouragementRecord,
  table: encouragement,
});

/** Was das Sheet `partner.encourage` zeigt; `solo` ohne aktive Kopplung, etwa nach dem Entkoppeln. */
export type EncourageSheet =
  | Readonly<{ type: 'solo' }>
  | Readonly<{ type: 'coupled'; partnerDisplayName: DisplayName; remainingPushes: number }>;

export type EncourageOutcome = Readonly<{ type: 'gesendet' }> | Readonly<{ type: 'nicht_gekoppelt' }>;

export type EncourageDependencies = Readonly<{ writer: SyncWriter; newId: () => EntityId; clock: Clock }>;

type ActivePartner = Readonly<{ personId: EntityId; couplingId: EntityId; partnerPersonId: EntityId; partnerDisplayName: DisplayName }>;

/** Eigene Person und Partner der aktiven Kopplung; `null` solo oder ohne eigene Person. */
function activePartner(tx: ReadContext): ActivePartner | null {
  const own = readOwnPerson(tx);
  if (own === undefined) return null;
  const db = sqliteOf(tx);
  const partner = db
    .select({ couplingId: couplingMember.couplingId, personId: couplingMember.personId, displayName: couplingMember.displayName })
    .from(couplingMember)
    .innerJoin(coupling, eq(coupling.id, couplingMember.couplingId))
    .where(and(eq(coupling.status, 'aktiv'), ne(couplingMember.personId, own.id), isNull(couplingMember.deletedAt)))
    .get();
  if (partner === undefined) return null;
  return {
    personId: EntityId.parse(own.id),
    couplingId: EntityId.parse(partner.couplingId),
    partnerPersonId: EntityId.parse(partner.personId),
    partnerDisplayName: partner.displayName,
  };
}

/** Eigene Anfeuerungen eines lokalen Absendertags, wie sie auch der Server zählt. */
function sentOn(tx: ReadContext, personId: EntityId, localDate: LocalDate): number {
  return sqliteOf(tx)
    .select({ id: encouragement.id })
    .from(encouragement)
    .where(and(eq(encouragement.senderPersonId, personId), eq(encouragement.localDate, localDate)))
    .all().length;
}

/**
 * Inhalt des Sheets am lokalen Tag `today`: Name des Partners und wie viele Anfeuerungen heute noch als
 * Push ankommen. Die Zahl rechnet die App aus den eigenen Anfeuerungen des Tags; autoritativ ist der Server.
 */
export function readEncourageSheet(tx: ReadContext, today: LocalDate): EncourageSheet {
  const active = activePartner(tx);
  if (active === null) return { type: 'solo' };
  return {
    type: 'coupled',
    partnerDisplayName: active.partnerDisplayName,
    remainingPushes: remainingEncouragementPushes(sentOn(tx, active.personId, today)),
  };
}

/** Feuert den Partner der aktiven Kopplung an, in der Transaktion des Aufrufers. */
export function sendEncouragement(tx: TransactionContext, { writer, newId, clock }: EncourageDependencies, messageKey: EncouragementKey): EncourageOutcome {
  const active = activePartner(tx);
  if (active === null) return { type: 'nicht_gekoppelt' };
  const { instant, localDate, timeZone, utcOffsetMinutes } = clock.read();
  const payload = SendEncouragement.parse({ encouragementId: newId(), messageKey, createdAt: instant, localDate, timeZone, utcOffsetMinutes });
  // Vorläufig wie auf dem Server; den gültigen Status bringt der kanonische Datensatz.
  const pushStatus = encouragementPushStatus({ earlierToday: sentOn(tx, active.personId, localDate), createdAt: instant, receivedAt: instant });
  sqliteOf(tx).insert(encouragement).values({
    id: payload.encouragementId,
    couplingId: active.couplingId,
    senderPersonId: active.personId,
    recipientPersonId: active.partnerPersonId,
    messageKey,
    sentAt: instant,
    localDate,
    timeZone,
    utcOffsetMinutes,
    pushStatus,
    thankedAt: null,
    createdAt: instant,
    updatedAt: instant,
    deletedAt: null,
    serverVersion: null,
  }).run();
  writer.command(tx, {
    type: 'sendEncouragement',
    businessKey: sendEncouragementKey(payload.encouragementId),
    payload,
    knownServerVersion: null,
    affectedRefs: [{ entityType: encouragementEntity.entityType, entityId: payload.encouragementId }],
    referencePaths: [],
  });
  return { type: 'gesendet' };
}

/**
 * Der Fachbefehl für die lokale Befehls-Registry. Erzeugen darf ihn nur `sendEncouragement` oben, das die
 * Kopplung liest; die Registry braucht ihn für die Reconciliation einer dauerhaften Ablehnung.
 */
export const sendEncouragementCommand: LocalCommand<SendEncouragement> = {
  type: 'sendEncouragement',
  payload: SendEncouragement,
  referencePaths: [],
  apply() {
    throw new Error('sendEncouragement entsteht nur im Partnerbereich');
  },
  reconcileRejected(tx, operation) {
    const { encouragementId } = SendEncouragement.parse(operation.payload);
    sqliteOf(tx).delete(encouragement).where(and(eq(encouragement.id, encouragementId), isNull(encouragement.serverVersion))).run();
  },
};
