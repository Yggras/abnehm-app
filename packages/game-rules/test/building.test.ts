import { describe, expect, it } from 'vitest';

import { gameCatalog } from '../content/index.ts';
import { decideBuild, serverDebtLimit, type BuildRequest } from '../src/building.ts';
import { indexCatalog } from '../src/catalog.ts';

// Nachweis für #191: Was App und Server vor einem Bau prüfen (Spezifikation 4, Abschnitte 3, 4 und 11).
// Grundinsel aus dem ausgelieferten Katalog: `grundinsel:0:0` ist Ecke a, `grundinsel:4:0` Rollenbereich a,
// `grundinsel:6:0` Gemeinschaftsplatz, `grundinsel:12:0` Ecke b.

const catalog = indexCatalog(gameCatalog);
const self = '0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01';
const partner = '0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b02';
const startKeys = new Set(gameCatalog.blueprints.filter((blueprint) => blueprint.origin === 'start').map((blueprint) => blueprint.key));

const request = (overrides: Partial<BuildRequest> = {}): BuildRequest => ({
  blueprintKey: 'laterne',
  field: { key: 'grundinsel:0:0', ownerPersonId: self },
  person: { personId: self, role: 'bauen' },
  unlockedBlueprints: startKeys,
  balance: 10,
  checkedBy: 'geraet',
  ...overrides,
});

describe('Bauen prüfen', () => {
  it('erlaubt einen freigeschalteten Bauplan auf der eigenen Ecke zum Grundpreis', () => {
    expect(decideBuild(catalog, request())).toEqual({ type: 'erlaubt', price: 3 });
    // In der eigenen Ecke auch Baupläne der anderen Rolle.
    expect(decideBuild(catalog, request({ blueprintKey: 'blumenwiese' }))).toEqual({ type: 'erlaubt', price: 1 });
  });

  it('lehnt unbekannte Schlüssel ab, auch Feldschlüssel außerhalb des Katalogs', () => {
    expect(decideBuild(catalog, request({ blueprintKey: 'goldturm' }))).toEqual({ type: 'verboten', reason: 'unbekannter_schluessel' });
    expect(decideBuild(catalog, request({ field: { key: 'grundinsel:99:99', ownerPersonId: self } }))).toEqual({ type: 'verboten', reason: 'unbekannter_schluessel' });
  });

  it('lehnt einen Bauplan ab, den die Insel nicht freigeschaltet hat', () => {
    expect(decideBuild(catalog, request({ unlockedBlueprints: new Set(['holzweg']) }))).toEqual({ type: 'verboten', reason: 'nicht_freigeschaltet' });
  });

  it.each([
    ['Feld des Partners', { field: { key: 'grundinsel:12:0', ownerPersonId: partner } }, 'fremdes_feld'],
    ['Gemeinschaftsplatz', { field: { key: 'grundinsel:6:0', ownerPersonId: null } }, 'gemeinsamer_bereich'],
    ['Rollenbereich mit Bauplan der anderen Rolle', { field: { key: 'grundinsel:4:0', ownerPersonId: self }, blueprintKey: 'apfelbaum' }, 'falsche_rolle'],
  ] as const)('wendet die Platzierungsregeln an: %s', (_, overrides, reason) => {
    expect(decideBuild(catalog, request(overrides))).toEqual({ type: 'verboten', reason });
  });

  describe('auf dem Gerät nur bei ausreichendem Bestand', () => {
    it.each([
      [3, { type: 'erlaubt', price: 3 }],
      [2, { type: 'verboten', reason: 'zu_wenig_energie', missing: 1 }],
      [0, { type: 'verboten', reason: 'zu_wenig_energie', missing: 3 }],
      // Ein negativer Zwischenstand zählt wie angezeigt als 0.
      [-4, { type: 'verboten', reason: 'zu_wenig_energie', missing: 3 }],
    ])('Bestand %i', (balance, decision) => {
      expect(decideBuild(catalog, request({ balance }))).toEqual(decision);
    });
  });

  describe('auf dem Server nur bis zur Schutzgrenze −30', () => {
    it('liegt bei −30', () => {
      expect(serverDebtLimit).toBe(-30);
    });

    it.each([
      [3, { type: 'erlaubt', price: 3 }],
      // Zwei eigene Offline-Geräte dürfen sich überschneiden: Danach liegt der Bestand unter 0.
      [0, { type: 'erlaubt', price: 3 }],
      [-27, { type: 'erlaubt', price: 3 }],
      [-28, { type: 'verboten', reason: 'schutzgrenze' }],
    ])('Bestand %i', (balance, decision) => {
      expect(decideBuild(catalog, request({ balance, checkedBy: 'server' }))).toEqual(decision);
    });
  });
});
