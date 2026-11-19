import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { EntityId, Instant } from '@abnehm/contracts/base';
import { contractFixtures } from '@abnehm/contracts/fixtures';
import {
  defaultNotificationSetting,
  NotificationIntent,
  notificationIntentId,
  notificationSettingId,
  notificationTarget,
  ServerPushData,
} from '@abnehm/contracts/notifications';
import { notificationTexts } from '@abnehm/contracts/notification-texts';

import { deliveryAttempt, pushInstallation, session } from '../src/db/schema/index.ts';
import { insertNotificationIntent } from '../src/sync/notification-intents.ts';
import type { ExpoPushMessage } from '../src/notifications/expo-push.ts';
import { call, defaultPassword, signIn } from './support/auth-client.ts';
import { sendOp } from './support/encouragement.ts';
import {
  attemptsOf,
  encourage,
  hours,
  installationActive,
  intentStatus,
  minutes,
  nowOf,
  pushWorld,
  registerInstallation,
  secondBackend,
  type PushWorld,
} from './support/push-delivery.ts';
import { pullAll, push, upsertOp } from './support/sync.ts';

// Push-Zusteller (Spezifikation 5, Abschnitt 9 und Testing Decisions; #142) mit isoliertem Postgres,
// echter Hono-App, Testuhr und Fake-Expo-Push-Port.

const annasToken = 'ExponentPushToken[anna-iphone]';

async function pushStatusOf(world: PushWorld, encouragementId: string) {
  const change = (await pullAll(world.backend, world.philipp.device)).changes.find((entry) => entry.entityId === encouragementId);
  return change?.type === 'record' ? (change.data as { pushStatus: string }).pushStatus : undefined;
}

const deliver = (world: PushWorld) => world.backend.pushDelivery.deliverDue(nowOf(world.clock));
const receipts = (world: PushWorld) => world.backend.pushDelivery.processReceipts(nowOf(world.clock));

/** Zahl der Nachrichten, die Expo erreicht haben können, je Intent und Token. */
function sendsPerTarget(messages: readonly ExpoPushMessage[]) {
  const counts = new Map<string, number>();
  for (const message of messages) counts.set(`${message.data.intentId}|${message.to}`, (counts.get(`${message.data.intentId}|${message.to}`) ?? 0) + 1);
  return counts;
}

describe('Push-Zusteller', { timeout: 30_000 }, () => {
  it('Tracer Bullet: Philipp feuert Anna an; ihr iPhone erhält den Push, nach der Quittung ist er zugestellt', async () => {
    const world = await pushWorld();
    const { backend, clock, fake } = world;
    const { encouragementId, intentId } = await encourage(world);

    await deliver(world);

    expect(fake.reached()).toEqual([
      {
        to: annasToken,
        title: 'Philipp feuert dich an',
        body: 'Gemeinsam für Momo 🐣',
        data: { intentId, target: { type: 'partner', focus: 'received_encouragement' } },
        ttl: 86_400,
        channelId: 'partner_momo',
        interruptionLevel: 'active',
      },
    ]);
    expect(ServerPushData.safeParse(fake.reached()[0]!.data).success).toBe(true);
    expect(await attemptsOf(backend, intentId)).toMatchObject([{ status: 'gesendet', attemptCount: 1 }]);
    expect(await intentStatus(backend, intentId)).toBe('offen');
    expect(await pushStatusOf(world, encouragementId)).toBe('ausstehend');

    // Quittungen frühestens 15 Minuten nach dem Senden.
    clock.advanceBy(minutes(15) - 1);
    await receipts(world);
    expect(fake.receiptRequests).toEqual([]);

    clock.advanceBy(1);
    await receipts(world);
    expect(fake.receiptRequests).toHaveLength(1);
    expect(await attemptsOf(backend, intentId)).toMatchObject([{ status: 'quittiert' }]);
    expect(await intentStatus(backend, intentId)).toBe('zugestellt');

    // Der Endstatus steht auf der Anfeuerung und kommt per Pull an.
    expect(await pushStatusOf(world, encouragementId)).toBe('zugestellt');
  });

  it('der Commit eines neuen Intents stößt die Zustellung direkt an', async () => {
    const world = await pushWorld();
    const stop = await world.backend.pushDelivery.listen();
    try {
      const { intentId } = await encourage(world);
      await vi.waitFor(() => expect(world.fake.reached().map((message) => message.data.intentId)).toEqual([intentId]), { timeout: 5_000 });
    } finally {
      await stop();
    }
  });

  it('Arbeitsschleife und Aufbewahrung laufen über die Job-Registry; Zustellversuche bleiben 30 Tage', async () => {
    const world = await pushWorld();
    const { intentId } = await encourage(world);

    await world.backend.jobs.runDue();
    expect(world.fake.reached()).toHaveLength(1);

    world.clock.advanceBy(minutes(15));
    await world.backend.jobs.runDue();
    expect(await intentStatus(world.backend, intentId)).toBe('zugestellt');

    // Die Aufbewahrung läuft täglich; am 30. Tag nach dem Versuch bleibt er, am Lauf danach ist er weg.
    world.clock.advanceBy(30 * hours(24) - minutes(15) - 1);
    await world.backend.jobs.runDue();
    expect(await attemptsOf(world.backend, intentId)).toHaveLength(1);

    world.clock.advanceBy(hours(24));
    await world.backend.jobs.runDue();
    expect(await attemptsOf(world.backend, intentId)).toEqual([]);
  });
});

describe('höchstens einmal', { timeout: 30_000 }, () => {
  it('Absturz nach dem Festschreiben: der Neustart sendet nicht erneut; ohne Quittung ist der Intent fehlgeschlagen', async () => {
    const world = await pushWorld();
    const { encouragementId, intentId } = await encourage(world);
    world.fake.failNextSend('absturz');

    // Der erste Prozess bleibt in der Anfrage hängen und kommt nie zurück.
    void deliver(world);
    await vi.waitFor(() => expect(world.fake.requests).toHaveLength(1));

    const restarted = secondBackend(world.backend, world.clock);
    await restarted.pushDelivery.deliverDue(nowOf(world.clock));
    world.clock.advanceBy(hours(1));
    await restarted.pushDelivery.deliverDue(nowOf(world.clock));
    await restarted.pushDelivery.processReceipts(nowOf(world.clock));

    expect(world.fake.requests).toHaveLength(1);
    expect(await attemptsOf(world.backend, intentId)).toMatchObject([{ status: 'aufgegeben', errorCode: 'ausgang_unbekannt', attemptCount: 1 }]);
    expect(await intentStatus(world.backend, intentId)).toBe('fehlgeschlagen');
    expect(await pushStatusOf(world, encouragementId)).toBe('fehlgeschlagen');
  });

  it('Zeitüberschreitung: kein erneuter Versand, der Ausgang bleibt unbekannt', async () => {
    const world = await pushWorld();
    const { intentId } = await encourage(world);
    world.fake.failNextSend({ type: 'unknown', code: 'zeitueberschreitung' });

    await deliver(world);
    world.clock.advanceBy(minutes(10));
    await deliver(world);
    await receipts(world);

    expect(world.fake.requests).toHaveLength(1);
    expect(await attemptsOf(world.backend, intentId)).toMatchObject([{ status: 'aufgegeben', errorCode: 'zeitueberschreitung' }]);
    expect(await intentStatus(world.backend, intentId)).toBe('fehlgeschlagen');
  });

  it('zwei parallele Arbeitsschleifen senden jede Nachricht genau einmal, in Stapeln von höchstens 100', async () => {
    const world = await pushWorld();
    for (let index = 0; index < 39; index++) await registerInstallation(world.backend, world.anna.device);
    const intents = [await encourage(world), await encourage(world), await encourage(world)];
    const other = secondBackend(world.backend, world.clock);

    await Promise.all([world.backend.pushDelivery.deliverDue(nowOf(world.clock)), other.pushDelivery.deliverDue(nowOf(world.clock))]);

    const counts = sendsPerTarget(world.fake.reached());
    expect(counts.size).toBe(120);
    expect([...counts.values()].every((count) => count === 1)).toBe(true);
    expect(world.fake.requests.every(({ messages }) => messages.length <= 100)).toBe(true);
    for (const { intentId } of intents) expect(await attemptsOf(world.backend, intentId)).toHaveLength(40);
  });
});

describe('Bündeln', { timeout: 30_000 }, () => {
  it('120 Nachrichten gehen in zwei Anfragen mit 100 und 20 Nachrichten', async () => {
    const world = await pushWorld();
    for (let index = 0; index < 39; index++) await registerInstallation(world.backend, world.anna.device);
    for (let index = 0; index < 3; index++) await encourage(world);

    await deliver(world);

    expect(world.fake.requests.map(({ messages }) => messages.length)).toEqual([100, 20]);
  });
});

describe('Wiederholen', { timeout: 30_000 }, () => {
  it('nach einem Verbindungsfehler vor dem Senden: erneut mit wachsendem Abstand', async () => {
    const world = await pushWorld();
    const { intentId } = await encourage(world);
    world.fake.failNextSend({ type: 'not_sent', retryable: true, code: 'ECONNREFUSED' });
    world.fake.failNextSend({ type: 'not_sent', retryable: true, code: 'http_503' });

    await deliver(world);
    expect(await attemptsOf(world.backend, intentId)).toMatchObject([{ status: 'geplant', attemptCount: 1, errorCode: 'ECONNREFUSED' }]);

    world.clock.advanceBy(30_000 - 1);
    await deliver(world);
    expect(world.fake.requests).toHaveLength(1);

    world.clock.advanceBy(1);
    await deliver(world);
    expect(world.fake.requests).toHaveLength(2);

    // Der zweite Abstand ist doppelt so lang.
    world.clock.advanceBy(60_000 - 1);
    await deliver(world);
    expect(world.fake.requests).toHaveLength(2);
    world.clock.advanceBy(1);
    await deliver(world);

    expect(world.fake.reached()).toHaveLength(1);
    expect(await attemptsOf(world.backend, intentId)).toMatchObject([{ status: 'gesendet', attemptCount: 3 }]);
  });

  it('nach einem vorübergehenden Fehler-Ticket: erneut gesendet und dann quittiert', async () => {
    const world = await pushWorld();
    const { intentId } = await encourage(world);
    world.fake.ticketErrorFor(annasToken, 'MessageRateExceeded');

    await deliver(world);
    expect(await attemptsOf(world.backend, intentId)).toMatchObject([{ status: 'ticket_fehler', errorCode: 'MessageRateExceeded' }]);

    world.clock.advanceBy(30_000);
    await deliver(world);
    world.clock.advanceBy(minutes(15));
    await receipts(world);

    expect(world.fake.reached()).toHaveLength(2);
    expect(await attemptsOf(world.backend, intentId)).toMatchObject([{ status: 'quittiert', attemptCount: 2 }]);
    expect(await intentStatus(world.backend, intentId)).toBe('zugestellt');
  });

  it('nach fünf Sendungen ist Schluss: aufgegeben, der Intent fehlgeschlagen', async () => {
    const world = await pushWorld();
    const { intentId } = await encourage(world);
    for (let index = 0; index < 6; index++) world.fake.failNextSend({ type: 'not_sent', retryable: true, code: 'ECONNREFUSED' });

    for (let index = 0; index < 6; index++) {
      await deliver(world);
      world.clock.advanceBy(minutes(10));
    }

    expect(world.fake.requests).toHaveLength(5);
    expect(await attemptsOf(world.backend, intentId)).toMatchObject([{ status: 'aufgegeben', attemptCount: 5 }]);
    expect(await intentStatus(world.backend, intentId)).toBe('fehlgeschlagen');
  });

  it('höchstens 24 Stunden nach Erzeugung: danach aufgegeben, ohne weiteren Versand', async () => {
    const world = await pushWorld();
    const { intentId } = await encourage(world);
    world.fake.failNextSend({ type: 'not_sent', retryable: true, code: 'ECONNREFUSED' });

    await deliver(world);
    world.clock.advanceBy(hours(24) + 1);
    await deliver(world);

    expect(world.fake.requests).toHaveLength(1);
    expect(await attemptsOf(world.backend, intentId)).toMatchObject([{ status: 'aufgegeben', errorCode: 'frist_abgelaufen' }]);
    expect(await intentStatus(world.backend, intentId)).toBe('fehlgeschlagen');
  });

  it('ein Intent, der erst nach 24 Stunden zum Zuge kommt, wird nicht mehr gesendet', async () => {
    const world = await pushWorld();
    const { intentId } = await encourage(world);

    world.clock.advanceBy(hours(24) + 1);
    await deliver(world);

    expect(world.fake.requests).toEqual([]);
    expect(await intentStatus(world.backend, intentId)).toBe('fehlgeschlagen');
  });

  it('keine Wiederholung bei dauerhaft abgelehnter Anfrage oder dauerhaftem Fehler-Ticket', async () => {
    const world = await pushWorld();
    const first = await encourage(world);
    world.fake.failNextSend({ type: 'not_sent', retryable: false, code: 'http_400' });
    await deliver(world);
    const second = await encourage(world);
    world.fake.ticketErrorFor(annasToken, 'MessageTooBig');
    await deliver(world);

    world.clock.advanceBy(hours(1));
    await deliver(world);

    expect(world.fake.requests).toHaveLength(2);
    expect(await attemptsOf(world.backend, first.intentId)).toMatchObject([{ status: 'aufgegeben', errorCode: 'http_400' }]);
    expect(await attemptsOf(world.backend, second.intentId)).toMatchObject([{ status: 'aufgegeben', errorCode: 'MessageTooBig' }]);
    expect(await intentStatus(world.backend, second.intentId)).toBe('fehlgeschlagen');
  });
});

describe('Quittungen', { timeout: 30_000 }, () => {
  it('ohne Quittung wird nach 15 Minuten erneut gefragt; nach 24 Stunden ist der Intent fehlgeschlagen', async () => {
    const world = await pushWorld();
    const { intentId } = await encourage(world);
    world.fake.receiptFor(annasToken, 'fehlt');
    await deliver(world);

    world.clock.advanceBy(minutes(15));
    await receipts(world);
    world.clock.advanceBy(minutes(1));
    await receipts(world);
    expect(world.fake.receiptRequests).toHaveLength(1);
    world.clock.advanceBy(minutes(14));
    await receipts(world);
    expect(world.fake.receiptRequests).toHaveLength(2);
    expect(await intentStatus(world.backend, intentId)).toBe('offen');

    world.clock.advanceBy(hours(24));
    await receipts(world);
    expect(await attemptsOf(world.backend, intentId)).toMatchObject([{ status: 'quittung_fehler', errorCode: 'quittung_fehlt' }]);
    expect(await intentStatus(world.backend, intentId)).toBe('fehlgeschlagen');
  });

  it('ein gescheiterter Abruf wird beim nächsten Lauf nach 15 Minuten wiederholt', async () => {
    const world = await pushWorld();
    const { intentId } = await encourage(world);
    await deliver(world);
    world.fake.failNextReceipts();

    world.clock.advanceBy(minutes(15));
    await receipts(world);
    world.clock.advanceBy(minutes(15));
    await receipts(world);

    expect(world.fake.receiptRequests).toHaveLength(2);
    expect(await intentStatus(world.backend, intentId)).toBe('zugestellt');
  });
});

describe('ungültige Tokens', { timeout: 30_000 }, () => {
  it('DeviceNotRegistered im Ticket deaktiviert die Installation', async () => {
    const world = await pushWorld();
    const { intentId } = await encourage(world);
    world.fake.ticketErrorFor(annasToken, 'DeviceNotRegistered');

    await deliver(world);

    expect(await installationActive(world.backend, world.annasIphone.installationKey)).toBe(false);
    expect(await attemptsOf(world.backend, intentId)).toMatchObject([{ status: 'aufgegeben', errorCode: 'DeviceNotRegistered' }]);
    expect(await intentStatus(world.backend, intentId)).toBe('fehlgeschlagen');

    const next = await encourage(world);
    await deliver(world);
    expect(await intentStatus(world.backend, next.intentId)).toBe('keine_installation');
  });

  it('DeviceNotRegistered in der Quittung deaktiviert die Installation', async () => {
    const world = await pushWorld();
    const { encouragementId, intentId } = await encourage(world);
    world.fake.receiptFor(annasToken, 'DeviceNotRegistered');
    await deliver(world);

    world.clock.advanceBy(minutes(15));
    await receipts(world);

    expect(await installationActive(world.backend, world.annasIphone.installationKey)).toBe(false);
    expect(await attemptsOf(world.backend, intentId)).toMatchObject([{ status: 'quittung_fehler', errorCode: 'DeviceNotRegistered' }]);
    expect(await pushStatusOf(world, encouragementId)).toBe('fehlgeschlagen');
  });

  it('deaktiviert sofort, auch wenn die App seit dem Senden mit demselben Token neu registriert hat', async () => {
    const world = await pushWorld();
    await encourage(world);
    world.fake.receiptFor(annasToken, 'DeviceNotRegistered');
    await deliver(world);

    // App-Start mit Erlaubnis: dieselbe Registrierung erneut (Spezifikation 5, Abschnitt 9).
    world.clock.advanceBy(minutes(1));
    await registerInstallation(world.backend, world.anna.device, world.annasIphone);
    world.clock.advanceBy(minutes(14));
    await receipts(world);

    expect(await installationActive(world.backend, world.annasIphone.installationKey)).toBe(false);
  });

  it('die nächste Registrierung der App aktiviert die Installation wieder', async () => {
    const world = await pushWorld();
    await encourage(world);
    world.fake.ticketErrorFor(annasToken, 'DeviceNotRegistered');
    await deliver(world);
    expect(await installationActive(world.backend, world.annasIphone.installationKey)).toBe(false);

    await registerInstallation(world.backend, world.anna.device, { ...world.annasIphone, expoPushToken: 'ExponentPushToken[anna-iphone-neu]' });
    const next = await encourage(world);
    await deliver(world);

    expect(world.fake.reached().filter((message) => message.data.intentId === next.intentId).map((message) => message.to)).toEqual([
      'ExponentPushToken[anna-iphone-neu]',
    ]);
  });
});

describe('Empfänger prüfen', { timeout: 30_000 }, () => {
  it('keine Zustellung an eine Installation, deren Sitzung nach einer Passwortänderung auf einem anderen Gerät widerrufen ist', async () => {
    const world = await pushWorld();
    const tablet = (await signIn(world.backend, 'anna@example.test', defaultPassword)).device;
    const changed = await call(world.backend, 'POST', '/v1/auth/change-password', tablet, {
      currentPassword: defaultPassword,
      newPassword: 'ganz-neue-passphrase',
    });
    expect(changed.status).toBe(200);
    const { encouragementId, intentId } = await encourage(world);

    await deliver(world);

    expect(world.fake.requests).toEqual([]);
    expect(await intentStatus(world.backend, intentId)).toBe('keine_installation');
    // Auf der Anfeuerung erscheint `keine_installation` als `fehlgeschlagen`.
    expect(await pushStatusOf(world, encouragementId)).toBe('fehlgeschlagen');
  });

  it('keine Zustellung an eine Installation mit abgelaufener Sitzung', async () => {
    const world = await pushWorld();
    const { intentId } = await encourage(world);
    // Annas Sitzung läuft genau jetzt ab (Serveruhr); Philipps bleibt gültig.
    const [installation] = await world.backend.database.db
      .select({ sessionId: pushInstallation.sessionId })
      .from(pushInstallation)
      .where(eq(pushInstallation.installationKey, world.annasIphone.installationKey));
    await world.backend.database.db.update(session).set({ expiresAt: new Date(world.clock.read().instant) }).where(eq(session.id, installation!.sessionId));

    await deliver(world);

    expect(world.fake.requests).toEqual([]);
    expect(await intentStatus(world.backend, intentId)).toBe('keine_installation');
  });

  it('eine Sitzung, die zwischen Planung und Senden endet, bekommt keinen Push', async () => {
    const world = await pushWorld();
    const { intentId } = await encourage(world);
    world.fake.failNextSend({ type: 'not_sent', retryable: true, code: 'ECONNREFUSED' });
    await deliver(world);

    await world.backend.database.db.delete(session);
    world.clock.advanceBy(30_000);
    await deliver(world);

    expect(world.fake.requests).toHaveLength(1);
    expect(await attemptsOf(world.backend, intentId)).toMatchObject([{ status: 'aufgegeben', errorCode: 'sitzung_ungueltig' }]);
    expect(await intentStatus(world.backend, intentId)).toBe('fehlgeschlagen');
  });

  it('„Partner-Pushes“ aus beim Zustellen: unterdrückt, auch wenn sie beim Erzeugen an waren', async () => {
    const world = await pushWorld();
    const { encouragementId, intentId } = await encourage(world);
    const settingId = notificationSettingId(EntityId.parse(world.anna.personId));
    await push(world.backend, world.anna.device, [
      upsertOp(settingId, { ...defaultNotificationSetting, partnerPushEnabled: false }, { entityType: 'notification_setting' }),
    ]);

    await deliver(world);

    expect(world.fake.requests).toEqual([]);
    expect(await intentStatus(world.backend, intentId)).toBe('unterdrueckt');
    expect(await pushStatusOf(world, encouragementId)).toBe('unterdrueckt');
  });

  it('ohne Installation: keine_installation, auf der Anfeuerung fehlgeschlagen', async () => {
    const world = await pushWorld();
    const operation = sendOp();
    await push(world.backend, world.anna.device, [operation]);
    const intentId = notificationIntentId({
      sourceEventId: operation.payload.encouragementId,
      recipientPersonId: EntityId.parse(world.philipp.personId),
      type: 'anfeuern',
    });

    await deliver(world);

    expect(world.fake.requests).toEqual([]);
    expect(await intentStatus(world.backend, intentId)).toBe('keine_installation');
    expect(await pushStatusOf(world, operation.payload.encouragementId)).toBe('fehlgeschlagen');
  });

  it('mehrere Installationen: je eine Nachricht; zugestellt, sobald eine quittiert hat', async () => {
    const world = await pushWorld();
    const tablet = await registerInstallation(world.backend, world.anna.device, { platform: 'android', expoPushToken: 'ExponentPushToken[anna-tablet]' });
    const { intentId } = await encourage(world);
    world.fake.receiptFor(tablet.expoPushToken, 'MessageTooBig');

    await deliver(world);
    world.clock.advanceBy(minutes(15));
    await receipts(world);

    expect(world.fake.reached().map((message) => message.to).sort()).toEqual([annasToken, 'ExponentPushToken[anna-tablet]']);
    expect((await attemptsOf(world.backend, intentId)).map((attempt) => attempt.status).sort()).toEqual(['quittiert', 'quittung_fehler']);
    expect(await intentStatus(world.backend, intentId)).toBe('zugestellt');
  });

  it('keine Zustellung an eine deaktivierte Installation', async () => {
    const world = await pushWorld();
    await call(world.backend, 'POST', `/v1/push-installations/${world.annasIphone.installationKey}/deactivate`, world.anna.device);
    const { intentId } = await encourage(world);

    await deliver(world);

    expect(world.fake.requests).toEqual([]);
    expect(await intentStatus(world.backend, intentId)).toBe('keine_installation');
  });
});

describe('Nachricht je Intent-Typ', { timeout: 30_000 }, () => {
  /** Jeder gültige Intent aus den Vertrags-Fixtures, für Anna als Empfängerin. */
  async function intentsForAnna(world: PushWorld) {
    const intents: NotificationIntent[] = [];
    for (const fixture of Object.values(contractFixtures.notifications!.NotificationIntent!.valid)) {
      const parsed = NotificationIntent.parse(fixture);
      const sourceEventId = EntityId.parse(randomUUID());
      const recipientPersonId = EntityId.parse(world.anna.personId);
      const intent = NotificationIntent.parse({
        ...parsed,
        sourceEventId,
        recipientPersonId,
        intentId: notificationIntentId({ sourceEventId, recipientPersonId, type: parsed.type }),
        createdAt: Instant.parse(world.clock.read().instant),
      });
      await world.backend.database.db.transaction((tx) => insertNotificationIntent(tx, intent));
      intents.push(intent);
    }
    return intents;
  }

  it('Kanal, Unterbrechungsstufe, ttl und data für jeden Typ; Typen ohne Text im Katalog werden nicht gesendet', async () => {
    const world = await pushWorld();
    const intents = await intentsForAnna(world);

    await deliver(world);

    const sent = new Map(world.fake.reached().map((message) => [message.data.intentId, message]));
    for (const intent of intents) {
      const rendered = notificationTexts.renderStored(intent.messageKey, intent.payload);
      if (rendered.type === 'contract_error') {
        expect(sent.has(intent.intentId), intent.messageKey).toBe(false);
        expect(await intentStatus(world.backend, intent.intentId), intent.messageKey).toBe('fehlgeschlagen');
        continue;
      }
      expect(sent.get(intent.intentId), intent.messageKey).toEqual({
        to: annasToken,
        ...rendered.text,
        data: { intentId: intent.intentId, target: notificationTarget(intent) },
        ttl: 86_400,
        channelId: 'partner_momo',
        interruptionLevel: 'active',
      });
    }
    // Spezifikation 5 liefert Anfeuern und Entkopplung, Spezifikation 4 bisher Rollenwahl und Levelaufstieg.
    expect([...sent.values()].map((message) => message.title).sort()).toEqual([
      'Anna feuert dich an',
      'Anna hat eure Kopplung beendet',
      'Anna schlägt eure Rollen vor',
      'Momo ist jetzt auf Level 7 🎉',
    ]);
  });

  it('Textkatalog-Rendering für alle registrierten Typen ohne Gesundheitswerte', async () => {
    const world = await pushWorld();
    await intentsForAnna(world);

    await deliver(world);

    expect(world.fake.reached().length).toBeGreaterThan(0);
    for (const message of world.fake.reached()) {
      const text = `${message.title} ${message.body} ${JSON.stringify(message.data)}`;
      expect(text, message.title).not.toMatch(/kcal|kalorie|\bkg\b|gewicht|\bml\b|wasser|prozent|%|\bmin\b|schritte|\d+\s*(?:g|l)\b/i);
    }
  });
});

describe('Zustellversuche', { timeout: 30_000 }, () => {
  it('gehören nur dem Server und tragen Ticket, Versuche und Zeitpunkte', async () => {
    const world = await pushWorld();
    const { intentId } = await encourage(world);
    await deliver(world);

    const [attempt] = await world.backend.database.db.select().from(deliveryAttempt).where(eq(deliveryAttempt.intentId, intentId));
    expect(attempt).toMatchObject({
      recipientPersonId: world.anna.personId,
      status: 'gesendet',
      attemptCount: 1,
      expoTicketId: expect.stringContaining('ticket'),
      sentAt: new Date(world.clock.read().instant),
    });
    // Kein Fach-Sync: Weder Anna noch Philipp erhalten Zustellversuche oder Tokens per Pull.
    for (const device of [world.anna.device, world.philipp.device]) {
      const pulled = JSON.stringify((await pullAll(world.backend, device)).changes);
      expect(pulled).not.toContain('ExponentPushToken');
      expect(pulled).not.toContain(attempt!.id);
    }
  });
});
