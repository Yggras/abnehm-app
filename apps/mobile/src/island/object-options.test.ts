import { EntityId } from '@abnehm/contracts/base';
import { indexCatalog } from '@abnehm/game-rules/catalog';
import { gameCatalog } from '@abnehm/game-rules/content';
import { hatching } from '@abnehm/game-rules/hatching';

import type { PlacedObject, StoredObject } from './hatched-island';
import { objectOptions, type ObjectSituation } from './object-options';
import { anna, philipp } from './testing/persons';

// Optionen für Objekt-Sheet, Lager und Umstellen (#194; Spezifikation 4, Abschnitte 3 und 7): was ein
// angetipptes Objekt anbietet, was das Lager zeigt und welche Felder beim Umstellen leuchten. Philipp hat
// Bauen und damit Seite a der Grundinsel: Ecke x 0–3 und y 0–4, Rollenbereich unter anderem x 4–5 und y 0–4
// (`packages/game-rules/content/base-island.ts`). Laterne: Grundpreis 3.

/** Der ausgelieferte Katalog enthält noch keine Deko; diese Stücke sind erfunden. */
const catalog = indexCatalog({
  ...gameCatalog,
  deko: [
    { key: 'muschelkette', name: 'Muschelkette', art: 'muschelkette', origin: 'besucher' },
    { key: 'sternfisch', name: 'Sternfisch', art: 'sternfisch', origin: 'challenge' },
    { key: 'kranz', name: 'Kranz', art: 'kranz', origin: 'jahreszeit', season: 'winter', yearIndex: 1 },
  ],
});
const plan = hatching(gameCatalog, { proposerPersonId: anna, proposerRole: 'natur', partnerPersonId: philipp });
const ownFieldCount = plan.fields.filter((field) => field.ownerPersonId === philipp).length;
const id = (n: number) => EntityId.parse(`5d1c7e3a-2b4f-4a8e-b6c1-${String(n).padStart(12, '0')}`);

const placed = (n: number, fieldKey: string, catalogKey: string, level = 1, ownerPersonId: string = philipp): PlacedObject => ({
  id: id(n),
  fieldKey,
  catalogKey,
  origin: 'gebaut',
  level,
  art: `${catalogKey}_${level}`,
  ownerPersonId,
});
const stored = (n: number, catalogKey: string, overrides: Partial<StoredObject> = {}): StoredObject => ({
  id: id(n),
  catalogKey,
  origin: 'gebaut',
  level: 1,
  art: `${catalogKey}_1`,
  giftFrom: null,
  ...overrides,
});

function situation(overrides: Partial<ObjectSituation> = {}): ObjectSituation {
  return {
    viewerPersonId: philipp,
    ownRole: 'bauen',
    partnerDisplayName: 'Anna',
    energy: 6,
    fields: plan.fields,
    objects: [placed(1, 'grundinsel:0:0', 'laterne'), placed(2, 'grundinsel:12:0', 'apfelbaum', 2, anna)],
    storage: [],
    ...overrides,
  };
}

describe('Objekt-Sheet', () => {
  test('ein eigenes Objekt bietet Aufwerten mit Preis, Umstellen und Einlagern', () => {
    expect(objectOptions(catalog, situation()).sheetAt('grundinsel:0:0')).toEqual({
      type: 'eigen',
      id: id(1),
      name: 'Laterne',
      art: 'laterne_1',
      level: 1,
      upgrade: { type: 'moeglich', toLevel: 2, price: 6 },
      canMove: true,
    });
  });

  test('zu wenig Energie: neutral, was zum Aufwerten fehlt', () => {
    expect(objectOptions(catalog, situation({ energy: 4 })).sheetAt('grundinsel:0:0')).toMatchObject({
      upgrade: { type: 'zu_teuer', toLevel: 2, price: 6, missing: 2 },
    });
  });

  test('auf Stufe 3 gibt es nichts mehr aufzuwerten', () => {
    const options = objectOptions(catalog, situation({ objects: [placed(1, 'grundinsel:0:0', 'laterne', 3)] }));
    expect(options.sheetAt('grundinsel:0:0')).toMatchObject({ level: 3, art: 'laterne_3', upgrade: { type: 'hoechste_stufe' } });
  });

  test('Deko hat keine Stufen', () => {
    const deko: PlacedObject = { ...placed(1, 'grundinsel:0:0', 'muschelkette'), origin: 'challenge', art: 'muschelkette' };
    expect(objectOptions(catalog, situation({ objects: [deko] })).sheetAt('grundinsel:0:0')).toMatchObject({ upgrade: { type: 'keine_stufen' } });
  });

  test('ohne freies passendes eigenes Feld lässt es sich nicht umstellen, aber einlagern', () => {
    // Ein Apfelbaum (Natur) darf nur in Philipps Ecke; dort ist alles belegt.
    const corner = plan.fields.filter((field) => field.ownerPersonId === philipp && Number(field.key.split(':')[1]) <= 3 && Number(field.key.split(':')[2]) <= 4);
    const objects = corner.map((field, index) => placed(index + 1, field.key, index === 0 ? 'apfelbaum' : 'holzweg'));
    expect(objectOptions(catalog, situation({ objects })).sheetAt(corner[0]!.key)).toMatchObject({ name: 'Apfelbaum', canMove: false });
  });

  test('ein Objekt des Partners zeigt nur, wer es gebaut hat, und die Stufe', () => {
    expect(objectOptions(catalog, situation()).sheetAt('grundinsel:12:0')).toEqual({
      type: 'partner',
      id: id(2),
      name: 'Apfelbaum',
      art: 'apfelbaum_2',
      level: 2,
      origin: 'gebaut',
      partnerName: 'Anna',
    });
  });

  test('ein leeres Feld hat kein Objekt-Sheet', () => {
    expect(objectOptions(catalog, situation()).sheetAt('grundinsel:1:0')).toBeNull();
  });
});

describe('Umstellen und Platzieren: welche Felder leuchten', () => {
  test('alle freien eigenen Felder, auf die das Objekt darf; das eigene Feld nicht', () => {
    const fields = objectOptions(catalog, situation()).placeFields(id(1));
    // Die Laterne (Bauen) darf auf Ecke und Rollenbereich; belegt ist nur ihr eigenes Feld.
    expect(fields.size).toBe(ownFieldCount - 1);
    expect(fields.has('grundinsel:0:0')).toBe(false);
    expect(fields.has('grundinsel:4:0')).toBe(true);
    expect(fields.has('grundinsel:12:1')).toBe(false);
  });

  test('Gebautes der anderen Rolle nur in die eigene Ecke', () => {
    const fields = objectOptions(catalog, situation({ storage: [stored(3, 'apfelbaum')] })).placeFields(id(3));
    expect(fields.has('grundinsel:1:0')).toBe(true);
    expect(fields.has('grundinsel:4:0')).toBe(false);
  });

  test('ein fremdes oder unbekanntes Objekt hat keine Felder', () => {
    expect(objectOptions(catalog, situation()).placeFields(id(2)).size).toBe(0);
    expect(objectOptions(catalog, situation()).placeFields(id(99)).size).toBe(0);
  });
});

describe('Lager', () => {
  test('zeigt verdrängte und eingelagerte Objekte, Geschenke und Challenge-Deko, jeweils mit „Platzieren“', () => {
    const storage = [
      stored(3, 'laterne', { level: 2, art: 'laterne_2' }),
      stored(4, 'muschelkette', { origin: 'besucher', art: 'muschelkette', giftFrom: 'Anna' }),
      stored(5, 'sternfisch', { origin: 'challenge', art: 'sternfisch' }),
      stored(6, 'kranz', { origin: 'jahreszeit', art: 'kranz' }),
    ];
    expect(objectOptions(catalog, situation({ storage })).storage).toEqual([
      { id: id(3), name: 'Laterne', art: 'laterne_2', kind: { type: 'gebaut', level: 2 }, canPlace: true },
      { id: id(4), name: 'Muschelkette', art: 'muschelkette', kind: { type: 'geschenk', from: 'Anna' }, canPlace: true },
      { id: id(5), name: 'Sternfisch', art: 'sternfisch', kind: { type: 'challenge' }, canPlace: true },
      { id: id(6), name: 'Kranz', art: 'kranz', kind: { type: 'deko' }, canPlace: true },
    ]);
  });

  test('ohne freies passendes Feld lässt sich nichts platzieren', () => {
    const objects = plan.fields.filter((field) => field.ownerPersonId === philipp).map((field, index) => placed(index + 10, field.key, 'holzweg'));
    expect(objectOptions(catalog, situation({ objects, storage: [stored(3, 'laterne')] })).storage).toMatchObject([{ canPlace: false }]);
  });
});
