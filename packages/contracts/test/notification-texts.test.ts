import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { notificationFixtures } from '../fixtures/notifications.ts';
import { sharedAction } from '../fixtures/ids.ts';
import { defineNotificationTexts, notificationText, notificationTexts } from '../src/notification-texts.ts';

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

  it('der Eintrag passt zu Schlüssel und Werten des Intents aus den Fixtures', () => {
    const rollenwahl = notificationFixtures.NotificationIntent.valid['Rollenwahl'];
    expect(notificationTexts.renderStored(rollenwahl.messageKey, rollenwahl.payload)).toMatchObject({ type: 'rendered' });
  });

  it('Schlüssel ohne Eintrag sind ein Typfehler', () => {
    // @ts-expect-error – Einträge kommen mit den Tickets der Spezifikationen 4 und 5
    expect(() => notificationTexts.render('levelaufstieg', { level: 7 })).toThrow();
    expect(notificationTexts.renderStored('levelaufstieg', { level: 7 })).toMatchObject({ type: 'contract_error' });
  });
});
