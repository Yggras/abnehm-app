import { describe, expect, it } from 'vitest';

import { gameCatalog } from '../content/index.ts';
import { areaUnlockAt, placeField } from '../src/areas.ts';
import { indexCatalog } from '../src/catalog.ts';
import { basePrice } from '../src/prices.ts';
import { unlocksAt } from '../src/unlocks.ts';

// Nachweis für #179: erster Inhalt des ausgelieferten Katalogs (Abschnitte 4 und 5 von #83).

const count = (kind: string, side?: string) =>
  gameCatalog.baseIsland.fields.filter((field) => field.kind === kind && (side === undefined || ('side' in field && field.side === side))).length;

describe('Grundinsel', () => {
  it('hat Strand, Lichtung und Gemeinschaftsplatz', () => {
    expect(count('strand')).toBeGreaterThan(0);
    expect(count('lichtung')).toBeGreaterThan(0);
    expect(count('gemeinschaftsplatz')).toBeGreaterThanOrEqual(9); // Platz für neun Wahrzeichen
  });

  it.each(['a', 'b'])('gibt Seite %s die Startfelder: 20 Ecke und 40 Rollenbereich', (side) => {
    expect(count('ecke', side)).toBe(20);
    expect(count('rollenbereich', side)).toBe(40);
  });
});

describe('Schlüpfen', () => {
  const start = unlocksAt(gameCatalog, 1);
  const index = indexCatalog(gameCatalog);
  const blueprintsOf = (role: string) =>
    start.blueprints.flatMap(({ key }) => {
      const found = index.find('bauplan', key);
      return found.type === 'found' && found.entry.role === role ? [found.entry] : [];
    });

  it.each(['bauen', 'natur'])('schaltet je Rolle drei Start-Baupläne zu 1, 2 und 3 Energie frei: %s', (role) => {
    expect(blueprintsOf(role).map(basePrice).sort()).toEqual([1, 2, 3]);
  });

  it('beginnt mit Gemeinschaftsprojekt 1 auf dem Gemeinschaftsplatz', () => {
    const [first] = gameCatalog.projects;
    expect(first).toBeDefined();
    const site = index.find('feld', first!.site);
    expect(site).toMatchObject({ type: 'found', entry: { kind: 'gemeinschaftsplatz' } });
    expect(index.find('gemeinschaftsprojekt', first!.key)).toMatchObject({ type: 'found', entry: { sequenceNumber: 1 } });
  });
});

// Nachweis für #187: Der vertikale Schnitt des Momo-Rigs bringt je ein Accessoire für Kopf und Hals.
describe('Momo-Accessoires', () => {
  it('gibt es je eines für Kopf und Hals: Strohhütchen und Muschelkette', () => {
    expect(gameCatalog.accessories.map(({ name, slot }) => [slot, name])).toEqual([
      ['kopf', 'Strohhütchen'],
      ['hals', 'Muschelkette'],
    ]);
  });

  it('passen auf alle acht Formen', () => {
    for (const accessory of gameCatalog.accessories) expect(Object.keys(accessory.fit)).toHaveLength(8);
  });
});

describe('Besucher mit Wunsch (#202)', () => {
  it('gibt es mindestens acht, je mit Tier, Wunsch und Belohnungspool', () => {
    expect(gameCatalog.visitorTemplates.length).toBeGreaterThanOrEqual(8);
    for (const visitor of gameCatalog.visitorTemplates) {
      expect(visitor.animal).not.toBe('');
      expect(visitor.wish).toBe('bauplan_bauen');
      expect(visitor.rewards.deko.length).toBeGreaterThan(0);
    }
  });

  it('bringen jeder Rolle eigene Besucher-Baupläne', () => {
    for (const role of ['bauen', 'natur'] as const) {
      const keys = gameCatalog.blueprints.filter((b) => b.origin === 'besucher' && b.role === role).map((b) => b.key);
      expect(keys.length).toBeGreaterThan(0);
      for (const visitor of gameCatalog.visitorTemplates) expect(visitor.rewards.blueprints.some((key) => keys.includes(key))).toBe(true);
    }
  });
});

describe('Gebiet 1 (#204)', () => {
  const sides = { a: 'person-a', b: 'person-b' } as const;
  const unlock = areaUnlockAt(gameCatalog, { level: 4, sides })!;
  const index = indexCatalog(gameCatalog);

  it('schaltet mit dem Hüpfer bei Level 4 die Schilfwiese frei', () => {
    expect(unlocksAt(gameCatalog, 4)).toMatchObject({ form: 'huepfer', area: { type: 'gebiet', key: 'schilfwiese' } });
  });

  it('bringt je Person 10 Felder Ecke und 30 Felder Rollenbereich, angrenzend an die Grundinsel', () => {
    const kinds = (person: string) =>
      unlock.fields.filter((field) => field.ownerPersonId === person).map((field) => placeField(gameCatalog, field.key)!.kind);
    for (const person of Object.values(sides)) {
      expect(kinds(person).filter((kind) => kind === 'ecke')).toHaveLength(10);
      expect(kinds(person).filter((kind) => kind === 'rollenbereich')).toHaveLength(30);
    }
    expect(placeField(gameCatalog, 'schilfwiese:0:-1')).toEqual({ x: 0, y: -1, kind: 'ecke', side: 'a' });
  });

  it('bringt zwei Entdeckungs-Baupläne je Rolle und Entdeckungs-Deko', () => {
    const roleOf = (key: string) => {
      const found = index.find('bauplan', key);
      return found.type === 'found' ? found.entry.role : null;
    };
    expect(unlock.discovery.blueprints.map(roleOf)).toEqual(['bauen', 'bauen', 'natur', 'natur']);
    expect(unlock.discovery.deko).toEqual(['steinfrosch']);
  });
});
