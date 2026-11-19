import { randomUUID } from 'node:crypto';

import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, notExists, notInArray, or, sql } from 'drizzle-orm';

import type { Clock } from '@abnehm/clock';
import type { Instant } from '@abnehm/contracts/base';
import { NotificationIntent, notificationTarget } from '@abnehm/contracts/notifications';
import { notificationTexts } from '@abnehm/contracts/notification-texts';

import type { SessionAuthenticator } from '../auth/auth-module.ts';
import type { Database, DbExecutor } from '../database.ts';
import { deliveryAttempt, notificationIntent, notificationSetting, pushInstallation } from '../db/schema/index.ts';
import type { intentTypes } from '../db/schema/notifications.ts';
import type { Job } from '../jobs/job-registry.ts';
import { errorCodeForLog } from '../log.ts';
import { NOTIFICATION_INTENT_CHANNEL } from '../sync/notification-intents.ts';
import { MAX_MESSAGES_PER_REQUEST, MAX_RECEIPT_IDS_PER_REQUEST, type ExpoPushMessage, type ExpoPushPort } from './expo-push.ts';

// Push-Zusteller (Spezifikation 5, Abschnitt 9; #142): stellt jeden `NotificationIntent` höchstens einmal
// je Installation über den Expo-Push-Port zu, holt die Quittungen und schließt den Intent ab. Er kennt die
// Intent-Typen nicht: Text und Titel kommen aus dem gemeinsamen Textkatalog, das Ziel aus dem Intent-
// Katalog; Bereiche, die den Ausgang brauchen (Anfeuern), melden einen Beobachter an.
//
// Zustellversuch je Intent und Installation (`delivery_attempt`, nur Server):
//   geplant ──senden──▶ gesendet ──Quittung ok──▶ quittiert
//      ▲                  │  │  └──Quittung Fehler / keine Quittung in 24 h──▶ quittung_fehler
//      │                  │  └──Fehler-Ticket vorübergehend──▶ ticket_fehler ──(fällig)──▶ gesendet
//      └─Verbindung scheiterte vor dem Senden┘
//   aufgegeben: dauerhafter Fehler, fünf Sendungen, 24 Stunden oder unbekannter Ausgang ohne Ticket.
// „Höchstens einmal“: Ein Versuch wird vor dem HTTP-Aufruf in eigener Transaktion `gesendet`. Nur ein
// Ausgang, der nachweislich nichts gesendet hat, führt zurück nach `geplant`.

export type IntentFinalStatus = 'unterdrueckt' | 'keine_installation' | 'zugestellt' | 'fehlgeschlagen';
type IntentType = (typeof intentTypes)[number];

/** Der abgeschlossene Intent, wie Beobachter ihn sehen. */
export type FinishedIntent = Readonly<{
  intentId: string;
  sourceEventId: string;
  recipientPersonId: string;
  type: IntentType;
  status: IntentFinalStatus;
  at: Date;
}>;

/** Läuft in der Transaktion, die den Endstatus des Intents schreibt. */
export type FinalStatusObserver = (tx: DbExecutor, intent: FinishedIntent) => Promise<void>;

/** `ttl` jeder Nachricht und Frist der Zustellung nach Erzeugung des Intents: 24 Stunden (Designwert aus #87). */
const DELIVERY_WINDOW_MS = 24 * 60 * 60_000;
/** Höchstens fünf Sendungen je Versuch (Designwert aus #87). */
const MAX_SENDS = 5;
/** Abstand vor der n-ten Wiederholung: 30 s · 2^(n−1); Designwert, nicht belegt. */
const RETRY_BASE_MS = 30_000;
/** „We recommend checking push receipts 15 minutes after sending“ (Expo, „Check push receipts for errors“). */
const RECEIPT_DELAY_MS = 15 * 60_000;
/** „push receipts are cleared after 24 hours“ (ebenda). */
const RECEIPT_WINDOW_MS = 24 * 60 * 60_000;
/**
 * Nach dieser Zeit ohne Ticket ist der Ausgang einer Sendung endgültig unbekannt: weit über der Frist
 * einer Anfrage (`expo-push.ts`), sodass keine laufende Arbeitsschleife mehr antwortet. Designwert.
 */
const UNKNOWN_OUTCOME_AFTER_MS = 10 * 60_000;
/** Aufbewahrung der Zustellversuche: 30 Tage (Spezifikation 5, Abschnitt 10). */
const RETENTION_MS = 30 * 24 * 60 * 60_000;
/** Takt der Arbeitsschleife: „in Abständen von wenigen Sekunden“ (Spezifikation 5, Abschnitt 9). */
const LOOP_INTERVAL_MS = 5_000;
/** Intents je Planungstransaktion; Designwert. */
const PLAN_BATCH = 50;

/** Expo-Fehler, bei denen eine erneute Sendung sinnvoll ist: „Implement exponential backoff and slowly retry“. */
const TRANSIENT_TICKET_ERRORS = new Set(['MessageRateExceeded']);
/** „The device cannot receive push notifications anymore“ (Expo, „Push ticket errors“). */
const DEVICE_NOT_REGISTERED = 'DeviceNotRegistered';
const TERMINAL_ATTEMPT_STATUSES = ['quittiert', 'quittung_fehler', 'aufgegeben'];

type IntentRow = typeof notificationIntent.$inferSelect;

export function createPushDelivery({
  database,
  clock,
  port,
  sessions,
}: {
  database: Database;
  clock: Clock;
  port: ExpoPushPort;
  sessions: Pick<SessionAuthenticator, 'validSessionIds'>;
}) {
  const observers = new Map<IntentType, FinalStatusObserver[]>();

  /** Gespeicherter Intent als Vertrag; `null`, wenn er dem Katalog nicht (mehr) entspricht. */
  function parsedIntent(row: IntentRow): NotificationIntent | null {
    const parsed = NotificationIntent.safeParse({
      intentId: row.intentId,
      sourceEventId: row.sourceEventId,
      recipientPersonId: row.recipientPersonId,
      type: row.type,
      messageKey: row.messageKey,
      createdAt: row.createdAt.toISOString(),
      payload: row.payload,
    });
    return parsed.success ? parsed.data : null;
  }

  /** Die Nachricht an ein Token; `null`, wenn der Textkatalog den Intent nicht darstellen kann. */
  function messageFor(row: IntentRow, to: string): ExpoPushMessage | null {
    const intent = parsedIntent(row);
    if (intent === null) return null;
    const rendered = notificationTexts.renderStored(intent.messageKey, intent.payload);
    if (rendered.type === 'contract_error') return null;
    return {
      to,
      ...rendered.text,
      data: { intentId: intent.intentId, target: notificationTarget(intent) },
      ttl: DELIVERY_WINDOW_MS / 1000,
      channelId: 'partner_momo',
      interruptionLevel: 'active',
    };
  }

  /** Schreibt den Endstatus eines offenen Intents und benachrichtigt die Beobachter seines Typs. */
  async function finish(tx: DbExecutor, row: IntentRow, status: IntentFinalStatus, at: Date) {
    const updated = await tx
      .update(notificationIntent)
      .set({ status, statusChangedAt: at })
      .where(and(eq(notificationIntent.intentId, row.intentId), eq(notificationIntent.status, 'offen')))
      .returning({ intentId: notificationIntent.intentId });
    if (updated.length === 0) return;
    const type = row.type as IntentType;
    const finished: FinishedIntent = { intentId: row.intentId, sourceEventId: row.sourceEventId, recipientPersonId: row.recipientPersonId, type, status, at };
    for (const observer of observers.get(type) ?? []) await observer(tx, finished);
  }

  // 1. Auswählen und Empfänger prüfen ------------------------------------------------------------------

  /** Plant einen Stapel offener Intents ohne Versuche; liefert, ob es weitere geben kann. */
  async function planBatch(at: Date): Promise<boolean> {
    return database.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(notificationIntent)
        .where(
          and(
            eq(notificationIntent.status, 'offen'),
            notExists(tx.select({ one: sql`1` }).from(deliveryAttempt).where(eq(deliveryAttempt.intentId, notificationIntent.intentId))),
          ),
        )
        .orderBy(asc(notificationIntent.createdAt))
        .limit(PLAN_BATCH)
        .for('update', { skipLocked: true });

      for (const row of rows) {
        // Zu alt, oder der Katalog kann ihn nicht darstellen: Es gibt nichts mehr zuzustellen.
        if (messageFor(row, '') === null) {
          console.error('[push] Intent ohne darstellbaren Text:', row.type);
          await finish(tx, row, 'fehlgeschlagen', at);
          continue;
        }
        if (at.getTime() - row.createdAt.getTime() > DELIVERY_WINDOW_MS) {
          await finish(tx, row, 'fehlgeschlagen', at);
          continue;
        }
        // Maßgeblich ist die Einstellung beim Zustellen; ohne gespeicherte Einstellung gilt der Standard (an).
        const [setting] = await tx
          .select({ partnerPushEnabled: notificationSetting.partnerPushEnabled })
          .from(notificationSetting)
          .where(eq(notificationSetting.personId, row.recipientPersonId));
        if (setting !== undefined && !setting.partnerPushEnabled) {
          await finish(tx, row, 'unterdrueckt', at);
          continue;
        }
        const installations = await tx
          .select({ id: pushInstallation.id, sessionId: pushInstallation.sessionId })
          .from(pushInstallation)
          .where(and(eq(pushInstallation.personId, row.recipientPersonId), eq(pushInstallation.active, true)));
        const valid = await sessions.validSessionIds(installations.map((installation) => installation.sessionId));
        const receivers = installations.filter((installation) => valid.has(installation.sessionId));
        if (receivers.length === 0) {
          await finish(tx, row, 'keine_installation', at);
          continue;
        }
        await tx
          .insert(deliveryAttempt)
          .values(
            receivers.map((installation) => ({
              id: randomUUID(),
              intentId: row.intentId,
              installationId: installation.id,
              recipientPersonId: row.recipientPersonId,
              status: 'geplant',
              attemptCount: 0,
              createdAt: at,
              updatedAt: at,
            })),
          )
          .onConflictDoNothing();
      }
      return rows.length === PLAN_BATCH;
    });
  }

  // 2. Senden ------------------------------------------------------------------------------------------

  type Claimed = { attemptId: string; sends: number; installationId: string; intentCreatedAt: Date; message: ExpoPushMessage };

  /** Ein Versuch kommt nicht mehr an: dauerhaft gescheitert. */
  const giveUp = (tx: DbExecutor, attemptId: string, errorCode: string, at: Date) =>
    tx.update(deliveryAttempt).set({ status: 'aufgegeben', errorCode, nextAttemptAt: null, updatedAt: at }).where(eq(deliveryAttempt.id, attemptId));

  /**
   * Deaktiviert die Installation nach `DeviceNotRegistered`, sofern sie seit der Sendung nicht neu
   * registriert wurde: Ein neues Token derselben Installation bleibt aktiv.
   */
  const deactivateInstallation = (tx: DbExecutor, installationId: string, sentAt: Date, at: Date) =>
    tx
      .update(pushInstallation)
      .set({ active: false, updatedAt: at })
      .where(and(eq(pushInstallation.id, installationId), lte(pushInstallation.updatedAt, sentAt)));

  /**
   * Schreibt fällige Versuche vor dem HTTP-Aufruf als `gesendet` fest (eigene Transaktion). `full`, wenn
   * der Stapel voll war und weitere fällige Versuche warten können, auch wenn keiner gesendet wird.
   */
  async function claimDue(at: Date): Promise<{ claimed: Claimed[]; full: boolean }> {
    return database.db.transaction(async (tx) => {
      const due = await tx
        .select({ attempt: deliveryAttempt, intent: notificationIntent, installation: pushInstallation })
        .from(deliveryAttempt)
        .innerJoin(notificationIntent, eq(notificationIntent.intentId, deliveryAttempt.intentId))
        .innerJoin(pushInstallation, eq(pushInstallation.id, deliveryAttempt.installationId))
        .where(
          and(
            inArray(deliveryAttempt.status, ['geplant', 'ticket_fehler']),
            or(isNull(deliveryAttempt.nextAttemptAt), lte(deliveryAttempt.nextAttemptAt, at)),
          ),
        )
        .orderBy(asc(deliveryAttempt.createdAt))
        .limit(MAX_MESSAGES_PER_REQUEST)
        .for('update', { of: deliveryAttempt, skipLocked: true });
      const valid = await sessions.validSessionIds(due.map(({ installation }) => installation.sessionId));

      const claimed: Claimed[] = [];
      for (const { attempt, intent, installation } of due) {
        const message = messageFor(intent, installation.expoPushToken);
        // Die Installation kann seit der Planung deaktiviert, umgehängt oder abgemeldet worden sein.
        if (!installation.active || installation.personId !== attempt.recipientPersonId) await giveUp(tx, attempt.id, 'installation_inaktiv', at);
        else if (!valid.has(installation.sessionId)) await giveUp(tx, attempt.id, 'sitzung_ungueltig', at);
        else if (at.getTime() - intent.createdAt.getTime() > DELIVERY_WINDOW_MS) await giveUp(tx, attempt.id, 'frist_abgelaufen', at);
        else if (attempt.attemptCount >= MAX_SENDS) await giveUp(tx, attempt.id, 'versuche_erschoepft', at);
        else if (message === null) await giveUp(tx, attempt.id, 'text_fehlt', at);
        else {
          const sends = attempt.attemptCount + 1;
          await tx
            .update(deliveryAttempt)
            .set({ status: 'gesendet', attemptCount: sends, sentAt: at, expoTicketId: null, errorCode: null, nextAttemptAt: null, updatedAt: at })
            .where(eq(deliveryAttempt.id, attempt.id));
          claimed.push({ attemptId: attempt.id, sends, installationId: installation.id, intentCreatedAt: intent.createdAt, message });
        }
      }
      return { claimed, full: due.length === MAX_MESSAGES_PER_REQUEST };
    });
  }

  /** Plant die nächste Sendung mit wachsendem Abstand, solange Versuche und Frist reichen. */
  async function retryLater(tx: DbExecutor, claimed: Claimed, status: 'geplant' | 'ticket_fehler', errorCode: string, at: Date) {
    const next = new Date(at.getTime() + RETRY_BASE_MS * 2 ** (claimed.sends - 1));
    if (claimed.sends >= MAX_SENDS || next.getTime() > claimed.intentCreatedAt.getTime() + DELIVERY_WINDOW_MS) {
      await giveUp(tx, claimed.attemptId, errorCode, at);
      return;
    }
    await tx.update(deliveryAttempt).set({ status, errorCode, nextAttemptAt: next, updatedAt: at }).where(eq(deliveryAttempt.id, claimed.attemptId));
  }

  /** Sendet einen Stapel; liefert, ob es weitere fällige Versuche geben kann. */
  async function sendBatch(at: Date): Promise<boolean> {
    const { claimed, full } = await claimDue(at);
    if (claimed.length === 0) return full;
    const outcome = await port.send(claimed.map(({ message }) => message));

    await database.db.transaction(async (tx) => {
      for (const [index, entry] of claimed.entries()) {
        if (outcome.type === 'unknown') {
          // Die Anfrage kann Expo erreicht haben: kein erneuter Versand. Ohne Ticket gibt es keine Quittung.
          await tx.update(deliveryAttempt).set({ errorCode: outcome.code, updatedAt: at }).where(eq(deliveryAttempt.id, entry.attemptId));
        } else if (outcome.type === 'not_sent') {
          if (outcome.retryable) await retryLater(tx, entry, 'geplant', outcome.code, at);
          else await giveUp(tx, entry.attemptId, outcome.code, at);
        } else {
          const ticket = outcome.tickets[index]!;
          if (ticket.status === 'ok') {
            await tx.update(deliveryAttempt).set({ expoTicketId: ticket.id, updatedAt: at }).where(eq(deliveryAttempt.id, entry.attemptId));
            continue;
          }
          const code = ticket.details?.error ?? 'ticket_fehler';
          if (code === DEVICE_NOT_REGISTERED) await deactivateInstallation(tx, entry.installationId, at, at);
          if (TRANSIENT_TICKET_ERRORS.has(code)) await retryLater(tx, entry, 'ticket_fehler', code, at);
          else await giveUp(tx, entry.attemptId, code, at);
        }
      }
    });
    return full;
  }

  // 3. Quittungen --------------------------------------------------------------------------------------

  /** Schließt Sendungen ab, zu denen es keine Quittung mehr geben wird. */
  async function expireReceipts(at: Date) {
    // Expo löscht Quittungen nach 24 Stunden.
    await database.db
      .update(deliveryAttempt)
      .set({ status: 'quittung_fehler', errorCode: 'quittung_fehlt', updatedAt: at })
      .where(
        and(
          eq(deliveryAttempt.status, 'gesendet'),
          isNotNull(deliveryAttempt.expoTicketId),
          lte(deliveryAttempt.sentAt, new Date(at.getTime() - RECEIPT_WINDOW_MS)),
        ),
      );
    // Ohne Ticket (Absturz, Zeitüberschreitung) bleibt der Ausgang unbekannt; zugestellt ist nur Quittiertes.
    await database.db
      .update(deliveryAttempt)
      .set({ status: 'aufgegeben', errorCode: sql`coalesce(${deliveryAttempt.errorCode}, 'ausgang_unbekannt')`, updatedAt: at })
      .where(
        and(
          eq(deliveryAttempt.status, 'gesendet'),
          isNull(deliveryAttempt.expoTicketId),
          lte(deliveryAttempt.sentAt, new Date(at.getTime() - UNKNOWN_OUTCOME_AFTER_MS)),
        ),
      );
  }

  /** Ruft einen Stapel fälliger Quittungen ab; liefert, ob es weitere geben kann. */
  async function receiptBatch(at: Date): Promise<boolean> {
    const due = new Date(at.getTime() - RECEIPT_DELAY_MS);
    // Abholen vormerken, damit eine parallele Arbeitsschleife dieselben Tickets nicht abfragt.
    const claimed = await database.db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: deliveryAttempt.id, ticketId: deliveryAttempt.expoTicketId, installationId: deliveryAttempt.installationId, sentAt: deliveryAttempt.sentAt })
        .from(deliveryAttempt)
        .where(
          and(
            eq(deliveryAttempt.status, 'gesendet'),
            isNotNull(deliveryAttempt.expoTicketId),
            lte(deliveryAttempt.sentAt, due),
            or(isNull(deliveryAttempt.receiptCheckedAt), lte(deliveryAttempt.receiptCheckedAt, due)),
          ),
        )
        .orderBy(asc(deliveryAttempt.sentAt))
        .limit(MAX_RECEIPT_IDS_PER_REQUEST)
        .for('update', { skipLocked: true });
      if (rows.length > 0) {
        await tx.update(deliveryAttempt).set({ receiptCheckedAt: at, updatedAt: at }).where(inArray(deliveryAttempt.id, rows.map((row) => row.id)));
      }
      return rows;
    });
    if (claimed.length === 0) return false;

    const outcome = await port.getReceipts(claimed.map((row) => row.ticketId!));
    if (outcome.type === 'failed') return false;
    await database.db.transaction(async (tx) => {
      for (const row of claimed) {
        const receipt = outcome.receipts[row.ticketId!];
        // Noch keine Quittung: frühestens nach weiteren 15 Minuten erneut fragen.
        if (receipt === undefined) continue;
        const terminal = and(eq(deliveryAttempt.id, row.id), eq(deliveryAttempt.status, 'gesendet'));
        if (receipt.status === 'ok') {
          await tx.update(deliveryAttempt).set({ status: 'quittiert', updatedAt: at }).where(terminal);
          continue;
        }
        const code = receipt.details?.error ?? 'quittung_fehler';
        if (code === DEVICE_NOT_REGISTERED) await deactivateInstallation(tx, row.installationId, row.sentAt!, at);
        await tx.update(deliveryAttempt).set({ status: 'quittung_fehler', errorCode: code, updatedAt: at }).where(terminal);
      }
    });
    return claimed.length === MAX_RECEIPT_IDS_PER_REQUEST;
  }

  // 4. Abschluss ---------------------------------------------------------------------------------------

  /** Schließt offene Intents ab, deren Versuche alle beendet sind; liefert, ob es weitere geben kann. */
  async function finishBatch(at: Date): Promise<boolean> {
    return database.db.transaction(async (tx) => {
      const attemptsOfIntent = eq(deliveryAttempt.intentId, notificationIntent.intentId);
      const rows = await tx
        .select()
        .from(notificationIntent)
        .where(
          and(
            eq(notificationIntent.status, 'offen'),
            sql`exists ${tx.select({ one: sql`1` }).from(deliveryAttempt).where(attemptsOfIntent)}`,
            notExists(
              tx.select({ one: sql`1` }).from(deliveryAttempt).where(and(attemptsOfIntent, notInArray(deliveryAttempt.status, TERMINAL_ATTEMPT_STATUSES))),
            ),
          ),
        )
        .limit(PLAN_BATCH)
        .for('update', { skipLocked: true });
      for (const row of rows) {
        const [acknowledged] = await tx
          .select({ id: deliveryAttempt.id })
          .from(deliveryAttempt)
          .where(and(eq(deliveryAttempt.intentId, row.intentId), eq(deliveryAttempt.status, 'quittiert')))
          .limit(1);
        await finish(tx, row, acknowledged === undefined ? 'fehlgeschlagen' : 'zugestellt', at);
      }
      return rows.length === PLAN_BATCH;
    });
  }

  async function finishAll(at: Date) {
    while (await finishBatch(at));
  }

  // Schnittstelle ---------------------------------------------------------------------------------------

  /** Plant offene Intents, sendet fällige Versuche und schließt Intents ab. */
  async function deliverDue(now: Instant) {
    const at = new Date(now);
    while (await planBatch(at));
    while (await sendBatch(at));
    await finishAll(at);
  }

  /** Holt fällige Quittungen, beendet Sendungen ohne mögliche Quittung und schließt Intents ab. */
  async function processReceipts(now: Instant) {
    const at = new Date(now);
    await expireReceipts(at);
    while (await receiptBatch(at));
    await finishAll(at);
  }

  // Ein Lauf zur Zeit je Prozess; ein Anstoß während eines Laufs führt zu genau einem weiteren.
  let running: Promise<void> | null = null;
  let again = false;
  function runLoop(): Promise<void> {
    if (running !== null) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await deliverDue(clock.read().instant);
        await processReceipts(clock.read().instant);
      } while (again);
    })().finally(() => {
      running = null;
    });
    return running;
  }

  const loopJob: Job = { name: 'push_zustellung', intervalMs: LOOP_INTERVAL_MS, run: runLoop };
  const retentionJob: Job = {
    name: 'zustellversuche_aufbewahrung',
    intervalMs: 24 * 60 * 60_000,
    async run() {
      const cutoff = new Date(Date.parse(clock.read().instant) - RETENTION_MS);
      await database.db.delete(deliveryAttempt).where(lt(deliveryAttempt.createdAt, cutoff));
    },
  };

  return {
    deliverDue,
    processReceipts,
    /** Meldet einen Beobachter für den Endstatus eines Intent-Typs an, etwa Anfeuern. */
    onFinalStatus(type: IntentType, observer: FinalStatusObserver) {
      observers.set(type, [...(observers.get(type) ?? []), observer]);
    },
    /** Arbeitsschleife und Aufbewahrung der Zustellversuche für die Job-Registry. */
    jobs: [loopJob, retentionJob] as const,
    /**
     * Hört auf neue Intents: Der Commit eines Intents stößt die Arbeitsschleife sofort an. Liefert die
     * Funktion zum Beenden.
     */
    listen: () =>
      database.listen(NOTIFICATION_INTENT_CHANNEL, () => {
        runLoop().catch((error: unknown) => console.error('[push] Zustellung nach Anstoß fehlgeschlagen:', errorCodeForLog(error)));
      }),
  };
}

export type PushDelivery = ReturnType<typeof createPushDelivery>;
