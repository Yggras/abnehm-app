import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { EntityId } from '@abnehm/contracts/base';
import { challengeRequirementId } from '@abnehm/contracts/island-records';
import { NotificationIntent } from '@abnehm/contracts/notifications';
import { notificationTexts } from '@abnehm/contracts/notification-texts';
import { withCatalogNames } from '@abnehm/game-rules/catalog';
import { gameCatalog } from '@abnehm/game-rules/content';

import { challenge, notificationIntent } from '../src/db/schema/index.ts';
import type { TestBackend } from './support/app.ts';
import type { Device } from './support/auth-client.ts';
import { authorizationCases } from './support/authorization.ts';
import {
  challengeCommandScenarios,
  challengeCouple,
  challengeIdOf,
  decideOp,
  everyDay,
  proposeOp,
  threeSportDays,
  withdrawOp,
} from './support/challenges.ts';
import { worldStart } from './support/coupled-world.ts';
import { recordsOf, uncoupleAs } from './support/shared-actions.ts';
import { pullAll, push, pushRaw } from './support/sync.ts';

// Nachweis für #210: Challenge vorschlagen, annehmen, ablehnen, zurückziehen und der Verfall nach 48 Stunden
// (Spezifikation 4, Abschnitt 10) über Push und Pull der echten Hono-App mit isoliertem Postgres, Testuhr und
// dem `PlanReader`-Fake mit hinterlegten Wochenplänen.

const hour = 60 * 60 * 1000;

async function intentsOf(backend: TestBackend) {
  const rows = await backend.database.db.select().from(notificationIntent).orderBy(notificationIntent.createdAt, notificationIntent.intentId);
  return rows.map((row) =>
    NotificationIntent.parse({
      intentId: row.intentId,
      sourceEventId: row.sourceEventId,
      recipientPersonId: row.recipientPersonId,
      type: row.type,
      messageKey: row.messageKey,
      createdAt: row.createdAt.toISOString(),
      payload: row.payload,
    }),
  );
}

/** Was die Person per Pull über Challenges und ihre eigenen Anteile erfährt. */
async function pulled(backend: TestBackend, device: Device) {
  const { changes } = await pullAll(backend, device);
  return { challenges: recordsOf(changes, 'challenge'), requirements: recordsOf(changes, 'challenge_requirement') };
}

async function rejectionOf(backend: TestBackend, device: Device, operation: Parameters<typeof push>[2][number]) {
  const [result] = await push(backend, device, [operation]);
  return result?.type === 'permanently_rejected' ? result.error.code : result?.type;
}

describe('Challenge vorschlagen und annehmen', () => {
  it('Tracer Bullet: Philipp schlägt „Gut getrunken“ vor, Anna erhält den Push und nimmt an; beide Anteile sind festgeschrieben', async () => {
    const { backend, philipp, anna, couplingId } = await challengeCouple({ annaPlan: threeSportDays });
    const vorschlag = proposeOp('gut_getrunken');
    const challengeId = challengeIdOf(vorschlag);

    const [proposed] = await push(backend, philipp.device, [vorschlag]);
    expect(proposed).toMatchObject({
      type: 'applied',
      changes: [
        {
          entityType: 'challenge',
          entityId: challengeId,
          data: {
            couplingId,
            templateKey: 'gut_getrunken',
            proposerPersonId: philipp.personId,
            status: 'vorgeschlagen',
            proposedAt: worldStart.instant,
            proposalExpiresAt: '2026-10-16T12:00:00.000Z',
            startedAt: null,
            endsAt: null,
            endedAt: null,
            commonStage: null,
          },
        },
      ],
    });

    // Der Intent an Anna entsteht in der Transaktion des Vorschlags; Titel und Text wie beim Zusteller.
    const intents = await intentsOf(backend);
    expect(intents).toEqual([
      {
        intentId: `${challengeId}:${anna.personId}:challenge_vorschlag`,
        sourceEventId: challengeId,
        recipientPersonId: anna.personId,
        type: 'challenge_vorschlag',
        messageKey: 'challenge_vorschlag',
        createdAt: worldStart.instant,
        payload: { challengeId, templateKey: 'gut_getrunken', expiresAt: '2026-10-16T12:00:00.000Z', senderDisplayName: 'Philipp' },
      },
    ]);
    expect(notificationTexts.renderStored(intents[0]!.messageKey, withCatalogNames(gameCatalog, intents[0]!.payload))).toEqual({
      type: 'rendered',
      text: { title: 'Philipp schlägt eine Challenge vor', body: 'Gut getrunken – sieben Tage gemeinsam. Magst du mitmachen?' },
    });

    expect((await pulled(backend, anna.device)).challenges).toEqual({ [challengeId]: expect.objectContaining({ status: 'vorgeschlagen' }) });

    const [accepted] = await push(backend, anna.device, [decideOp(challengeId, 'annehmen')]);
    expect(accepted).toMatchObject({
      type: 'applied',
      changes: [
        { entityType: 'challenge', data: { status: 'aktiv', startedAt: worldStart.instant, endsAt: '2026-10-21T12:00:00.000Z', commonStage: 'gestartet', endedAt: null } },
        // Anna sieht nur ihren eigenen Anteil: jeden Tag Wasserziel geplant, also 6.
        { entityType: 'challenge_requirement', entityId: challengeRequirementId(challengeId, EntityId.parse(anna.personId)), data: { personId: anna.personId, requiredCount: 6 } },
      ],
    });
    // Annehmen bleibt ohne weiteren Push.
    expect(await intentsOf(backend)).toHaveLength(1);

    const philippsSicht = await pulled(backend, philipp.device);
    expect(philippsSicht.challenges[challengeId]).toMatchObject({ status: 'aktiv' });
    expect(Object.values(philippsSicht.requirements)).toEqual([expect.objectContaining({ personId: philipp.personId, challengeId, requiredCount: 6 })]);
    const annasSicht = await pulled(backend, anna.device);
    expect(Object.values(annasSicht.requirements)).toEqual([expect.objectContaining({ personId: anna.personId, requiredCount: 6 })]);
  });

  it('schreibt die Anteile aus den sieben Tagen ab der Annahme fest: „Aktive Woche“ bei drei Sporttagen', async () => {
    const { backend, plans, philipp, anna } = await challengeCouple({ annaPlan: threeSportDays });
    const vorschlag = proposeOp('aktive_woche');
    await push(backend, philipp.device, [vorschlag]);
    plans.reads.length = 0;

    await push(backend, anna.device, [decideOp(challengeIdOf(vorschlag), 'annehmen')]);

    // Philipp: sieben Sporttage → ceil(0,8 × 7) = 6; Anna: Montag, Mittwoch, Freitag → ceil(0,8 × 3) = 3.
    expect(Object.values((await pulled(backend, philipp.device)).requirements)).toEqual([expect.objectContaining({ requiredCount: 6 })]);
    expect(Object.values((await pulled(backend, anna.device)).requirements)).toEqual([expect.objectContaining({ requiredCount: 3 })]);
    // Je Person die sieben lokalen Tage ab dem Starttag in ihrer Zone (Berlin: Mittwoch, 14.10.); die
    // Partner-Projektionen lesen denselben Fake mit, daher nur „enthält“.
    const week = ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20'];
    for (const person of [philipp, anna]) {
      expect(plans.reads.filter((read) => read.personId === person.personId).map((read) => read.localDate)).toEqual(expect.arrayContaining(week));
    }
  });
});

describe('Ablehnen und Zurückziehen', () => {
  it('Anna lehnt neutral ab, ohne Push; danach kann jede Person neu vorschlagen', async () => {
    const { backend, philipp, anna } = await challengeCouple();
    const first = proposeOp('gut_getrunken');
    await push(backend, philipp.device, [first]);

    const [declined] = await push(backend, anna.device, [decideOp(challengeIdOf(first), 'ablehnen')]);

    expect(declined).toMatchObject({ type: 'applied', changes: [{ data: { status: 'abgelehnt', endedAt: worldStart.instant, startedAt: null } }] });
    expect(await intentsOf(backend)).toHaveLength(1);
    expect((await pulled(backend, philipp.device)).requirements).toEqual({});
    expect(await push(backend, anna.device, [proposeOp('aktive_woche')])).toMatchObject([{ type: 'applied' }]);
  });

  it('Philipp zieht seinen Vorschlag neutral zurück; danach ist die Annahme ein Konflikt', async () => {
    const { backend, philipp, anna } = await challengeCouple();
    const vorschlag = proposeOp('ernaehrung_im_blick');
    await push(backend, philipp.device, [vorschlag]);

    const [withdrawn] = await push(backend, philipp.device, [withdrawOp(challengeIdOf(vorschlag))]);

    expect(withdrawn).toMatchObject({ type: 'applied', changes: [{ data: { status: 'zurueckgezogen', endedAt: worldStart.instant } }] });
    expect(await rejectionOf(backend, anna.device, decideOp(challengeIdOf(vorschlag), 'annehmen'))).toBe('conflict');
    expect(await intentsOf(backend)).toHaveLength(1);
  });

  it('nur der Partner entscheidet, nur die vorschlagende Person zieht zurück', async () => {
    const { backend, philipp, anna } = await challengeCouple();
    const vorschlag = proposeOp('gut_getrunken');
    await push(backend, philipp.device, [vorschlag]);

    expect(await rejectionOf(backend, philipp.device, decideOp(challengeIdOf(vorschlag), 'annehmen'))).toBe('forbidden');
    expect(await rejectionOf(backend, anna.device, withdrawOp(challengeIdOf(vorschlag)))).toBe('forbidden');
    const [row] = await backend.database.db.select({ status: challenge.status }).from(challenge).where(eq(challenge.id, challengeIdOf(vorschlag)));
    expect(row).toEqual({ status: 'vorgeschlagen' });
  });
});

describe('Wächter: höchstens ein offener Vorschlag und eine aktive Challenge je Kopplung', () => {
  it('lehnt einen zweiten Vorschlag ab, solange einer offen ist, auch von der anderen Person', async () => {
    const { backend, philipp, anna } = await challengeCouple();
    await push(backend, philipp.device, [proposeOp('gut_getrunken')]);

    expect(await rejectionOf(backend, philipp.device, proposeOp('aktive_woche'))).toBe('conflict');
    expect(await rejectionOf(backend, anna.device, proposeOp('aktive_woche'))).toBe('conflict');
    expect(await intentsOf(backend)).toHaveLength(1);
  });

  it('lehnt einen Vorschlag ab, solange eine Challenge aktiv ist', async () => {
    const { backend, philipp, anna } = await challengeCouple();
    const vorschlag = proposeOp('gut_getrunken');
    await push(backend, philipp.device, [vorschlag]);
    await push(backend, anna.device, [decideOp(challengeIdOf(vorschlag), 'annehmen')]);

    expect(await rejectionOf(backend, anna.device, proposeOp('aktive_woche'))).toBe('conflict');
  });

  it('gleichzeitige Vorschläge beider Personen: genau einer gilt', async () => {
    const { backend, philipp, anna } = await challengeCouple();
    const results = await Promise.all([push(backend, philipp.device, [proposeOp('gut_getrunken')]), push(backend, anna.device, [proposeOp('aktive_woche')])]);

    expect(results.flat().map((result) => (result.type === 'permanently_rejected' ? result.error.code : result.type)).sort()).toEqual(['applied', 'conflict']);
    expect(await backend.database.db.select().from(challenge)).toHaveLength(1);
  });

  it('wiederholt derselbe Vorschlag nur, statt einen zweiten anzulegen', async () => {
    const { backend, philipp } = await challengeCouple();
    const vorschlag = proposeOp('gut_getrunken');
    const [first] = await push(backend, philipp.device, [vorschlag]);
    const [retry] = await push(backend, philipp.device, [vorschlag]);

    expect(retry).toEqual({ ...first, type: 'already_applied' });
    expect(await intentsOf(backend)).toHaveLength(1);
  });

  it('lehnt eine unbekannte Vorlage ab', async () => {
    const { backend, philipp } = await challengeCouple();
    expect(await rejectionOf(backend, philipp.device, proposeOp('wasser_marathon'))).toBe('unknown_catalog_key');
  });
});

describe('„Passt gerade nicht zu euren Wochenplänen“', () => {
  it('eine Vorlage ohne geplanten Tag bei einer Person lässt sich nicht vorschlagen', async () => {
    const { backend, philipp, anna } = await challengeCouple({ annaPlan: threeSportDays });

    // Anna hat nie „Ernährung erfasst“ geplant; Philipp kennt ihren Plan nicht, der Server lehnt ab.
    expect(await rejectionOf(backend, philipp.device, proposeOp('ernaehrung_im_blick'))).toBe('conflict');
    // Für Anna selbst ebenso.
    expect(await rejectionOf(backend, anna.device, proposeOp('ernaehrung_im_blick'))).toBe('conflict');
    expect(await backend.database.db.select().from(challenge)).toEqual([]);
    expect(await intentsOf(backend)).toEqual([]);
  });

  it('und nicht annehmen, wenn sich der Wochenplan seit dem Vorschlag geändert hat', async () => {
    const { backend, plans, philipp, anna } = await challengeCouple();
    const vorschlag = proposeOp('ernaehrung_im_blick');
    await push(backend, philipp.device, [vorschlag]);
    plans.set(anna.personId, threeSportDays);

    expect(await rejectionOf(backend, anna.device, decideOp(challengeIdOf(vorschlag), 'annehmen'))).toBe('conflict');
    expect((await pulled(backend, anna.device)).challenges[challengeIdOf(vorschlag)]).toMatchObject({ status: 'vorgeschlagen' });
    // Ablehnen geht weiterhin.
    expect(await rejectionOf(backend, anna.device, decideOp(challengeIdOf(vorschlag), 'ablehnen'))).toBe('applied');
  });

  it('ohne gültigen Plan passt keine Vorlage', async () => {
    const { backend, plans, philipp } = await challengeCouple();
    plans.set(philipp.personId, everyDay, '2026-10-30');
    for (const { key } of gameCatalog.challengeTemplates) expect(await rejectionOf(backend, philipp.device, proposeOp(key))).toBe('conflict');
  });
});

describe('Verfall nach 48 Stunden', () => {
  it('schreibt der Pull nach 48 Stunden idempotent als `verfallen` fest, neutral und ohne Push', async () => {
    const { backend, clock, philipp, anna } = await challengeCouple();
    const vorschlag = proposeOp('gut_getrunken');
    const challengeId = challengeIdOf(vorschlag);
    await push(backend, philipp.device, [vorschlag]);

    clock.advanceBy(48 * hour - 1);
    expect((await pulled(backend, anna.device)).challenges[challengeId]).toMatchObject({ status: 'vorgeschlagen' });

    clock.advanceBy(1);
    const { cursor } = await pullAll(backend, anna.device);
    const [expired] = await backend.database.db.select().from(challenge).where(eq(challenge.id, challengeId));
    expect(expired).toMatchObject({ status: 'verfallen', endedAt: new Date('2026-10-16T12:00:00.000Z') });
    expect((await pulled(backend, philipp.device)).challenges[challengeId]).toMatchObject({ status: 'verfallen', endedAt: '2026-10-16T12:00:00.000Z' });

    // Ein weiterer Pull ändert nichts mehr.
    clock.advanceBy(hour);
    expect(recordsOf((await pullAll(backend, anna.device, cursor)).changes, 'challenge')).toEqual({});
    const [again] = await backend.database.db.select().from(challenge).where(eq(challenge.id, challengeId));
    expect(again).toEqual(expired);
    expect(await intentsOf(backend)).toHaveLength(1);
  });

  it('ein verfallener Vorschlag lässt sich nicht mehr annehmen oder zurückziehen, auch vor dem nächsten Pull', async () => {
    const { backend, clock, philipp, anna } = await challengeCouple();
    const vorschlag = proposeOp('gut_getrunken');
    await push(backend, philipp.device, [vorschlag]);
    clock.advanceBy(48 * hour);

    expect(await rejectionOf(backend, anna.device, decideOp(challengeIdOf(vorschlag), 'annehmen'))).toBe('conflict');
    expect(await rejectionOf(backend, philipp.device, withdrawOp(challengeIdOf(vorschlag)))).toBe('conflict');
  });

  it('nach dem Verfall ist ein neuer Vorschlag möglich, auch ohne Pull dazwischen', async () => {
    const { backend, clock, philipp, anna } = await challengeCouple();
    const vorschlag = proposeOp('gut_getrunken');
    await push(backend, philipp.device, [vorschlag]);
    clock.advanceBy(48 * hour);

    const [neu] = await push(backend, anna.device, [proposeOp('aktive_woche')]);

    expect(neu).toMatchObject({ type: 'applied', changes: [{ data: { status: 'vorgeschlagen', templateKey: 'aktive_woche' } }] });
    const [alt] = await backend.database.db.select({ status: challenge.status }).from(challenge).where(eq(challenge.id, challengeIdOf(vorschlag)));
    expect(alt).toEqual({ status: 'verfallen' });
  });
});

describe('Entkoppeln', () => {
  it('beendet einen offenen Vorschlag neutral als `zurueckgezogen`, ohne Push', async () => {
    const { backend, philipp, anna, couplingId } = await challengeCouple();
    const vorschlag = proposeOp('gut_getrunken');
    await push(backend, philipp.device, [vorschlag]);

    await uncoupleAs(backend, { couplingId, requesterPersonId: anna.personId });

    const [row] = await backend.database.db.select().from(challenge).where(eq(challenge.id, challengeIdOf(vorschlag)));
    expect(row).toMatchObject({ status: 'zurueckgezogen', endedAt: new Date(worldStart.instant) });
    expect((await intentsOf(backend)).map((intent) => intent.type)).toEqual(['challenge_vorschlag']);
  });
});

describe('Autorisierung der Challenge-Befehle', () => {
  for (const [command, scenario] of Object.entries(challengeCommandScenarios)) {
    describe(command, () => {
      for (const testCase of authorizationCases({ ...scenario, command })) it(testCase.name, testCase.run, 20_000);
    });
  }

  it('lehnt eine Nutzlast mit fremdem fachlichem Schlüssel ab', async () => {
    const { backend, philipp } = await challengeCouple();
    const reply = await pushRaw(backend, philipp.device, [proposeOp('gut_getrunken', undefined, { businessKey: 'challenge:fremd:vorschlag' })]);
    expect(reply.body).toMatchObject({ results: [{ type: 'permanently_rejected', error: { code: 'invalid_payload' } }] });
  });
});
