import { LocalDate } from '@abnehm/contracts/base';
import type { MomoAppearance } from '@abnehm/contracts/island';

import { areaUnlockAt, sidesOf } from '@abnehm/game-rules/areas';
import { gameCatalog } from '@abnehm/game-rules/content';
import { hatching } from '@abnehm/game-rules/hatching';

import { areaCells, islandLayout } from './layout';
import { islandScene, type IslandSceneInput, type IslandSceneRequest, type SceneItem } from './scene-model';
import { anna, philipp } from './testing/persons';

// Szenenmodell der Inselansicht (Spezifikation 4, Abschnitt 7; #182) als reine Funktion. Erwartete
// Werte sind von Hand gerechnet: Ein Feld ist bei Zoom 1 64 × 32 dp groß, die obere Ecke von Feld
// (x, y) liegt bei ((x − y) · 32, (x + y) · 16).

const momo: MomoAppearance = { stage: 'geschluepft', formKey: 'kaulquappe', moodKey: 'zufrieden', accessories: { kopf: null, hals: null } };

/** Kleine Insel: Zeile 0 Ecke Philipp · Lichtung · Ecke Anna, Zeile 1 Strand. */
const island: IslandSceneInput = {
  fields: [
    { key: 'grundinsel:0:0', x: 0, y: 0, kind: 'ecke', ownerPersonId: philipp },
    { key: 'grundinsel:1:0', x: 1, y: 0, kind: 'lichtung', ownerPersonId: null },
    { key: 'grundinsel:2:0', x: 2, y: 0, kind: 'ecke', ownerPersonId: anna },
    { key: 'grundinsel:0:1', x: 0, y: 1, kind: 'strand', ownerPersonId: null },
    { key: 'grundinsel:1:1', x: 1, y: 1, kind: 'strand', ownerPersonId: null },
    { key: 'grundinsel:2:1', x: 2, y: 1, kind: 'strand', ownerPersonId: null },
  ],
  fog: [],
  objects: [],
  momo,
};

const request = (overrides: Partial<IslandSceneRequest> = {}): IslandSceneRequest => ({
  island,
  viewerPersonId: philipp,
  mode: 'ansehen',
  localTime: { localDate: LocalDate.parse('2026-10-14'), minutesOfDay: 12 * 60 },
  zoom: 1,
  ...overrides,
});

const ofType = <T extends SceneItem['type']>(items: readonly SceneItem[], type: T) =>
  items.filter((item): item is Extract<SceneItem, { type: T }> => item.type === type);

describe('isometrische Positionen', () => {
  test('ein Feld ist bei Zoom 1 eine 64 × 32 dp große Raute, die obere Ecke liegt bei ((x − y) · 32, (x + y) · 16)', () => {
    const fieldItem = ofType(islandScene(request()).items, 'feld').find((item) => item.field === 'grundinsel:2:1');

    expect(fieldItem?.polygon).toEqual([
      { x: 32, y: 48 },
      { x: 64, y: 64 },
      { x: 32, y: 80 },
      { x: 0, y: 64 },
    ]);
  });

  test('bei Zoom 2 ist dasselbe Feld 128 × 64 dp groß und doppelt so weit vom Ursprung entfernt', () => {
    const fieldItem = ofType(islandScene(request({ zoom: 2 })).items, 'feld').find((item) => item.field === 'grundinsel:2:1');

    expect(fieldItem?.polygon).toEqual([
      { x: 64, y: 96 },
      { x: 128, y: 128 },
      { x: 64, y: 160 },
      { x: 0, y: 128 },
    ]);
  });
});

describe('Lagune und Bewegung', () => {
  test('die Szene beginnt mit der Lagune in `island-water`; unter jeder Erdkante liegt tieferes Wasser', () => {
    const items = islandScene(request()).items;
    const sides = ofType(items, 'seite');

    expect(items[0]).toEqual({ layer: 'wasser', type: 'wasser', tone: 'islandWater' });
    expect(ofType(items, 'inselschatten').map((shadow) => shadow.tone)).toEqual(sides.map(() => 'islandWaterDeep'));
    // Unter der rechten Kante von (2, 1), eine Erdschicht tiefer.
    expect(ofType(items, 'inselschatten')).toContainEqual({
      layer: 'wasser', type: 'inselschatten', tone: 'islandWaterDeep',
      polygon: [{ x: 32, y: 96 }, { x: 64, y: 80 }, { x: 64, y: 96 }, { x: 32, y: 112 }],
    });
  });

  test('Wellen liegen im Wasser, Partikel über der Insel; jede bewegt sich mit eigener Phase zwischen 0 und 1', () => {
    const scene = islandScene(request());
    const waves = ofType(scene.items, 'welle');
    const particles = ofType(scene.items, 'partikel');

    expect(waves.length).toBeGreaterThan(0);
    expect(waves.every((wave) => scene.hitAt(wave.at) === null)).toBe(true);
    expect(particles.length).toBeGreaterThan(0);
    expect(particles.every((particle) => scene.hitAt(particle.at) !== null)).toBe(true);
    expect([...waves, ...particles].every((item) => item.phase >= 0 && item.phase < 1)).toBe(true);
  });

  test.each([
    ['2026-04-15', 'islandFoliage'],
    ['2026-10-15', 'islandFoliageAutumn'],
    ['2026-01-15', 'islandFoliage'],
  ])('Partikel am %s sind Blätter in %s: Jahreszeiten tauschen nur Gras und Laub', (localDate, particle) => {
    const scene = islandScene(request({ localTime: { localDate: LocalDate.parse(localDate), minutesOfDay: 12 * 60 } }));

    expect(new Set(ofType(scene.items, 'partikel').map((item) => item.tone))).toEqual(new Set([particle]));
  });
});

describe('Ausschnitt', () => {
  test('der Start liegt in der Mitte der Lichtung', () => {
    // Lichtung nur (1, 0): Mitte (32, 32).
    expect(islandScene(request()).focus).toEqual({ x: 32, y: 32 });
  });

  test('die Ausdehnung umfasst alle Felder samt Erdschicht', () => {
    // Links Feld (0, 1) bei x = −64, rechts Feld (2, 0) bei x = 96; oben (0, 0) bei y = 0, unten (2, 1) samt Erde bei y = 96.
    expect(islandScene(request()).bounds).toEqual({ x: -64, y: 0, width: 160, height: 96 });
  });
});

describe('Zeichenreihenfolge', () => {
  const withObjects = request({
    island: {
      ...island,
      objects: [
        { id: 'a', fieldKey: 'grundinsel:2:1', art: 'laterne_1', ownerPersonId: anna },
        { id: 'b', fieldKey: 'grundinsel:0:0', art: 'holzweg_1', ownerPersonId: philipp },
        { id: 'c', fieldKey: 'grundinsel:2:0', art: 'apfelbaum_1', ownerPersonId: anna },
        { id: 'd', fieldKey: 'grundinsel:0:1', art: 'sitzbank_1', ownerPersonId: philipp },
      ],
    },
  });

  test('Ebenen von hinten nach vorn: Wasser, Inselsockel, Felder, Objekte samt Momo, Nebel, Overlays', () => {
    const order = ['wasser', 'sockel', 'felder', 'objekte', 'nebel', 'overlays'];
    const layers = islandScene(withObjects).items.map((item) => order.indexOf(item.layer));

    expect(layers).toEqual([...layers].sort((a, b) => a - b));
    expect(layers).not.toContain(-1);
  });

  test('Objekte und Momo nach Zeile + Spalte aufsteigend, bei gleicher Summe nach Spalte', () => {
    const objects = islandScene(withObjects).items.filter((item) => item.layer === 'objekte');

    // Summen: b (0,0) 0 · d (0,1) 1 · Momo (1,0) 1 · c (2,0) 2 · a (2,1) 3.
    expect(objects.map((item) => (item.type === 'objekt' ? item.id : item.type))).toEqual(['b', 'd', 'momo', 'c', 'a']);
  });

  test('Momo steht mittig auf der Lichtung, ein Objekt mittig auf seinem Feld', () => {
    const items = islandScene(withObjects).items;

    expect(ofType(items, 'momo')).toEqual([
      { layer: 'objekte', type: 'momo', field: 'grundinsel:1:0', at: { x: 32, y: 32 }, appearance: momo, from: null },
    ]);
    expect(ofType(items, 'objekt').find((item) => item.id === 'a')).toEqual({
      layer: 'objekte', type: 'objekt', id: 'a', field: 'grundinsel:2:1', at: { x: 32, y: 64 }, art: 'laterne_1', appearing: false,
    });
  });
});

describe('Inselsockel und Licht', () => {
  test('nur freie Ränder zeigen Erde: rechte Seiten ohne Nachbarn in x + 1, linke ohne Nachbarn in y + 1', () => {
    const sides = ofType(islandScene(request()).items, 'seite').map((side) => `${side.field} ${side.side}`);

    expect(sides.sort()).toEqual([
      'grundinsel:0:1 links',
      'grundinsel:1:1 links',
      'grundinsel:2:0 rechts',
      'grundinsel:2:1 links',
      'grundinsel:2:1 rechts',
    ]);
  });

  test('Licht von links oben: linke Seiten 12 %, rechte 24 % dunkler, beide eine halbe Feldhöhe tief in `island-earth`', () => {
    const sides = ofType(islandScene(request()).items, 'seite').filter((side) => side.field === 'grundinsel:2:1');

    expect(sides).toEqual([
      {
        layer: 'sockel', type: 'seite', field: 'grundinsel:2:1', side: 'links', tone: 'islandEarth', shade: 0.12,
        polygon: [{ x: 0, y: 64 }, { x: 32, y: 80 }, { x: 32, y: 96 }, { x: 0, y: 80 }],
      },
      {
        layer: 'sockel', type: 'seite', field: 'grundinsel:2:1', side: 'rechts', tone: 'islandEarth', shade: 0.24,
        polygon: [{ x: 32, y: 80 }, { x: 64, y: 64 }, { x: 64, y: 80 }, { x: 32, y: 96 }],
      },
    ]);
  });
});

describe('Nebel', () => {
  const fogged = request({ island: { ...island, fog: [{ area: 'nordstrand', cells: [{ x: 0, y: -1 }, { x: 1, y: -1 }] }] } });

  test('ein gesperrtes Gebiet liegt als Land mit Feldern unter weißem Nebel mit `opacity-fog`', () => {
    const items = islandScene(fogged).items;

    expect(ofType(items, 'feld').filter((fieldItem) => fieldItem.field.startsWith('nordstrand'))).toMatchObject([
      { field: 'nordstrand:0:-1', tone: 'islandGrassAutumn', tint: null },
      { field: 'nordstrand:1:-1', tone: 'islandGrassAutumn', tint: null },
    ]);
    // Feld (0, −1): obere Ecke (32, −16); Feld (1, −1): obere Ecke (64, 0).
    expect(ofType(items, 'nebel')).toEqual([
      {
        layer: 'nebel', type: 'nebel', area: 'nordstrand', tone: 'surfaceCard', opacity: 0.85, lifting: false,
        cells: [
          [{ x: 32, y: -16 }, { x: 64, y: 0 }, { x: 32, y: 16 }, { x: 0, y: 0 }],
          [{ x: 64, y: 0 }, { x: 96, y: 16 }, { x: 64, y: 32 }, { x: 32, y: 16 }],
        ],
      },
    ]);
  });

  test('auch mit „Bereiche“ bleibt das gesperrte Gebiet ungefärbt', () => {
    const fieldItems = ofType(islandScene({ ...fogged, mode: 'bereiche' }).items, 'feld');

    expect(fieldItems.filter((fieldItem) => fieldItem.field.startsWith('nordstrand')).map((fieldItem) => fieldItem.tint)).toEqual([null, null]);
  });

  test('ein Tipp in den Nebel trifft das gesperrte Gebiet, nicht ein Feld', () => {
    // Mitte von Feld (1, −1): (64, 16). Feld (0, −1) liegt direkt hinter Momo; dort trifft man Momo (#184).
    expect(islandScene(fogged).hitAt({ x: 64, y: 16 })).toEqual({ type: 'nebel', area: 'nordstrand' });
  });

  test('der Sockel schließt das Gebiet ein: Erde nur an seinen freien Rändern', () => {
    const sides = ofType(islandScene(fogged).items, 'seite').map((side) => `${side.field} ${side.side}`);

    expect(sides).toContain('nordstrand:1:-1 rechts');
    expect(sides).not.toContain('nordstrand:0:-1 links');
    expect(sides).not.toContain('nordstrand:1:-1 links');
  });
});

describe('Gebietsfreischaltung (#204)', () => {
  // Die ausgelieferte Insel: Grundinsel nach dem Schlüpfen, Gebiet 1 (Schilfwiese) bis Level 4 unter Nebel.
  const hatched = hatching(gameCatalog, { proposerPersonId: anna, proposerRole: 'natur', partnerPersonId: philipp }).fields;
  const unlocked = areaUnlockAt(gameCatalog, { level: 4, sides: sidesOf(gameCatalog, hatched)! })!;
  const sceneOf = (fields: typeof hatched, unlockedAreas: readonly string[], transformation: IslandSceneRequest['transformation'] = null) =>
    islandScene(request({ island: { ...islandLayout(gameCatalog, { fields, unlockedAreas }), objects: [], momo }, transformation }));

  test('der Nebel ist weg, sobald ein Gebiet freigeschaltet ist; seine Felder gehören dann ihren Personen', () => {
    const before = sceneOf(hatched, []);
    const after = sceneOf([...hatched, ...unlocked.fields], ['schilfwiese']);

    expect(ofType(before.items, 'nebel').map((item) => item.area)).toEqual(['schilfwiese']);
    expect(before.hitAt(centerOf(before, 'schilfwiese:0:-1'))).toEqual({ type: 'nebel', area: 'schilfwiese' });
    expect(ofType(after.items, 'nebel')).toEqual([]);
    expect(after.hitAt(centerOf(after, 'schilfwiese:0:-1'))).toEqual({ type: 'feld', field: 'schilfwiese:0:-1', kind: 'ecke', owner: 'self' });
    expect(after.hitAt(centerOf(after, 'schilfwiese:15:-1'))).toMatchObject({ owner: 'partner' });
  });

  test('während der Verwandlung blendet Momo von der alten Form über, und über dem neuen Gebiet liegt Nebel, der abzieht', () => {
    const from: MomoAppearance = { ...momo, formKey: 'kaulquappe' };
    const scene = sceneOf([...hatched, ...unlocked.fields], ['schilfwiese'], { from, lifting: areaCells(gameCatalog, ['schilfwiese']) });

    expect(ofType(scene.items, 'momo')).toMatchObject([{ from }]);
    expect(ofType(scene.items, 'nebel')).toMatchObject([{ area: 'schilfwiese', lifting: true, opacity: 0.85 }]);
    expect(ofType(scene.items, 'nebel')[0]!.cells).toHaveLength(80);
    // Der abziehende Nebel sperrt nichts: Ein Tipp trifft schon das Feld.
    expect(scene.hitAt(centerOf(scene, 'schilfwiese:0:-1'))).toMatchObject({ type: 'feld' });
  });

  test('ohne Verwandlung steht Momo nur in der aktuellen Form', () => {
    expect(ofType(sceneOf(hatched, []).items, 'momo')).toMatchObject([{ from: null }]);
  });
});

/** Mitte eines Felds in der Szene, aus seiner Raute. */
function centerOf(scene: ReturnType<typeof islandScene>, field: string) {
  const diamond = ofType(scene.items, 'feld').find((item) => item.field === field)!.polygon;
  return { x: diamond[0]!.x, y: (diamond[0]!.y + diamond[2]!.y) / 2 };
}

describe('Abend', () => {
  const lantern = { ...island, objects: [
    { id: 'laterne', fieldKey: 'grundinsel:0:0', art: 'laterne_1', ownerPersonId: philipp },
    { id: 'baum', fieldKey: 'grundinsel:2:0', art: 'apfelbaum_1', ownerPersonId: anna },
  ] };
  const at = (hours: number, minutes: number) =>
    islandScene(request({ island: lantern, localTime: { localDate: LocalDate.parse('2026-10-14'), minutesOfDay: hours * 60 + minutes } }));

  test.each([
    [5, 59, 'abend'],
    [6, 0, 'tag'],
    [19, 59, 'tag'],
    [20, 0, 'abend'],
    [23, 59, 'abend'],
    [0, 0, 'abend'],
  ])('um %i:%i Uhr ist %s', (hours, minutes, daytime) => {
    const scene = at(hours, minutes);

    expect(scene.daytime).toBe(daytime);
    expect(ofType(scene.items, 'abend')).toHaveLength(daytime === 'abend' ? 1 : 0);
  });

  test('abends liegt `island-night` mit `opacity-evening` über der Szene, darüber leuchten Laternen in `island-lamp`', () => {
    const items = at(21, 0).items;

    // Zuletzt gezeichnet; Laterne auf Feld (0, 0): Mitte (0, 16), ihr Licht 31 dp darüber (`art.ts`).
    expect(items.slice(-2)).toEqual([
      { layer: 'overlays', type: 'abend', tone: 'islandNight', opacity: 0.45 },
      { layer: 'overlays', type: 'licht', field: 'grundinsel:0:0', at: { x: 0, y: -15 }, tone: 'islandLamp' },
    ]);
  });

  test('tagsüber leuchtet nichts', () => {
    expect(ofType(at(12, 0).items, 'licht')).toEqual([]);
  });
});

describe('Jahreszeit', () => {
  const at = (localDate: string) => request({ localTime: { localDate: LocalDate.parse(localDate), minutesOfDay: 12 * 60 } });
  const colorOf = (localDate: string, field: string) =>
    ofType(islandScene(at(localDate)).items, 'feld').find((fieldItem) => fieldItem.field === field)?.tone;

  test.each([
    ['2026-02-28', 'winter', 'islandGrassWinter'],
    ['2026-03-01', 'fruehling', 'islandGrassSpring'],
    ['2026-05-31', 'fruehling', 'islandGrassSpring'],
    ['2026-06-01', 'sommer', 'islandGrass'],
    ['2026-08-31', 'sommer', 'islandGrass'],
    ['2026-09-01', 'herbst', 'islandGrassAutumn'],
    ['2026-11-30', 'herbst', 'islandGrassAutumn'],
    ['2026-12-01', 'winter', 'islandGrassWinter'],
  ])('am %s ist meteorologisch %s, das Gras ist %s', (localDate, season, grass) => {
    expect(islandScene(at(localDate)).season).toBe(season);
    expect(colorOf(localDate, 'grundinsel:0:0')).toBe(grass);
    expect(colorOf(localDate, 'grundinsel:1:0')).toBe(grass);
  });

  test.each([
    ['2026-04-15', 'islandFoliage'],
    ['2026-07-15', 'islandFoliage'],
    ['2026-10-15', 'islandFoliageAutumn'],
    ['2026-01-15', 'islandFoliage'],
  ])('am %s ist das Laub %s', (localDate, foliage) => {
    expect(islandScene(at(localDate)).foliage).toBe(foliage);
  });

  test('der Gemeinschaftsplatz ist in jeder Jahreszeit ein Platz aus Stein', () => {
    const plaza = (localDate: string) =>
      ofType(
        islandScene({
          ...at(localDate),
          island: { ...island, fields: [...island.fields, { key: 'grundinsel:1:-1', x: 1, y: -1, kind: 'gemeinschaftsplatz', ownerPersonId: null }] },
        }).items,
        'feld',
      ).find((fieldItem) => fieldItem.field === 'grundinsel:1:-1')?.tone;

    expect(['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15'].map(plaza)).toEqual(['islandStone', 'islandStone', 'islandStone', 'islandStone']);
  });

  test('der Strand bleibt in jeder Jahreszeit Sand', () => {
    expect(['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15'].map((date) => colorOf(date, 'grundinsel:0:1'))).toEqual([
      'islandSand',
      'islandSand',
      'islandSand',
      'islandSand',
    ]);
  });
});

describe('Auswahl', () => {
  test('ein angetipptes Feld liegt hell hervorgehoben über allem anderen, auch über dem Abend', () => {
    const items = islandScene(request({ selectedField: 'grundinsel:2:1', localTime: { localDate: LocalDate.parse('2026-10-14'), minutesOfDay: 21 * 60 } })).items;

    expect(items.at(-1)).toEqual({
      layer: 'overlays', type: 'auswahl', field: 'grundinsel:2:1', tone: 'surfaceCard', opacity: 0.5,
      polygon: [{ x: 32, y: 48 }, { x: 64, y: 64 }, { x: 32, y: 80 }, { x: 0, y: 64 }],
    });
  });

  test('ohne Auswahl oder mit unbekanntem Feld gibt es keine Hervorhebung', () => {
    expect(ofType(islandScene(request()).items, 'auswahl')).toEqual([]);
    expect(ofType(islandScene(request({ selectedField: 'grundinsel:9:9' })).items, 'auswahl')).toEqual([]);
  });
});

describe('Bau-Modus (#192)', () => {
  const building = (fields: readonly string[], overrides: Partial<IslandSceneRequest> = {}) =>
    islandScene(request({ mode: { type: 'bauen', fields: new Set(fields) }, ...overrides }));

  test('gültige Felder leuchten in `island-buildable` über der Szene, andere nicht', () => {
    const glowing = ofType(building(['grundinsel:0:0']).items, 'baubar');

    expect(glowing).toEqual([
      {
        layer: 'overlays', type: 'baubar', field: 'grundinsel:0:0', tone: 'islandBuildable',
        polygon: [{ x: 0, y: 0 }, { x: 32, y: 16 }, { x: 0, y: 32 }, { x: -32, y: 16 }],
      },
    ]);
  });

  test('auch abends leuchten sie, über der Abend-Überlagerung', () => {
    const items = building(['grundinsel:0:0'], { localTime: { localDate: LocalDate.parse('2026-10-14'), minutesOfDay: 21 * 60 } }).items;
    const types = items.map((item) => item.type);

    expect(types.indexOf('baubar')).toBeGreaterThan(types.indexOf('abend'));
  });

  test('Felder, die die Insel nicht hat, leuchten nicht; ohne Bau-Modus leuchtet nichts', () => {
    expect(ofType(building(['grundinsel:9:9']).items, 'baubar')).toEqual([]);
    expect(ofType(islandScene(request()).items, 'baubar')).toEqual([]);
    expect(ofType(islandScene(request({ mode: 'bereiche' })).items, 'baubar')).toEqual([]);
  });

  test('im Bau-Modus sind die Bereiche nicht gefärbt', () => {
    expect(ofType(building(['grundinsel:0:0']).items, 'feld').every((item) => item.tint === null)).toBe(true);
  });

  test('ein eben gebautes Objekt erscheint, die übrigen stehen schon', () => {
    const objects = [
      { id: 'neu', fieldKey: 'grundinsel:0:0', art: 'laterne_1', ownerPersonId: philipp },
      { id: 'alt', fieldKey: 'grundinsel:2:0', art: 'apfelbaum_1', ownerPersonId: anna },
    ];
    const items = islandScene(request({ island: { ...island, objects }, appearing: 'neu' })).items;

    expect(ofType(items, 'objekt').map(({ id, appearing }) => [id, appearing])).toEqual([['neu', true], ['alt', false]]);
  });
});

describe('Bereichsfärbung', () => {
  const tints = (overrides: Partial<IslandSceneRequest>) =>
    Object.fromEntries(ofType(islandScene(request(overrides)).items, 'feld').map((fieldItem) => [fieldItem.field, fieldItem.tint]));

  test('mit „Bereiche“ liegen eigene Felder 28 % in `self`, die des Partners 28 % in `partner`, gemeinsame ungefärbt', () => {
    expect(tints({ mode: 'bereiche' })).toEqual({
      'grundinsel:0:0': { tone: 'self', opacity: 0.28 },
      'grundinsel:1:0': null,
      'grundinsel:2:0': { tone: 'partner', opacity: 0.28 },
      'grundinsel:0:1': null,
      'grundinsel:1:1': null,
      'grundinsel:2:1': null,
    });
  });

  test('die Färbung folgt der betrachtenden Person: Für Anna ist ihre Ecke `self`', () => {
    expect(tints({ mode: 'bereiche', viewerPersonId: anna })).toMatchObject({
      'grundinsel:0:0': { tone: 'partner' },
      'grundinsel:2:0': { tone: 'self' },
    });
  });

  test('ohne „Bereiche“ ist kein Feld gefärbt', () => {
    expect(Object.values(tints({ mode: 'ansehen' })).every((tint) => tint === null)).toBe(true);
  });
});

describe('Treffer-Umkehrung', () => {
  test('ein Punkt in der Raute trifft genau dieses Feld, auch dicht an ihren Ecken', () => {
    const scene = islandScene(request());

    // Feld (2, 1): Mitte (32, 64); obere Ecke (32, 48), rechte (64, 64), untere (32, 80), linke (0, 64).
    expect(scene.hitAt({ x: 32, y: 64 })).toEqual({ type: 'feld', field: 'grundinsel:2:1', kind: 'strand', owner: null });
    expect(scene.hitAt({ x: 32, y: 49 })).toMatchObject({ field: 'grundinsel:2:1' });
    expect(scene.hitAt({ x: 62, y: 64 })).toMatchObject({ field: 'grundinsel:2:1' });
    expect(scene.hitAt({ x: 32, y: 79 })).toMatchObject({ field: 'grundinsel:2:1' });
    expect(scene.hitAt({ x: 2, y: 64 })).toMatchObject({ field: 'grundinsel:2:1' });
    // Knapp über der oberen Ecke liegt Feld (1, 0), die rechte Nachbarraute von (0, 0).
    expect(scene.hitAt({ x: 32, y: 47 })).toMatchObject({ field: 'grundinsel:1:0' });
  });

  test('meldet, wem das Feld gehört, aus Sicht der betrachtenden Person', () => {
    // Feld (0, 0): Mitte (0, 16); Feld (2, 0): Mitte (64, 48).
    expect(islandScene(request()).hitAt({ x: 0, y: 16 })).toEqual({ type: 'feld', field: 'grundinsel:0:0', kind: 'ecke', owner: 'self' });
    expect(islandScene(request()).hitAt({ x: 64, y: 48 })).toMatchObject({ owner: 'partner' });
    expect(islandScene(request({ viewerPersonId: anna })).hitAt({ x: 64, y: 48 })).toMatchObject({ owner: 'self' });
  });

  test('bei Zoom 2 trifft der doppelt so weit entfernte Punkt dasselbe Feld', () => {
    expect(islandScene(request({ zoom: 2 })).hitAt({ x: 64, y: 128 })).toMatchObject({ field: 'grundinsel:2:1' });
  });

  test('Momo trifft man auf seinem Feld und an seinem Kopf darüber; daneben bleibt es das Feld (#184)', () => {
    const scene = islandScene(request());

    // Momo steht mittig auf der Lichtung (1, 0): Mitte (32, 32), etwa ein Feld hoch.
    expect(scene.hitAt({ x: 32, y: 34 })).toEqual({ type: 'momo' });
    expect(scene.hitAt({ x: 32, y: 8 })).toEqual({ type: 'momo' });
    expect(scene.hitAt({ x: 0, y: 16 })).toMatchObject({ type: 'feld', field: 'grundinsel:0:0' });
    expect(islandScene(request({ zoom: 2 })).hitAt({ x: 64, y: 16 })).toEqual({ type: 'momo' });
  });

  test('Momos Trefferfläche ist mindestens 44 × 44 dp: ein Rechteck um das Rig, dessen Mitte 19 dp über der Feldmitte liegt (#187)', () => {
    const scene = islandScene(request());

    // Figurmitte (32, 13); das Rechteck reicht von (10, −10) bis (54, 36), bis über Krone und Strohhütchen.
    expect(scene.hitAt({ x: 10, y: 13 })).toEqual({ type: 'momo' });
    expect(scene.hitAt({ x: 54, y: 13 })).toEqual({ type: 'momo' });
    expect(scene.hitAt({ x: 32, y: -10 })).toEqual({ type: 'momo' });
    expect(scene.hitAt({ x: 32, y: 36 })).toEqual({ type: 'momo' });
    // Rand von Momos eigenem Feld (1, 0), außerhalb des Rechtecks: das Feld, nicht Momo.
    expect(scene.hitAt({ x: 58, y: 34 })).toMatchObject({ type: 'feld', field: 'grundinsel:1:0' });
    expect(scene.hitAt({ x: 32, y: 38 })).toMatchObject({ type: 'feld' });
  });

  test('ohne Lichtung gibt es keinen Momo-Treffer', () => {
    const ohneLichtung = { ...island, fields: island.fields.filter((field) => field.kind !== 'lichtung') };

    expect(islandScene(request({ island: ohneLichtung })).hitAt({ x: 32, y: 34 })).toBeNull();
  });

  test('Wasser neben der Insel trifft nichts', () => {
    const scene = islandScene(request());

    expect(scene.hitAt({ x: -40, y: 16 })).toBeNull();
    expect(scene.hitAt({ x: 32, y: 120 })).toBeNull();
  });
});

