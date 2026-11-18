import { describe, expect, it } from 'vitest';

import { testCatalog } from '../fixtures/index.ts';
import { hatching, otherRole } from '../src/hatching.ts';

// Nachweis für #184: was das Schlüpfen materialisiert (Spezifikation 4, Abschnitte 5 und 7), gegen den
// Test-Katalog mit der Grundinsel aus `content/base-island.ts` (16 × 12, je Seite 20 Ecke und 40
// Rollenbereich, dazu 20 Felder Gemeinschaftsplatz, 20 Lichtung und 32 Strand).

const catalog = testCatalog();
const vorschlagend = '0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01';
const annehmend = '0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b02';

describe('Rolle des Partners', () => {
  it.each([
    ['bauen', 'natur'],
    ['natur', 'bauen'],
  ] as const)('%s → %s', (role, other) => {
    expect(otherRole(role)).toBe(other);
  });
});

describe('Schlüpfen', () => {
  it('die vorschlagende Person bekommt ihre Rolle, der Partner die andere', () => {
    expect(hatching(catalog, { proposerPersonId: vorschlagend, proposerRole: 'natur', partnerPersonId: annehmend }).roles).toEqual({
      bauen: annehmend,
      natur: vorschlagend,
    });
  });

  it('Seite a gehört der Person mit Bauen, Seite b der mit Natur; gemeinsame Bereiche gehören niemandem', () => {
    const { fields } = hatching(catalog, { proposerPersonId: vorschlagend, proposerRole: 'natur', partnerPersonId: annehmend });
    const owners = new Map(fields.map((field) => [field.key, field.ownerPersonId]));

    expect(fields).toHaveLength(16 * 12);
    expect(owners.get('grundinsel:0:0')).toBe(annehmend); // Ecke a
    expect(owners.get('grundinsel:4:7')).toBe(annehmend); // Rollenbereich a
    expect(owners.get('grundinsel:15:0')).toBe(vorschlagend); // Ecke b
    expect(owners.get('grundinsel:11:9')).toBe(vorschlagend); // Rollenbereich b
    expect(owners.get('grundinsel:7:2')).toBeNull(); // Gemeinschaftsplatz
    expect(owners.get('grundinsel:7:7')).toBeNull(); // Lichtung
    expect(owners.get('grundinsel:0:11')).toBeNull(); // Strand
    // Das Kontingent zum Schlüpfen: je Person 60 Felder (20 Ecke + 40 Rollenbereich).
    expect(fields.filter((field) => field.ownerPersonId === annehmend)).toHaveLength(60);
    expect(fields.filter((field) => field.ownerPersonId === vorschlagend)).toHaveLength(60);
  });

  it('ohne Gebiete: nur die Felder der Grundinsel, auch wenn der Katalog Gebiete kennt', () => {
    const { fields } = hatching(catalog, { proposerPersonId: vorschlagend, proposerRole: 'bauen', partnerPersonId: annehmend });

    expect(fields.every((field) => field.key.startsWith('grundinsel:'))).toBe(true);
  });

  it('schaltet die drei Start-Baupläne je Rolle frei und beginnt Projekt 1 mit Bedarf 20 je Anteil', () => {
    const result = hatching(catalog, { proposerPersonId: vorschlagend, proposerRole: 'bauen', partnerPersonId: annehmend });

    expect(result.blueprints).toEqual([
      { key: 't_weg', reason: 'start' },
      { key: 't_bank', reason: 'start' },
      { key: 't_laterne', reason: 'start' },
      { key: 't_blumen', reason: 'start' },
      { key: 't_busch', reason: 'start' },
      { key: 't_baum', reason: 'start' },
    ]);
    expect(result.project).toEqual({ sequenceNumber: 1, templateKey: 't_projekt', buildNeed: 20, natureNeed: 20 });
  });

  it('legt das Ereignis „Momo ist geschlüpft“ an und beginnt auf Level 1 mit Bedarf 11 und leeren Hälften', () => {
    const result = hatching(catalog, { proposerPersonId: vorschlagend, proposerRole: 'bauen', partnerPersonId: annehmend });

    expect(result.event).toEqual({ type: 'momo_geschluepft', occasionKey: 'geschluepft' });
    expect(result.progress).toEqual({
      level: 1,
      levelNeed: 11,
      halves: [
        { halfPercent: 0, halfFull: false },
        { halfPercent: 0, halfFull: false },
      ],
    });
  });

  it('lehnt dieselbe Person auf beiden Seiten ab', () => {
    expect(() => hatching(catalog, { proposerPersonId: vorschlagend, proposerRole: 'bauen', partnerPersonId: vorschlagend })).toThrow();
  });
});
