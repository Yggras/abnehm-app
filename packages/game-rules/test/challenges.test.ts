import { describe, expect, it } from 'vitest';

import { Instant, localDateAfter, LocalDate, type BausteinKey } from '@abnehm/contracts/base';
import { EffectivePlan } from '@abnehm/contracts/ports';

import { indexCatalog, type ChallengeTemplate } from '../src/catalog.ts';
import { checkCatalog } from '../src/catalog-check.ts';
import {
  challengeDays,
  challengeEndsAt,
  challengeProposalExpiresAt,
  challengeShare,
  plannedCount,
} from '../src/challenges.ts';
import { gameCatalog } from '../content/index.ts';

// Challenge-Anteile (Spezifikation 4, Abschnitt 10; #210). Grundlage sind die sieben lokalen Tage ab dem
// Starttag der Person und ihr dann gültiger Wochenplan. Die Wahrheitstabellen decken alle, teilweise und
// null geplante Tage ab.

type Bausteine = readonly [BausteinKey, BausteinKey, BausteinKey];

const start = LocalDate.parse('2026-10-14');

const goal = {
  id: '6a1f0c2e-3b4d-4e5f-8a9b-0c1d2e3f4a01',
  validFrom: '2026-10-01',
  calorieBudgetMilliKcal: 1_800_000,
  lowerBoundMilliKcal: 1_200_000,
  maintenanceReason: null,
  pace: 'entspannt',
  goalWeightG: 70_000,
  waterTargetMl: 2_000,
  weeklySportTargetMinutes: 150,
} as const;

const planned = (localDate: LocalDate, bausteine: Bausteine): EffectivePlan =>
  EffectivePlan.parse({
    type: 'gueltig',
    localDate,
    goal,
    weeklyPlanDay: { weeklyPlanVersionId: '6a1f0c2e-3b4d-4e5f-8a9b-0c1d2e3f4a02', validFrom: '2026-10-01', bausteine },
  });
const empty = (localDate: LocalDate): EffectivePlan => EffectivePlan.parse({ type: 'leer', localDate });

const withSport: Bausteine = ['wasserziel', 'sporteinheit', 'ernaehrung_erfasst'];
const withoutSport: Bausteine = ['wasserziel', 'im_kalorienbudget', 'gewogen'];

/** Sieben Tage ab `start`; die ersten `n` mit Sporteinheit und Ernährung, die übrigen ohne. */
const weekWith = (n: number): EffectivePlan[] => challengeDays(start).map((day, index) => planned(day, index < n ? withSport : withoutSport));

const template = (key: string): ChallengeTemplate => {
  const found = indexCatalog(gameCatalog).find('challenge_vorlage', key);
  if (found.type !== 'found') throw new Error(`Vorlage ${key} fehlt`);
  return found.entry;
};

describe('Challenge-Vorlagen im Katalog', () => {
  it('enthält die vier Vorlagen aus #19 mit je einer Challenge-Deko, und der Katalog bleibt gültig', () => {
    expect(gameCatalog.challengeTemplates.map(({ key, name }) => [key, name])).toEqual([
      ['gemeinsam_dranbleiben', 'Gemeinsam dranbleiben'],
      ['ernaehrung_im_blick', 'Ernährung im Blick'],
      ['gut_getrunken', 'Gut getrunken'],
      ['aktive_woche', 'Aktive Woche'],
    ]);
    const index = indexCatalog(gameCatalog);
    for (const { deko } of gameCatalog.challengeTemplates) {
      const found = index.find('deko', deko);
      expect(found).toMatchObject({ type: 'found', entry: { origin: 'challenge' } });
    }
    expect(checkCatalog(gameCatalog)).toEqual([]);
  });

  it('weist eine Vorlage ab, deren Deko keine Challenge-Deko ist oder deren Maß nicht passt', () => {
    const own = template('gut_getrunken');
    const besucherDeko = gameCatalog.deko.find((entry) => entry.origin === 'besucher')!.key;
    expect(checkCatalog({ ...gameCatalog, challengeTemplates: [{ ...own, deko: besucherDeko }] })).toContainEqual({ rule: 'challenge', key: own.key });
    const zuViel = { ...own, measure: { type: 'baustein', baustein: 'wasserziel', numerator: 8, denominator: 7 } } as const;
    expect(checkCatalog({ ...gameCatalog, challengeTemplates: [zuViel] })).toContainEqual({ rule: 'challenge', key: own.key });
    const ohneZiel = { ...template('gemeinsam_dranbleiben'), measure: { type: 'tagesziele', required: 0 } } as const;
    expect(checkCatalog({ ...gameCatalog, challengeTemplates: [ohneZiel] })).toContainEqual({ rule: 'challenge', key: 'gemeinsam_dranbleiben' });
  });
});

describe('challengeDays', () => {
  it('sind die sieben lokalen Tage ab dem Starttag', () => {
    expect(challengeDays(start)).toEqual(['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20']);
  });
});

describe('challengeShare: Wahrheitstabellen', () => {
  // Ernährung im Blick und Gut getrunken: 6 bei 7 geplanten Tagen, sonst ceil(6/7 × n).
  it.each([
    [7, 6],
    [6, 6],
    [5, 5],
    [4, 4],
    [3, 3],
    [2, 2],
    [1, 1],
  ])('Ernährung im Blick bei %i geplanten Tagen: %i', (days, required) => {
    expect(challengeShare(template('ernaehrung_im_blick'), weekWith(days))).toEqual({ type: 'passt', required });
  });

  it('Ernährung im Blick ohne geplanten Tag passt nicht', () => {
    expect(challengeShare(template('ernaehrung_im_blick'), weekWith(0))).toEqual({ type: 'passt_nicht' });
  });

  it.each([
    [7, 6],
    [4, 4],
    [1, 1],
  ])('Gut getrunken bei %i Tagen mit Wasserziel: %i', (days, required) => {
    const week = challengeDays(start).map((day, index) => planned(day, index < days ? withSport : ['im_kalorienbudget', 'gewogen', 'sporteinheit']));
    expect(challengeShare(template('gut_getrunken'), week)).toEqual({ type: 'passt', required });
  });

  it('Gut getrunken ohne Wasserziel passt nicht', () => {
    const week = challengeDays(start).map((day) => planned(day, ['im_kalorienbudget', 'gewogen', 'sporteinheit']));
    expect(challengeShare(template('gut_getrunken'), week)).toEqual({ type: 'passt_nicht' });
  });

  // Aktive Woche: ceil(0,8 × geplante Sporteinheiten).
  it.each([
    [7, 6],
    [6, 5],
    [5, 4],
    [4, 4],
    [3, 3],
    [2, 2],
    [1, 1],
  ])('Aktive Woche bei %i geplanten Sporteinheiten: %i', (days, required) => {
    expect(challengeShare(template('aktive_woche'), weekWith(days))).toEqual({ type: 'passt', required });
  });

  it('Aktive Woche ohne Sporteinheit passt nicht', () => {
    expect(challengeShare(template('aktive_woche'), weekWith(0))).toEqual({ type: 'passt_nicht' });
  });

  // Gemeinsam dranbleiben: 17 erfüllte Tagesziele, sobald ein Tag geplant ist.
  it.each([7, 3, 1])('Gemeinsam dranbleiben bei %i geplanten Tagen: 17', (days) => {
    const week = challengeDays(start).map((day, index) => (index < days ? planned(day, withoutSport) : empty(day)));
    expect(challengeShare(template('gemeinsam_dranbleiben'), week)).toEqual({ type: 'passt', required: 17 });
  });

  it('ohne gültigen Plan passt keine Vorlage', () => {
    const week = challengeDays(start).map(empty);
    for (const { key } of gameCatalog.challengeTemplates) expect(challengeShare(template(key), week)).toEqual({ type: 'passt_nicht' });
  });

  it('leere Tage zählen nicht als geplant', () => {
    const week = challengeDays(start).map((day, index) => (index < 2 ? planned(day, withSport) : empty(day)));
    expect(plannedCount(template('aktive_woche'), week)).toBe(2);
    expect(challengeShare(template('aktive_woche'), week)).toEqual({ type: 'passt', required: 2 });
  });

  it('verlangt genau die sieben Tage ab dem Starttag in Reihenfolge', () => {
    expect(() => challengeShare(template('aktive_woche'), weekWith(7).slice(1))).toThrow(RangeError);
    const gap = weekWith(7).map((plan, index) => (index === 6 ? { ...plan, localDate: localDateAfter(start, 9) } : plan));
    expect(() => challengeShare(template('aktive_woche'), gap)).toThrow(RangeError);
  });
});

describe('Fristen', () => {
  it('ein Vorschlag verfällt 48 Stunden nach dem Vorschlagen', () => {
    expect(challengeProposalExpiresAt(Instant.parse('2026-10-14T07:00:00.000Z'))).toBe('2026-10-16T07:00:00.000Z');
  });

  it('eine Challenge endet sieben mal 24 Stunden nach der Annahme, auch über die Zeitumstellung', () => {
    expect(challengeEndsAt(Instant.parse('2026-10-21T18:30:00.000Z'))).toBe('2026-10-28T18:30:00.000Z');
  });
});
