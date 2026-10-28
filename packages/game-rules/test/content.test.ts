import { describe, expect, it } from 'vitest';

import { gameCatalog } from '../content/index.ts';
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
