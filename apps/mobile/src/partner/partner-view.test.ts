/**
 * @jest-environment node
 */
import { readingOf } from '@abnehm/clock';
import { DisplayName, EntityId, Instant, TimeZone } from '@abnehm/contracts/base';
import type { PartnerDailyGoalStatus, PartnerSummaryEnvelope } from '@abnehm/contracts/partner';

import { dataAgeOf, partnerCardOf, wirPartnerOf, type PartnerReading } from './partner-view';
import { ageText, standText, summaryText } from './texts';

// Ableitung von „Wir“ und Partner-Karte aus Partnercache, letztem Pull und Netzstatus (#121) sowie die
// Texte aus Spezifikation 5, Abschnitt 2. Den gerenderten Bildschirm prüft `WirScreen.test.tsx`.

const zone = TimeZone.parse('Europe/Berlin');
const now = readingOf(Instant.parse('2026-10-14T12:00:00.000Z'), zone);
const minutesAgo = (minutes: number) => Instant.parse(new Date(Date.parse(now.instant) - minutes * 60_000).toISOString());
const ANNA = EntityId.parse('00000000-0000-4000-8000-0000000000a1');
const PHILIPP = EntityId.parse('00000000-0000-4000-8000-0000000000b1');
const COUPLING = EntityId.parse('00000000-0000-4000-8000-0000000000c1');

const base = { ownerPersonId: ANNA, recipientPersonId: PHILIPP, couplingId: COUPLING, serverVersion: '1' as never, generation: 1 };
const water = (dataAsOf: Instant): PartnerSummaryEnvelope => ({
  ...base, type: 'wasser', id: EntityId.parse('00000000-0000-4000-8000-0000000000d1'),
  period: { type: 'tag', localDate: now.localDate }, dataAsOf, content: { progressPercent: 64 },
});
const status = (dataAsOf: Instant): PartnerDailyGoalStatus => ({
  ...base, id: EntityId.parse('00000000-0000-4000-8000-0000000000e1'), localDate: now.localDate, stage: 'unterwegs', dataAsOf,
});
const weight = (changeKg: number | null, direction: 'sinkend' | 'stabil' | 'steigend' | 'noch_nicht_verfuegbar'): PartnerSummaryEnvelope => ({
  ...base, type: 'gewicht', id: EntityId.parse('00000000-0000-4000-8000-0000000000d4'),
  period: { type: 'vierzehn_tage', from: '2026-10-01' as never, to: now.localDate }, dataAsOf: now.instant, content: { changeKg, direction },
});

function coupled(overrides: { summaries?: PartnerSummaryEnvelope[]; status?: PartnerDailyGoalStatus | null; lastPullAt?: Instant | null } = {}): PartnerReading {
  return {
    cache: {
      partner: { personId: ANNA, displayName: DisplayName.parse('Anna') },
      dailyGoalStatus: overrides.status === undefined ? status(minutesAgo(5)) : overrides.status,
      summaries: overrides.summaries ?? [water(minutesAgo(3))],
    },
    lastPullAt: overrides.lastPullAt === undefined ? minutesAgo(1) : overrides.lastPullAt,
  };
}

describe('Partnerzustand für „Wir“', () => {
  it('lädt ohne eigene Person und ist solo ohne aktive Kopplung', () => {
    expect(wirPartnerOf(null, true, now)).toEqual({ type: 'loading' });
    expect(wirPartnerOf({ cache: { partner: null, dailyGoalStatus: null, summaries: [] }, lastPullAt: null }, true, now)).toEqual({ type: 'solo' });
  });

  it('nimmt den Stand der Übersicht aus dem jüngsten dataAsOf', () => {
    expect(wirPartnerOf(coupled(), true, now)).toMatchObject({
      type: 'coupled', displayName: 'Anna', dailyGoal: { stage: 'unterwegs' }, age: { type: 'minuten', minutes: 3 }, stale: false,
    });
    expect(wirPartnerOf(coupled({ status: null, summaries: [] }), true, now)).toMatchObject({ dailyGoal: null, age: null });
  });

  it('ist veraltet, wenn der letzte vollständige Pull älter als 10 Minuten ist, nie gepullt wurde oder das Gerät offline ist', () => {
    expect(wirPartnerOf(coupled({ lastPullAt: minutesAgo(10) }), true, now)).toMatchObject({ stale: false });
    expect(wirPartnerOf(coupled({ lastPullAt: Instant.parse(new Date(Date.parse(minutesAgo(10)) - 1).toISOString()) }), true, now)).toMatchObject({ stale: true });
    expect(wirPartnerOf(coupled({ lastPullAt: null }), true, now)).toMatchObject({ stale: true });
    expect(wirPartnerOf(coupled(), false, now)).toMatchObject({ stale: true });
  });
});

describe('Partner-Karte auf „Heute“', () => {
  it('solo mit Einladen und Code eingeben', () => {
    expect(partnerCardOf({ type: 'solo' })).toEqual({
      type: 'ready',
      data: {
        type: 'solo',
        inviteAction: { actionId: 'partner_card.invite', target: { type: 'partner.invite' } },
        redeemAction: { actionId: 'partner_card.redeem', target: { type: 'partner.redeem' } },
      },
    });
  });

  it('gekoppelt mit Name, grobem Stand, dessen dataAsOf und Anfeuern, ohne Zusammenfassungen; veraltet als stale', () => {
    const data = {
      type: 'coupled', partnerDisplayName: 'Anna', dailyGoalStage: 'unterwegs', dataAsOf: minutesAgo(5),
      encourageAction: { actionId: 'partner_card.encourage', target: { type: 'partner.encourage' } },
    };
    expect(partnerCardOf(wirPartnerOf(coupled(), true, now))).toEqual({ type: 'ready', data });
    expect(partnerCardOf(wirPartnerOf(coupled(), false, now))).toEqual({ type: 'stale', data, dataAsOf: minutesAgo(5) });
    expect(partnerCardOf(wirPartnerOf(coupled({ status: null }), true, now))).toEqual({ type: 'loading' });
  });
});

describe('Texte', () => {
  it('„Stand vor …“ nach der Tabelle: gerade eben, Minuten, heute mit Uhrzeit, sonst Datum mit Uhrzeit', () => {
    expect(ageText(dataAgeOf(minutesAgo(0), now)).shown).toBe('gerade eben');
    expect(ageText(dataAgeOf(Instant.parse('2026-10-14T11:59:00.001Z'), now)).shown).toBe('gerade eben');
    expect(ageText(dataAgeOf(minutesAgo(1), now))).toEqual({ shown: 'vor 1 Min.', spoken: 'vor 1 Minute' });
    expect(ageText(dataAgeOf(minutesAgo(59), now))).toEqual({ shown: 'vor 59 Min.', spoken: 'vor 59 Minuten' });
    // 10:00 UTC ist 12:00 in Berlin (Sommerzeit).
    expect(ageText(dataAgeOf(minutesAgo(120), now))).toEqual({ shown: 'heute 12:00', spoken: 'heute 12:00 Uhr' });
    // 21:30 UTC am Vortag ist 23:30 in Berlin, also noch der 13.10.
    expect(ageText(dataAgeOf(Instant.parse('2026-10-13T21:30:00.000Z'), now)).shown).toBe('13.10. 23:30');
    // 22:30 UTC am Vortag ist schon 00:30 am 14.10. in Berlin.
    expect(ageText(dataAgeOf(Instant.parse('2026-10-13T22:30:00.000Z'), now)).shown).toBe('heute 00:30');
  });

  it('veraltet neutral „Offline · letzter Stand …“', () => {
    expect(standText({ type: 'minuten', minutes: 12 }, true)).toEqual({ shown: 'Offline · letzter Stand vor 12 Min.', spoken: 'Offline, letzter Stand vor 12 Minuten' });
    expect(standText({ type: 'minuten', minutes: 5 }, false)).toEqual({ shown: 'Stand vor 5 Min.', spoken: 'Stand vor 5 Minuten' });
  });

  it('Zusammenfassungen je Bereich, einschließlich jeder Gewichtsrichtung', () => {
    const meals = (count: number) => summaryText({ ...water(now.instant), type: 'ernaehrung', content: { recordedMealCategories: count } } as never).shown;
    expect([meals(0), meals(1), meals(2)]).toEqual(['noch keine Mahlzeit erfasst', '1 Mahlzeit erfasst', '2 Mahlzeiten erfasst']);
    expect(summaryText(water(now.instant))).toEqual({ shown: '64 % des Wasserziels', spoken: '64 Prozent des Wasserziels' });
    expect(summaryText({ ...water(now.instant), type: 'sport', content: { countedMinutes: 45, weeklyTargetMinutes: 150 } } as never))
      .toEqual({ shown: '45 von 150 min diese Woche', spoken: '45 von 150 Minuten diese Woche' });
    expect(summaryText(weight(-0.4, 'sinkend'))).toEqual({ shown: 'Trend −0,4 kg in 2 Wochen', spoken: 'Trend minus 0,4 Kilogramm in 2 Wochen' });
    expect(summaryText(weight(0, 'stabil')).shown).toBe('Trend stabil');
    expect(summaryText(weight(0.3, 'steigend')).shown).toBe('Trend +0,3 kg in 2 Wochen');
    expect(summaryText(weight(null, 'noch_nicht_verfuegbar')).shown).toBe('Trend ab drei Tagesgewichten');
  });
});
