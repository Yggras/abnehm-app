import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AreaKey, EntityId, LocalDate, localDateAfter, localDaysBetween, ServerVersion, weekdayOf } from '../src/base.ts';
import { contributionState, type ContributionState } from '../src/contribution.ts';
import { sharedActionDecisionKey, sharedActionRequestKey } from '../src/island.ts';
import { NotificationIntent, notificationTarget } from '../src/notifications.ts';
import { partnerSummaryBounds, partnerSummaryPeriod, partnerSummaryPeriodOf, revocationNoticeId } from '../src/partner.ts';
import { personOfTimeZoneKey, personTimeZoneKey } from '../src/person.ts';
import { routeTargetOrToday } from '../src/routes.ts';
import { needsResponse, WirContribution } from '../src/wir.ts';
import { notificationFixtures } from '../fixtures/notifications.ts';
import { wirFixtures } from '../fixtures/wir.ts';

describe('notificationTarget', () => {
  const intents = Object.values(notificationFixtures.NotificationIntent.valid).map((value) =>
    NotificationIntent.parse(value),
  );
  const targetOf = (type: NotificationIntent['type']) => {
    const intent = intents.find((candidate) => candidate.type === type);
    if (intent === undefined) throw new Error(`Kein Fixture für ${type}`);
    return notificationTarget(intent);
  };

  it('deckt jede Art des Katalogs mit einem Fixture ab', () => {
    expect(new Set(intents.map((intent) => intent.type))).toEqual(
      new Set(NotificationIntent.options.map((option) => option.def.shape.type.value)),
    );
  });

  it.each([
    ['anfeuern', { type: 'partner', focus: 'received_encouragement' }],
    ['levelaufstieg', { type: 'momo' }],
    ['gebiet', { type: 'momo' }],
    ['projektabschluss', { type: 'momo', view: 'projekt' }],
    ['challenge_vorschlag', { type: 'partner' }],
    ['challenge_erfolg', { type: 'partner' }],
    ['rollen_anfrage', { type: 'partner' }],
    ['deko_geschenk', { type: 'partner' }],
    ['entkopplung', { type: 'partner' }],
  ] as const)('%s öffnet %j', (type, target) => {
    expect(targetOf(type)).toEqual(target);
  });
});

describe('needsResponse', () => {
  const contributions = wirFixtures.WirContribution.valid;
  const parse = (name: string) => WirContribution.parse(contributions[name]);

  it('gilt für offene gemeinsame Aktionen und fremde Challenge-Vorschläge', () => {
    expect(needsResponse(parse('Deko-Geschenk'))).toBe(true);
    expect(needsResponse(parse('fremder Challenge-Vorschlag'))).toBe(true);
  });

  it('gilt nicht für eigene Vorschläge, aktive Challenges, Projekte und Ereignisse', () => {
    const own = WirContribution.parse({ ...(contributions['fremder Challenge-Vorschlag'] as object), proposedBySelf: true });
    expect(needsResponse(own)).toBe(false);
    expect(needsResponse(parse('aktive Challenge ohne Enddatum'))).toBe(false);
    expect(needsResponse(parse('Gemeinschaftsprojekt'))).toBe(false);
    expect(needsResponse(parse('Levelaufstieg'))).toBe(false);
  });
});

describe('weekdayOf', () => {
  it.each([
    ['2026-10-12', 'montag'],
    ['2026-10-14', 'mittwoch'],
    ['2026-10-18', 'sonntag'],
    ['2028-02-29', 'dienstag'],
  ] as const)('%s ist ein %s', (date, weekday) => {
    expect(weekdayOf(LocalDate.parse(date))).toBe(weekday);
  });
});

describe('localDateAfter', () => {
  it.each([
    ['2026-10-14', 1, '2026-10-15'],
    ['2026-10-14', 7, '2026-10-21'],
    ['2026-10-31', 1, '2026-11-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-10-14', -14, '2026-09-30'],
  ] as const)('%s plus %s Tage ist %s, auch über Monats-, Jahres- und Schaltjahresgrenzen', (date, days, expected) => {
    expect(localDateAfter(LocalDate.parse(date), days)).toBe(expected);
  });

  it('kennt keine Zeitumstellung: Ein lokaler Tag ist ein Datum, kein Zeitpunkt', () => {
    expect(localDateAfter(LocalDate.parse('2026-10-24'), 2)).toBe('2026-10-26');
  });
});

describe('localDaysBetween', () => {
  it.each([
    ['2026-10-14', '2026-10-14', 0],
    ['2026-09-23', '2026-10-13', 20],
    ['2028-02-28', '2028-03-01', 2],
    ['2026-12-31', '2027-01-01', 1],
    ['2026-10-14', '2026-09-30', -14],
    ['2026-10-24', '2026-10-26', 2],
  ] as const)('von %s bis %s sind %s Tage, auch über Monats-, Jahres-, Schaltjahresgrenzen und Zeitumstellung', (from, to, expected) => {
    expect(localDaysBetween(LocalDate.parse(from), LocalDate.parse(to))).toBe(expected);
  });
});

describe('contributionState', () => {
  const state = contributionState(z.strictObject({ ml: z.int() }), z.enum(['kein_ziel']));

  it('kennt genau die fünf Zustände', () => {
    expect(state.options.map((option) => option.def.shape.type.value)).toEqual([
      'loading',
      'ready',
      'empty',
      'stale',
      'error',
    ]);
  });

  it('prüft Daten und Leer-Grund mit den übergebenen Schemas', () => {
    expect(state.safeParse({ type: 'ready', data: { ml: 250 } }).success).toBe(true);
    expect(state.safeParse({ type: 'ready', data: { ml: '250' } }).success).toBe(false);
    expect(state.safeParse({ type: 'empty', reasonKey: 'kein_ziel' }).success).toBe(true);
    expect(state.safeParse({ type: 'empty', reasonKey: 'anderer_grund' }).success).toBe(false);
  });

  it('entspricht dem Typ ContributionState', () => {
    type Inferred = z.infer<typeof state>;
    type Declared = ContributionState<{ ml: number }, 'kein_ziel'>;
    const same: [Inferred, Declared] extends [Declared, Inferred] ? true : false = true;
    expect(same).toBe(true);
  });
});

describe('routeTargetOrToday', () => {
  it('übernimmt ein gültiges Ziel', () => {
    expect(routeTargetOrToday({ type: 'momo', view: 'projekt' })).toEqual({ type: 'momo', view: 'projekt' });
  });

  it.each([
    ['unbekannte Route', { type: 'capture.steps' }],
    ['ungültige Parameter', { type: 'challenge.detail', challengeId: 'abc' }],
    ['kein Objekt', '/today'],
  ])('öffnet bei %s today', (_, value) => {
    expect(routeTargetOrToday(value)).toEqual({ type: 'today' });
  });
});

describe('personTimeZoneKey', () => {
  const personId = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
  const changeId = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b02');

  it('trägt die Person und liest sie wieder aus', () => {
    const key = personTimeZoneKey(personId, changeId);
    expect(key).toBe(`person:${personId}:time_zone:${changeId}`);
    expect(personOfTimeZoneKey(key)).toBe(personId);
  });

  it.each([
    ['ohne Änderungs-ID', `person:${personId}:time_zone`],
    ['mit anderem Präfix', `goal:${personId}:time_zone:${changeId}`],
    ['mit Großbuchstaben', `person:${personId.toUpperCase()}:time_zone:${changeId}`],
    ['ohne UUID', `person:${'x'.repeat(36)}:time_zone:${changeId}`],
  ])('erkennt %s nicht als Schlüssel', (_, key) => {
    expect(personOfTimeZoneKey(key)).toBeNull();
  });
});

describe('Schlüssel gemeinsamer Aktionen', () => {
  const actionId = EntityId.parse('3e5f7a9b-2c4d-4e6f-8a1b-3c5d7e9f1a01');

  it('trennen Antrag und Entscheidung derselben Aktion', () => {
    expect(sharedActionRequestKey(actionId)).toBe(`shared_action:${actionId}:antrag`);
    expect(sharedActionDecisionKey(actionId)).toBe(`shared_action:${actionId}:entscheidung`);
  });
});

describe('partnerSummaryPeriod', () => {
  it.each([
    ['ernaehrung', '2026-10-14', { type: 'tag', localDate: '2026-10-14' }],
    ['wasser', '2026-10-14', { type: 'tag', localDate: '2026-10-14' }],
    ['sport', '2026-10-14', { type: 'woche', from: '2026-10-12', to: '2026-10-18' }],
    ['sport', '2026-10-12', { type: 'woche', from: '2026-10-12', to: '2026-10-18' }],
    ['sport', '2026-10-18', { type: 'woche', from: '2026-10-12', to: '2026-10-18' }],
    ['gewicht', '2026-10-14', { type: 'vierzehn_tage', from: '2026-10-01', to: '2026-10-14' }],
  ] as const)('%s am %s', (area, today, period) => {
    expect(partnerSummaryPeriod(area, LocalDate.parse(today))).toEqual(period);
  });

  it('zerlegt jeden Zeitraum in seine Grenzen und setzt ihn daraus wieder zusammen', () => {
    for (const area of AreaKey.options) {
      const period = partnerSummaryPeriod(area, LocalDate.parse('2026-10-14'));
      const { from, to } = partnerSummaryBounds(period);
      expect(partnerSummaryPeriodOf(area, from, to)).toEqual(period);
    }
  });

  it('endet für jeden Bereich am aktuellen Tag oder in dessen Woche', () => {
    for (const area of AreaKey.options) {
      const period = partnerSummaryPeriod(area, LocalDate.parse('2026-03-29'));
      expect(period.type === 'tag' ? period.localDate : period.to).toBe('2026-03-29');
    }
  });
});

describe('revocationNoticeId', () => {
  it('leitet aus derselben Serverversion dieselbe UUIDv5 ab, aus jeder anderen eine andere', () => {
    const id = revocationNoticeId(ServerVersion.parse('42'));
    expect(revocationNoticeId(ServerVersion.parse('42'))).toBe(id);
    expect(revocationNoticeId(ServerVersion.parse('43'))).not.toBe(id);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
