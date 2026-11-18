import { gameCatalog } from '@abnehm/game-rules/content';
import { hatching } from '@abnehm/game-rules/hatching';

import { buildOptions, type BuildSituation } from './build-options';
import { anna, philipp } from './testing/persons';

// Bauoptionen für Bau-Sheet und Bau-Modus (#192; Spezifikation 4, Abschnitte 3 und 7): Welche Baupläne das
// Sheet zeigt, was sie kosten und welche Felder im Bau-Modus leuchten. Philipp hat Bauen und damit Seite a
// der Grundinsel: Ecke x 0–3 und y 0–4, Rollenbereich x 4–5 und y 0–4 sowie x 0–5 und y 5–9
// (`packages/game-rules/content/base-island.ts`).

const plan = hatching(gameCatalog, { proposerPersonId: anna, proposerRole: 'natur', partnerPersonId: philipp });
const startKeys = plan.blueprints.map((blueprint) => blueprint.key);
const ownCorner = 'grundinsel:0:0';
const ownRoleArea = 'grundinsel:4:0';
const partnerCorner = 'grundinsel:12:0';
const clearing = 'grundinsel:7:7';

function situation(overrides: Partial<BuildSituation> = {}): BuildSituation {
  return {
    viewerPersonId: philipp,
    ownRole: 'bauen',
    energy: 23,
    unlockedBlueprints: startKeys,
    fields: plan.fields,
    objects: [],
    ...overrides,
  };
}

const keys = (options: readonly { key: string }[]) => options.map((option) => option.key);
const ownFields = (kind: 'ecke' | 'rollenbereich') =>
  plan.fields.filter((field) => field.ownerPersonId === philipp && isKind(field.key, kind)).map((field) => field.key);
function isKind(key: string, kind: 'ecke' | 'rollenbereich') {
  const [, x, y] = key.split(':').map(Number) as [number, number, number];
  const corner = x <= 3 && y <= 4;
  return kind === 'ecke' ? corner : !corner;
}

describe('Bau-Sheet über „Bauen“, ohne Feld', () => {
  test('zeigt alle freigeschalteten Baupläne mit Preis, die eigene Rolle zuerst und jeweils nach Preis', () => {
    const options = buildOptions(situation()).blueprints(null);

    expect(options.map(({ key, name, price, missing }) => ({ key, name, price, missing }))).toEqual([
      { key: 'holzweg', name: 'Holzweg', price: 1, missing: 0 },
      { key: 'sitzbank', name: 'Sitzbank', price: 2, missing: 0 },
      { key: 'laterne', name: 'Laterne', price: 3, missing: 0 },
      // Baupläne der anderen Rolle passen nur in die eigene Ecke (Spezifikation 4, Abschnitt 3).
      { key: 'blumenwiese', name: 'Blumenwiese', price: 1, missing: 0 },
      { key: 'beerenstrauch', name: 'Beerenstrauch', price: 2, missing: 0 },
      { key: 'apfelbaum', name: 'Apfelbaum', price: 3, missing: 0 },
    ]);
  });

  test('ist ein Bauplan zu teuer, sagt er, wie viel Energie noch fehlt', () => {
    const options = buildOptions(situation({ energy: 1 })).blueprints(null);

    expect(options.map(({ key, missing }) => [key, missing])).toEqual([
      ['holzweg', 0],
      ['sitzbank', 1],
      ['laterne', 2],
      ['blumenwiese', 0],
      ['beerenstrauch', 1],
      ['apfelbaum', 2],
    ]);
  });

  test('nicht freigeschaltete Baupläne fehlen', () => {
    expect(keys(buildOptions(situation({ unlockedBlueprints: ['laterne'] })).blueprints(null))).toEqual(['laterne']);
  });

  test('ist die eigene Ecke voll bebaut, fehlen die Baupläne der anderen Rolle', () => {
    const objects = ownFields('ecke').map((fieldKey) => ({ fieldKey }));

    expect(keys(buildOptions(situation({ objects })).blueprints(null))).toEqual(['holzweg', 'sitzbank', 'laterne']);
  });
});

describe('Bau-Sheet nach Tipp auf ein freies eigenes Feld', () => {
  test('im eigenen Rollenbereich nur die Baupläne der eigenen Rolle', () => {
    expect(keys(buildOptions(situation()).blueprints(ownRoleArea))).toEqual(['holzweg', 'sitzbank', 'laterne']);
  });

  test('in der eigenen Ecke alle freigeschalteten Baupläne', () => {
    expect(keys(buildOptions(situation()).blueprints(ownCorner))).toEqual(['holzweg', 'sitzbank', 'laterne', 'blumenwiese', 'beerenstrauch', 'apfelbaum']);
  });

  test.each([
    ['ein Feld des Partners', partnerCorner],
    ['die Lichtung', clearing],
  ])('%s öffnet kein Bau-Sheet und bietet nichts an', (_, fieldKey) => {
    const options = buildOptions(situation());
    expect(options.opensSheet(fieldKey)).toBe(false);
    expect(options.blueprints(fieldKey)).toEqual([]);
  });

  test('ein bebautes eigenes Feld öffnet kein Bau-Sheet, ein freies schon', () => {
    const options = buildOptions(situation({ objects: [{ fieldKey: ownCorner }] }));
    expect(options.opensSheet(ownCorner)).toBe(false);
    expect(options.opensSheet(ownRoleArea)).toBe(true);
  });
});

describe('leuchtende Felder im Bau-Modus', () => {
  test('ein Bauplan der eigenen Rolle leuchtet auf allen freien eigenen Feldern', () => {
    const fields = buildOptions(situation({ objects: [{ fieldKey: ownCorner }] })).fields('laterne');

    expect([...fields].sort()).toEqual([...ownFields('ecke'), ...ownFields('rollenbereich')].filter((key) => key !== ownCorner).sort());
    expect(fields.size).toBe(20 + 40 - 1);
  });

  test('ein Bauplan der anderen Rolle leuchtet nur in der eigenen Ecke', () => {
    expect([...buildOptions(situation()).fields('apfelbaum')].sort()).toEqual(ownFields('ecke').sort());
  });

  test('auch ein zu teurer Bauplan zeigt, wohin er dürfte; ein unbekannter leuchtet nirgends', () => {
    expect(buildOptions(situation({ energy: 0 })).fields('laterne').size).toBe(60);
    expect(buildOptions(situation()).fields('gibt_es_nicht').size).toBe(0);
  });
});
