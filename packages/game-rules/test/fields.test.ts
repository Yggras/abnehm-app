import { describe, expect, it } from 'vitest';

import { testCatalog } from '../fixtures/index.ts';
import { indexCatalog, type FieldKind } from '../src/catalog.ts';
import { fieldQuota, placement } from '../src/fields.ts';

// Nachweis für #179: Feldkontingente und Platzierungsregeln nach Abschnitt 3 von #83.

describe('Feldkontingent je Person', () => {
  it.each([
    [0, { ecke: 20, rollenbereich: 40 }], // beim Schlüpfen
    [1, { ecke: 30, rollenbereich: 70 }],
    [2, { ecke: 40, rollenbereich: 100 }],
    [3, { ecke: 50, rollenbereich: 130 }],
    [4, { ecke: 60, rollenbereich: 160 }],
    [5, { ecke: 70, rollenbereich: 190 }],
    [6, { ecke: 80, rollenbereich: 220 }],
    [7, { ecke: 90, rollenbereich: 250 }], // nach dem siebten festen Gebiet
    [8, { ecke: 100, rollenbereich: 280 }], // erstes endloses Gebiet
  ])('nach %i Gebieten', (areas, quota) => {
    expect(fieldQuota(areas)).toEqual(quota);
  });

  it('ergibt 60 Felder zum Schlüpfen und 40 je Gebiet (#18)', () => {
    const total = (areas: number) => fieldQuota(areas).ecke + fieldQuota(areas).rollenbereich;
    expect(total(0)).toBe(60);
    expect(total(3) - total(2)).toBe(40);
  });

  it('lehnt negative Zahlen ab', () => {
    expect(() => fieldQuota(-1)).toThrow(RangeError);
  });
});

const self = '0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01';
const partner = '0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b02';
const bauen = { type: 'bauplan', role: 'bauen' } as const;
const natur = { type: 'bauplan', role: 'natur' } as const;
const deko = { type: 'deko' } as const;
const objects = { 'Bauplan Bauen': bauen, 'Bauplan Natur': natur, 'Deko': deko };

describe('Platzierung', () => {
  const builder = { personId: self, role: 'bauen' } as const;

  it.each(['strand', 'lichtung', 'gemeinschaftsplatz'] as const)('auf %s baut niemand', (kind) => {
    for (const object of Object.values(objects)) {
      expect(placement({ field: { kind, ownerPersonId: null }, person: builder, object })).toEqual({
        type: 'verboten',
        reason: 'gemeinsamer_bereich',
      });
    }
  });

  it.each(['ecke', 'rollenbereich'] as const)('auf Feldern des Partners (%s) ist nichts erlaubt', (kind) => {
    for (const object of Object.values(objects)) {
      expect(placement({ field: { kind, ownerPersonId: partner }, person: builder, object })).toEqual({
        type: 'verboten',
        reason: 'fremdes_feld',
      });
    }
  });

  it.each(Object.entries(objects))('in der eigenen Ecke ist %s erlaubt, unabhängig von der Rolle', (_, object) => {
    expect(placement({ field: { kind: 'ecke', ownerPersonId: self }, person: builder, object })).toEqual({ type: 'erlaubt' });
  });

  const ownRoleArea: { kind: FieldKind; ownerPersonId: string } = { kind: 'rollenbereich', ownerPersonId: self };

  it('im eigenen Rollenbereich nur Baupläne der eigenen Rolle und Deko', () => {
    expect(placement({ field: ownRoleArea, person: builder, object: bauen })).toEqual({ type: 'erlaubt' });
    expect(placement({ field: ownRoleArea, person: builder, object: deko })).toEqual({ type: 'erlaubt' });
    expect(placement({ field: ownRoleArea, person: builder, object: natur })).toEqual({ type: 'verboten', reason: 'falsche_rolle' });
  });

  it('nach einem Rollentausch gilt im Rollenbereich die neue Rolle, die Felder bleiben bei der Person', () => {
    const swapped = { personId: self, role: 'natur' } as const;
    expect(placement({ field: ownRoleArea, person: swapped, object: natur })).toEqual({ type: 'erlaubt' });
    expect(placement({ field: ownRoleArea, person: swapped, object: bauen })).toEqual({ type: 'verboten', reason: 'falsche_rolle' });
    expect(placement({ field: { kind: 'ecke', ownerPersonId: self }, person: swapped, object: bauen })).toEqual({ type: 'erlaubt' });
  });
});

describe('Gebietsfelder', () => {
  // Ein Gebiet bringt je Person 10 Felder Ecke und 30 Rollenbereich. Die „eigenen Gebietsfelder“ mit
  // Rollenbindung sind die Rollenbereich-Felder; die Ecke-Felder eines Gebiets gehören zur Ecke.
  const index = indexCatalog(testCatalog());
  const fieldAt = (key: string) => {
    const found = index.find('feld', key);
    if (found.type !== 'found') throw new Error(`Feld ${key} fehlt im Test-Katalog`);
    return { kind: found.entry.kind, ownerPersonId: self };
  };
  const builder = { personId: self, role: 'bauen' } as const;

  it('binden im Rollenbereich eines Gebiets an die eigene Rolle', () => {
    expect(placement({ field: fieldAt('t_gebiet_1:2:-5'), person: builder, object: natur })).toEqual({ type: 'verboten', reason: 'falsche_rolle' });
    expect(placement({ field: fieldAt('t_gebiet_1:2:-5'), person: builder, object: bauen })).toEqual({ type: 'erlaubt' });
  });

  it('erlauben in der Ecke eines Gebiets alle Baupläne', () => {
    expect(placement({ field: fieldAt('t_gebiet_1:0:-5'), person: builder, object: natur })).toEqual({ type: 'erlaubt' });
  });
});
