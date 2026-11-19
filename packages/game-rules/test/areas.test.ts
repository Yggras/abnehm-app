import { describe, expect, it } from 'vitest';

import { testCatalog } from '../fixtures/index.ts';
import { areaOccasionKey, areaUnlockAt, placeField, sidesOf } from '../src/areas.ts';
import { hatching } from '../src/hatching.ts';

// Nachweis für #204: Gebietsfreischaltung (Spezifikation 4, Abschnitte 3, 5 und 9) gegen den Test-Katalog
// mit Gebieten bei Level 4 und 8 und zwei Landschaftsvorlagen.

const catalog = testCatalog();
const bauen = '0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01';
const natur = '0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b02';
const islandId = '5d1c7e3a-2b4f-4a8e-b6c1-3e9f0a7d5c02';

describe('Seiten der Insel', () => {
  it('liest aus der Grundinsel, wem Seite a und Seite b gehören, auch nach einem Rollentausch', () => {
    const { fields } = hatching(catalog, { proposerPersonId: natur, proposerRole: 'natur', partnerPersonId: bauen });
    expect(sidesOf(catalog, fields)).toEqual({ a: bauen, b: natur });
  });

  it('ohne materialisierte Grundinsel gibt es keine Seiten', () => {
    expect(sidesOf(catalog, [])).toBeNull();
  });
});

describe('Gebietsfreischaltung', () => {
  const sides = { a: bauen, b: natur } as const;

  it('materialisiert an einem Formlevel die Felder des Gebiets: je Person +10 Ecke und +30 Rollenbereich', () => {
    const unlock = areaUnlockAt(catalog, { level: 4, sides })!;
    const owned = (person: string, kind: string) =>
      unlock.fields.filter((field) => field.ownerPersonId === person && placeField(catalog, field.key)?.kind === kind).length;

    expect(unlock.area).toEqual({ type: 'gebiet', key: 't_gebiet_1' });
    expect(unlock.fields).toHaveLength(80);
    expect(unlock.fields[0]).toEqual({ key: 't_gebiet_1:0:-5', ownerPersonId: bauen });
    for (const person of [bauen, natur]) {
      expect(owned(person, 'ecke')).toBe(10);
      expect(owned(person, 'rollenbereich')).toBe(30);
    }
  });

  it('bringt die Entdeckung mit beiden Entdeckungs-Bauplänen je Rolle und der Entdeckungs-Deko', () => {
    expect(areaUnlockAt(catalog, { level: 4, sides })!.discovery).toEqual({
      areaKey: 't_gebiet_1',
      blueprints: ['t_ent_bauen_1a', 't_ent_bauen_1b', 't_ent_natur_1a', 't_ent_natur_1b'],
      deko: ['t_ent_deko_1'],
    });
  });

  it.each([2, 3, 5, 13, 43, 48])('schaltet bei Level %i ohne Gebiet im Katalog nichts frei', (level) => {
    expect(areaUnlockAt(catalog, { level, sides })).toBeNull();
  });

  it('nutzt bei 49 und 55 die nächste Landschaftsvorlage mit je einem wiederverwendeten Entdeckungs-Bauplan je Rolle und ohne Deko', () => {
    const first = areaUnlockAt(catalog, { level: 49, sides })!;
    const second = areaUnlockAt(catalog, { level: 55, sides })!;

    expect(first.area).toEqual({ type: 'endlos', key: 'endlos_1_t_vorlage_erste', template: 't_vorlage_erste', k: 1 });
    expect(first.discovery).toEqual({ areaKey: 'endlos_1_t_vorlage_erste', blueprints: ['t_ent_bauen_1a', 't_ent_natur_1a'], deko: [] });
    expect(first.fields).toHaveLength(80);
    expect(first.fields[0]).toEqual({ key: 'endlos_1_t_vorlage_erste:0:0', ownerPersonId: bauen });
    expect(second.area).toMatchObject({ key: 'endlos_2_t_vorlage_zweite' });
    expect(second.discovery.blueprints).toEqual(['t_ent_bauen_2a', 't_ent_natur_2a']);
  });

  it('hat den Anlassschlüssel `gebiet:‹insel›:‹gebiet›`', () => {
    expect(areaOccasionKey(islandId, 't_gebiet_1')).toBe(`gebiet:${islandId}:t_gebiet_1`);
    expect(areaOccasionKey(islandId, 'endlos_1_t_vorlage_erste')).toBe(`gebiet:${islandId}:endlos_1_t_vorlage_erste`);
  });
});

describe('Lage der Felder auf der Insel', () => {
  it('Grundinsel und feste Gebiete liegen auf dem gemeinsamen Raster', () => {
    expect(placeField(catalog, 'grundinsel:7:7')).toEqual({ x: 7, y: 7, kind: 'lichtung' });
    expect(placeField(catalog, 't_gebiet_2:15:-6')).toEqual({ x: 15, y: -6, kind: 'ecke', side: 'b' });
  });

  it('endlose Gebiete liegen in Bändern von 5 Zeilen übereinander oberhalb des obersten festen Gebiets', () => {
    // Das oberste feste Gebiet reicht bis y = −10. Die Lage hängt nur an k, nicht an der Reihenfolge der
    // Vorlagen, damit eine spätere Vorlage keine bestehende Ausprägung verschiebt.
    expect(placeField(catalog, 'endlos_1_t_vorlage_erste:0:0')).toEqual({ x: 0, y: -15, kind: 'ecke', side: 'a' });
    expect(placeField(catalog, 'endlos_1_t_vorlage_erste:15:4')).toEqual({ x: 15, y: -11, kind: 'ecke', side: 'b' });
    expect(placeField(catalog, 'endlos_2_t_vorlage_zweite:0:0')).toEqual({ x: 0, y: -20, kind: 'ecke', side: 'a' });
    expect(placeField(catalog, 'endlos_3_t_vorlage_erste:0:4')).toEqual({ x: 0, y: -21, kind: 'ecke', side: 'a' });
  });

  it('kennt keine Felder außerhalb der Feldpläne', () => {
    expect(placeField(catalog, 'grundinsel:99:99')).toBeUndefined();
    // Koordinaten nur in kanonischer Schreibweise, wie beim Nachschlagen im Katalog.
    expect(placeField(catalog, 'grundinsel:07:7')).toBeUndefined();
    expect(placeField(catalog, 'endlos_1_t_vorlage_erste:00:0')).toBeUndefined();
    expect(placeField(catalog, 'endlos_1_t_vorlage_erste:16:0')).toBeUndefined();
    expect(placeField(catalog, 'endlos_1_unbekannt:0:0')).toBeUndefined();
  });
});
