import { describe, expect, it } from 'vitest';

import { contractFixtures } from '@abnehm/contracts/fixtures';

import { partnerResponse, PartnerResponseRejected, type PartnerResponseKind } from '../src/authorization/authorization.ts';

// Serialisierte Partnerantworten (Spezifikation 0, Abschnitt 11; #98): Die geschlossenen Zod-Schemas
// aus dem Vertragsmodul sind die einzige Positivliste. Es gibt keinen zweiten Feldkatalog.

const fixturesOf: Record<PartnerResponseKind, { valid: Readonly<Record<string, unknown>>; invalid: Readonly<Record<string, unknown>> }> = {
  partner_summary: contractFixtures.partner!.PartnerSummaryEnvelope!,
  partner_daily_goal_status: contractFixtures.partner!.PartnerDailyGoalStatus!,
  revocation_notice: contractFixtures.partner!.RevocationNotice!,
  partner_photo_list: contractFixtures.partner!.PartnerPhotoList!,
  island_progress: contractFixtures.island!.IslandProgress!,
};

describe.each(Object.entries(fixturesOf))('Partnerantwort %s', (kind, { valid, invalid }) => {
  it.each(Object.entries(valid))('lässt durch: %s', (_name, value) => {
    expect(partnerResponse(kind as PartnerResponseKind, value)).toEqual(value);
  });

  it.each(Object.entries(invalid))('lehnt ab: %s', (_name, value) => {
    expect(() => partnerResponse(kind as PartnerResponseKind, value)).toThrow(PartnerResponseRejected);
  });
});

describe('Gezielt ungültige Partnerdaten', () => {
  it.each([
    ['Rohdatensatz-ID', 'partner_summary', 'Rohdatensatz-ID'],
    ['Rohdatensatz-ID', 'partner_daily_goal_status', 'Rohdatensatz-ID der Erfüllung'],
    ['fremder Zielwert', 'partner_summary', 'fremdes Wasserziel'],
    ['fremder Zielwert', 'partner_summary', 'fremdes Kalorienbudget'],
    ['fremder Zielwert', 'partner_summary', 'fremdes Zielgewicht'],
    ['absoluter Gewichtswert', 'partner_summary', 'absolutes Gewicht'],
  ] as const)('%s wird abgelehnt (%s: %s)', (_category, kind, name) => {
    const value = fixturesOf[kind].invalid[name];

    expect(value, 'Fixture fehlt').toBeDefined();
    expect(() => partnerResponse(kind, value)).toThrow(PartnerResponseRejected);
  });

  it('lässt als einzigen Zielwert des Partners `weeklyTargetMinutes` der Sport-Zusammenfassung durch', () => {
    const sport = fixturesOf.partner_summary.valid['Sport in der Woche'];

    expect(partnerResponse('partner_summary', sport)).toMatchObject({ content: { weeklyTargetMinutes: 150 } });
  });

  it('nennt im Fehler nur die Art der Antwort, keine Daten', () => {
    const error = (() => {
      try {
        partnerResponse('partner_summary', fixturesOf.partner_summary.invalid['absolutes Gewicht']);
      } catch (thrown) {
        return thrown as Error;
      }
      return null;
    })();

    expect(error?.message).toBe('Partnerantwort partner_summary verletzt ihr Vertragsschema');
  });
});
