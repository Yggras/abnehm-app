import { gameCatalog } from '@abnehm/game-rules/content';

import { size } from '../design';
import { artBounds, artOf } from './art';

// Grafiken der Start-Baupläne (#192), der Besucher-Baupläne (#202) und der Entdeckungs-Baupläne (#204) je Stufe
// 1–3, der Besucher- und Entdeckungs-Deko und der Besucher (#202, #204; Design-System › Insel): Ein Objekt steht mittig auf
// seinem Feld und ist höchstens zwei Felder hoch; jede Stufe ist etwas größer und hat ein Detail mehr.
// Gerechnet in dp bei Zoom 1 um die Feldmitte; ein Feld ist `island-tile` breit und halb so hoch.

const drawnBlueprints = gameCatalog.blueprints.filter((blueprint) => blueprint.origin === 'start' || blueprint.origin === 'besucher' || blueprint.origin === 'entdeckung');
const tile = size.islandTile;
const fieldHeight = tile / 2;
const stages = drawnBlueprints.flatMap((blueprint) => blueprint.art.map((art, index) => [blueprint.key, index + 1, art] as const));

test.each(stages)('%s, Stufe %d, hat eine eigene Zeichnung', (_, stage, art) => {
  const spec = artOf(art);

  expect(spec.stage).toBe(stage);
  expect(spec.drawing.length).toBeGreaterThan(0);
  expect(spec).not.toBe(artOf('unbekannt'));
});

test.each(stages)('%s, Stufe %d, ist höchstens zwei Felder hoch, steht mittig und bleibt auf dem Feld', (_, __, art) => {
  const bounds = artBounds(artOf(art));

  expect(bounds.height).toBeLessThanOrEqual(2 * fieldHeight);
  expect(bounds.width).toBeLessThanOrEqual(tile);
  // Mittig: Die Mitte der Grafik liegt höchstens 4 dp neben der Feldmitte (der Schlagschatten fällt nach rechts).
  expect(Math.abs(bounds.x + bounds.width / 2)).toBeLessThanOrEqual(4);
  // Der Fuß reicht nicht über die untere Ecke des Felds hinaus.
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(fieldHeight / 2);
});

test.each(drawnBlueprints.map((blueprint) => [blueprint.key, blueprint.art] as const))(
  '%s: jede Stufe ist etwas größer und hat ein Detail mehr',
  (_, [first, second, third]) => {
    const [one, two, three] = [first, second, third].map(artOf);
    const area = (art: string) => {
      const { width, height } = artBounds(artOf(art));
      return width * height;
    };

    expect(area(second)).toBeGreaterThan(area(first));
    expect(area(third)).toBeGreaterThan(area(second));
    expect(two!.drawing.length).toBeGreaterThan(one!.drawing.length);
    expect(three!.drawing.length).toBeGreaterThan(two!.drawing.length);
  },
);

test('nur die Laterne leuchtet abends, auf jeder Stufe am Licht ihrer Grafik', () => {
  const lit = stages.filter(([, , art]) => artOf(art).lit).map(([key, stage]) => `${key} ${stage}`);
  expect(lit).toEqual(['laterne 1', 'laterne 2', 'laterne 3']);
  for (const art of drawnBlueprints.find((blueprint) => blueprint.key === 'laterne')!.art) {
    const { light } = artOf(art);
    const bounds = artBounds(artOf(art));
    expect(light).not.toBeNull();
    expect(light!.y).toBeGreaterThanOrEqual(bounds.y);
    expect(light!.y).toBeLessThan(0);
  }
});

test('einen unbekannten Schlüssel zeichnet die Insel als neutralen Block', () => {
  expect(artOf('gibt_es_nicht')).toMatchObject({ stage: 1, lit: false, light: null });
  expect(artOf('gibt_es_nicht').drawing.length).toBeGreaterThan(0);
});

const flatArt = [
  ...gameCatalog.deko.filter((deko) => deko.origin === 'besucher' || deko.origin === 'entdeckung').map((deko) => ['Deko', deko.art] as const),
  ...gameCatalog.visitorTemplates.map((visitor) => ['Besucher', visitor.animal] as const),
];

test.each(flatArt)('%s %s hat eine eigene Zeichnung, passt auf ein Feld und leuchtet nicht', (_, art) => {
  const spec = artOf(art);
  const bounds = artBounds(spec);

  expect(spec).not.toBe(artOf('unbekannt'));
  expect(spec).toMatchObject({ stage: 1, lit: false });
  expect(bounds.height).toBeLessThanOrEqual(2 * fieldHeight);
  expect(bounds.width).toBeLessThanOrEqual(tile);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(fieldHeight / 2);
});

// Gemeinschaftsprojekte (#208): Das Gerüst wächst mit der gemeinsamen Stufe; das Wahrzeichen von Projekt 1 ist gezeichnet.
const scaffoldStages = ['gestartet', 'gut_unterwegs', 'fast_geschafft'] as const;

test('das Gerüst wird mit jeder gemeinsamen Stufe höher und hat eine Lage mehr', () => {
  const [one, two, three] = scaffoldStages.map((stage) => artOf(`geruest_${stage}`));
  for (const spec of [one, two, three]) expect(spec).not.toBe(artOf('unbekannt'));
  expect(artBounds(two!).height).toBeGreaterThan(artBounds(one!).height);
  expect(artBounds(three!).height).toBeGreaterThan(artBounds(two!).height);
  expect(two!.drawing.length).toBeGreaterThan(one!.drawing.length);
  expect(three!.drawing.length).toBeGreaterThan(two!.drawing.length);
});

test.each([...scaffoldStages.map((stage) => `geruest_${stage}`), 'gartenhaeuschen'])('%s steht mittig auf dem Bauplatz und ist höchstens zwei Felder hoch', (art) => {
  const bounds = artBounds(artOf(art));
  expect(artOf(art)).not.toBe(artOf('unbekannt'));
  expect(bounds.height).toBeLessThanOrEqual(2 * fieldHeight);
  expect(bounds.width).toBeLessThanOrEqual(tile);
  expect(Math.abs(bounds.x + bounds.width / 2)).toBeLessThanOrEqual(4);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(fieldHeight / 2);
});
