import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { notificationFixtures } from '../fixtures/notifications.ts';
import { challenge, sharedAction } from '../fixtures/ids.ts';
import { defineNotificationTexts, notificationText, notificationTexts } from '../src/notification-texts.ts';
import { NotificationIntent } from '../src/notifications.ts';

// Ein Testkatalog belegt das Gerüst; die echten Einträge liefern die Spezifikationen 4 und 5.
const catalog = defineNotificationTexts({
  levelaufstieg: notificationText(z.strictObject({ level: z.int().min(2) }), ({ level }) => ({
    title: `Momo ist jetzt auf Level ${level} 🎉`,
    body: 'Das habt ihr gemeinsam geschafft. Schaut auf eurer Insel vorbei.',
  })),
  entkopplung: notificationText(z.strictObject({ senderDisplayName: z.string() }), ({ senderDisplayName }) => ({
    title: `${senderDisplayName} hat eure Kopplung beendet`,
    body: 'Momo und eure Insel sind archiviert.',
  })),
});

describe('Textkatalog für Benachrichtigungen', () => {
  it('erzeugt Titel und Text aus Schlüssel und typisierten Werten', () => {
    expect(catalog.render('levelaufstieg', { level: 7 })).toEqual({
      title: 'Momo ist jetzt auf Level 7 🎉',
      body: 'Das habt ihr gemeinsam geschafft. Schaut auf eurer Insel vorbei.',
    });
    expect(catalog.render('entkopplung', { senderDisplayName: 'Anna' }).title).toBe('Anna hat eure Kopplung beendet');
  });

  it('macht unbekannte Schlüssel und falsche Werte zum Typfehler', () => {
    // @ts-expect-error – unbekannter Schlüssel
    expect(() => catalog.render('anfeuern', {})).toThrow();
    // @ts-expect-error – Werte eines anderen Eintrags
    expect(() => catalog.render('levelaufstieg', { senderDisplayName: 'Anna' })).toThrow();
  });

  it('meldet gespeicherte unbekannte Schlüssel und ungültige Werte als Vertragsfehler', () => {
    expect(catalog.renderStored('levelaufstieg', { level: 7 })).toEqual({
      type: 'rendered',
      text: catalog.render('levelaufstieg', { level: 7 }),
    });
    expect(catalog.renderStored('toString', {})).toEqual({
      type: 'contract_error',
      error: { code: 'unknown_catalog_key', retryable: false },
    });
    expect(catalog.renderStored('levelaufstieg', { level: 1 })).toEqual({
      type: 'contract_error',
      error: { code: 'invalid_payload', retryable: false },
    });
  });

  it('der gemeinsame Katalog: Rollenwahl-Anfrage (Spezifikation 4, Abschnitt 12)', () => {
    const values = { actionId: sharedAction, kind: 'rollenwahl', senderDisplayName: 'Anna' } as const;
    expect(notificationTexts.render('rollen_anfrage.rollenwahl', values)).toEqual({
      title: 'Anna schlägt eure Rollen vor',
      body: 'Wenn du zustimmst, schlüpft Momo 🐣',
    });
    // Der Rollentausch hat einen eigenen Text, den das Ticket „Rollentausch“ liefert.
    expect(notificationTexts.renderStored('rollen_anfrage.rollenwahl', { ...values, kind: 'rollentausch' })).toMatchObject({
      type: 'contract_error',
      error: { code: 'invalid_payload' },
    });
  });

  it('der gemeinsame Katalog: Levelaufstieg (Spezifikation 4, Abschnitt 12; #200)', () => {
    expect(notificationTexts.render('levelaufstieg', { level: 7 })).toEqual({
      title: 'Momo ist jetzt auf Level 7 🎉',
      body: 'Das habt ihr gemeinsam geschafft. Schaut auf eurer Insel vorbei.',
    });
    expect(notificationTexts.renderStored('levelaufstieg', { level: 1 })).toMatchObject({ type: 'contract_error', error: { code: 'invalid_payload' } });
  });

  it('der gemeinsame Katalog: Challenge-Vorschlag mit dem Namen der Vorlage aus dem Spielkatalog (Spezifikation 4, Abschnitt 12; #210)', () => {
    const payload = { challengeId: challenge, templateKey: 'gut_getrunken', expiresAt: '2026-10-16T12:00:00.000Z', senderDisplayName: 'Anna' };
    expect(notificationTexts.render('challenge_vorschlag', { ...payload, templateName: 'Gut getrunken' })).toEqual({
      title: 'Anna schlägt eine Challenge vor',
      body: 'Gut getrunken – sieben Tage gemeinsam. Magst du mitmachen?',
    });
    // Ohne den Namen, den der Zusteller ergänzt, kann der Katalog den Intent nicht darstellen.
    expect(notificationTexts.renderStored('challenge_vorschlag', payload)).toMatchObject({ type: 'contract_error', error: { code: 'invalid_payload' } });
  });

  it('der Eintrag passt zu Schlüssel und Werten des Intents aus den Fixtures', () => {
    for (const name of ['Rollenwahl', 'Levelaufstieg an Anna'] as const) {
      const intent = NotificationIntent.parse(notificationFixtures.NotificationIntent.valid[name]);
      expect(notificationTexts.renderStored(intent.messageKey, intent.payload)).toMatchObject({ type: 'rendered' });
    }
  });

  it('Anfeuern: „Anna feuert dich an“ mit der Kurzbotschaft (Spezifikation 5, Abschnitt 9)', () => {
    expect(notificationTexts.render('anfeuern', { senderDisplayName: 'Anna', encouragementKey: 'gemeinsam_fuer_momo' })).toEqual({
      title: 'Anna feuert dich an',
      body: 'Gemeinsam für Momo 🐣',
    });
  });

  it('Entkopplung: „Anna hat eure Kopplung beendet“ als Information (Spezifikation 5, Abschnitt 9)', () => {
    const entkopplung = NotificationIntent.parse(notificationFixtures.NotificationIntent.valid['Entkopplung']);
    expect(notificationTexts.renderStored(entkopplung.messageKey, entkopplung.payload)).toEqual({
      type: 'rendered',
      text: { title: 'Anna hat eure Kopplung beendet', body: 'Momo und eure Insel sind archiviert.' },
    });
  });

  it('der gemeinsame Katalog: neues Gebiet, mit und ohne Namen aus dem Spielkatalog (Spezifikation 4, Abschnitt 12; #204)', () => {
    const text = { title: 'Neues Gebiet auf eurer Insel 🏝️', body: 'Der Nebel zieht ab – es gibt etwas zu entdecken.' };
    expect(notificationTexts.render('gebiet', { gebietKey: 'schilfwiese', gebietName: 'Schilfwiese' })).toEqual(text);
    // Endlose Gebiete stehen nicht im Katalog; der Zusteller ergänzt dann keinen Namen.
    expect(notificationTexts.renderStored('gebiet', { gebietKey: 'endlos_1_duenen' })).toEqual({ type: 'rendered', text });
  });

  it('Schlüssel ohne Eintrag sind ein Typfehler', () => {
    // @ts-expect-error – Einträge kommen mit den Tickets der Spezifikationen 4 und 5
    expect(() => notificationTexts.render('projektabschluss', { templateKey: 'gartenhaeuschen' })).toThrow();
    expect(notificationTexts.renderStored('projektabschluss', { templateKey: 'gartenhaeuschen' })).toMatchObject({ type: 'contract_error' });
  });
});
