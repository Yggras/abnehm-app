import { describe, expect, it } from 'vitest';

import { encouragementMessages, notificationTexts } from '../src/notification-texts.ts';
import {
  EncouragementKey,
  encouragementPushStatus,
  remainingEncouragementPushes,
  SendEncouragement,
  sendEncouragementKey,
} from '../src/partner.ts';

// Nachweis für #123: Katalog, Pushberechtigung und Zähler des Anfeuerns (Spezifikation 5, Abschnitt 4).

const createdAt = '2026-10-14T12:00:00.000Z';
const hours = (n: number) => new Date(Date.parse(createdAt) + n * 3_600_000).toISOString();

describe('Anfeuern-Katalog', () => {
  it('enthält genau die fünf Botschaften aus Abschnitt 4 im gemeinsamen Textkatalog', () => {
    expect(encouragementMessages).toEqual({
      du_schaffst_das: 'Du schaffst das! 💪',
      ich_denk_an_dich: 'Ich denk an dich ❤️',
      stark_heute: 'Stark heute! 🎉',
      gemeinsam_fuer_momo: 'Gemeinsam für Momo 🐣',
      stolz_auf_dich: 'Bin stolz auf dich 🌟',
    });
    expect(Object.keys(encouragementMessages)).toEqual(EncouragementKey.options);
  });

  it('der Push „Anna feuert dich an“ trägt die Kurzbotschaft', () => {
    expect(notificationTexts.render('anfeuern', { senderDisplayName: 'Anna', encouragementKey: 'gemeinsam_fuer_momo' })).toEqual({
      title: 'Anna feuert dich an',
      body: 'Gemeinsam für Momo 🐣',
    });
    expect(notificationTexts.renderStored('anfeuern', { senderDisplayName: 'Anna', encouragementKey: 'Trink was' })).toMatchObject({
      type: 'contract_error',
      error: { code: 'invalid_payload' },
    });
  });
});

describe('Pushberechtigung', () => {
  it('bis einschließlich der dritten Anfeuerung des Absendertags mit Push, danach ohne', () => {
    const decide = (earlierToday: number) => encouragementPushStatus({ earlierToday, createdAt, receivedAt: createdAt });
    expect([0, 1, 2, 3, 4].map(decide)).toEqual(['ausstehend', 'ausstehend', 'ausstehend', 'ohne_push', 'ohne_push']);
  });

  it('nur bei Eingang spätestens 24 Stunden nach createdAt', () => {
    const decide = (receivedAt: string) => encouragementPushStatus({ earlierToday: 0, createdAt, receivedAt });
    expect(decide(hours(24))).toBe('ausstehend');
    expect(decide(new Date(Date.parse(hours(24)) + 1).toISOString())).toBe('ohne_push');
    // Eine vorgehende Geräteuhr verhindert den Push nicht.
    expect(decide(hours(-1))).toBe('ausstehend');
  });
});

describe('Zähler im Sheet', () => {
  it('zählt die Anfeuerungen mit Push herunter, nie unter null', () => {
    expect([0, 1, 2, 3, 7].map(remainingEncouragementPushes)).toEqual([3, 2, 1, 0, 0]);
  });
});

describe('Nutzlast von sendEncouragement', () => {
  const payload = {
    encouragementId: '0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b77',
    messageKey: 'stark_heute',
    createdAt,
    localDate: '2026-10-14',
    timeZone: 'Europe/Berlin',
    utcOffsetMinutes: 120,
  };

  it('nimmt einen unbekannten Schlüssel an, damit der Server ihn als unknown_catalog_key ablehnt', () => {
    expect(SendEncouragement.safeParse({ ...payload, messageKey: 'kleiner_stups' }).success).toBe(true);
    expect(SendEncouragement.safeParse({ ...payload, messageKey: 'Kleiner Stups: Trink was 💧' }).success).toBe(false);
  });

  it('kennt keinen Empfänger: Den leitet der Server aus der Kopplung ab', () => {
    expect(SendEncouragement.safeParse({ ...payload, recipientPersonId: '0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b02' }).success).toBe(false);
  });

  it('fachlicher Schlüssel je Anfeuerung', () => {
    expect(sendEncouragementKey(SendEncouragement.parse(payload).encouragementId)).toBe(`anfeuern:${payload.encouragementId}`);
  });
});
