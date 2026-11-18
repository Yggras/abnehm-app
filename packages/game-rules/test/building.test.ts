import { describe, expect, it } from 'vitest';

import { gameCatalog } from '../content/index.ts';
import { decideBuild, decidePlacement, decideUpgrade, nextStage, serverDebtLimit, type BuildRequest, type PlaceRequest, type UpgradeRequest } from '../src/building.ts';
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
      [2, { type: 'verboten', reason: 'zu_wenig_energie', price: 3, missing: 1 }],
      [0, { type: 'verboten', reason: 'zu_wenig_energie', price: 3, missing: 3 }],
      // Ein negativer Zwischenstand zählt wie angezeigt als 0.
      [-4, { type: 'verboten', reason: 'zu_wenig_energie', price: 3, missing: 3 }],
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

// Nachweis für #194: Aufwerten und Platzieren prüfen App und Server mit denselben Regeln (Spezifikation 4,
// Abschnitte 3, 7 und 11). Die Laterne ist ein Start-Bauplan der Rolle Bauen mit Grundpreis 3.

const laterne = { catalogKey: 'laterne', origin: 'gebaut', level: 1 } as const;
/** Ein Katalog mit einem Deko-Stück, denn der ausgelieferte enthält noch keine Deko. */
const withDeko = indexCatalog({ ...gameCatalog, deko: [{ key: 'muschelkette', name: 'Muschelkette', art: 'muschelkette', origin: 'challenge' }] });

const upgrade = (overrides: Partial<UpgradeRequest> = {}): UpgradeRequest => ({ object: laterne, toLevel: 2, balance: 10, checkedBy: 'geraet', ...overrides });

describe('Aufwerten prüfen', () => {
  it('die nächste Stufe: 1 → 2 → 3, danach keine', () => {
    expect([1, 2, 3].map(nextStage)).toEqual([2, 3, null]);
  });

  it('kostet auf Stufe 2 das 2-Fache und auf Stufe 3 das 3-Fache des Grundpreises', () => {
    expect(decideUpgrade(catalog, upgrade())).toEqual({ type: 'erlaubt', price: 6 });
    expect(decideUpgrade(catalog, upgrade({ object: { ...laterne, level: 2 }, toLevel: 3 }))).toEqual({ type: 'erlaubt', price: 9 });
    // Start-Bauplan mit Grundpreis 1.
    expect(decideUpgrade(catalog, upgrade({ object: { ...laterne, catalogKey: 'blumenwiese' } }))).toEqual({ type: 'erlaubt', price: 2 });
  });

  it.each([
    ['schon auf der Zielstufe', { object: { ...laterne, level: 2 }, toLevel: 2 }],
    ['über eine Stufe hinweg', { toLevel: 3 }],
    ['über Stufe 3 hinaus gibt es kein Ziel', { object: { ...laterne, level: 3 }, toLevel: 3 }],
  ] as const)('nur genau eine Stufe weiter: %s', (_, overrides) => {
    expect(decideUpgrade(catalog, upgrade(overrides))).toEqual({ type: 'verboten', reason: 'falsche_stufe' });
  });

  it('Deko hat keine Stufen', () => {
    expect(decideUpgrade(withDeko, upgrade({ object: { catalogKey: 'muschelkette', origin: 'challenge', level: 1 } }))).toEqual({
      type: 'verboten',
      reason: 'nicht_aufwertbar',
    });
  });

  it('lehnt einen unbekannten Bauplan ab', () => {
    expect(decideUpgrade(catalog, upgrade({ object: { ...laterne, catalogKey: 'goldturm' } }))).toEqual({ type: 'verboten', reason: 'unbekannter_schluessel' });
  });

  it.each([
    [6, 'geraet', { type: 'erlaubt', price: 6 }],
    [5, 'geraet', { type: 'verboten', reason: 'zu_wenig_energie', price: 6, missing: 1 }],
    // Ein negativer Zwischenstand zählt wie angezeigt als 0.
    [-3, 'geraet', { type: 'verboten', reason: 'zu_wenig_energie', price: 6, missing: 6 }],
    [-24, 'server', { type: 'erlaubt', price: 6 }],
    [-25, 'server', { type: 'verboten', reason: 'schutzgrenze' }],
  ] as const)('Bestand %i (%s): das Gerät nur bei ausreichendem Bestand, der Server bis −30', (balance, checkedBy, decision) => {
    expect(decideUpgrade(catalog, upgrade({ balance, checkedBy }))).toEqual(decision);
  });
});

const place = (overrides: Partial<PlaceRequest> = {}): PlaceRequest => ({
  object: { catalogKey: 'laterne', origin: 'gebaut' },
  field: { key: 'grundinsel:0:0', ownerPersonId: self },
  person: { personId: self, role: 'bauen' },
  ...overrides,
});

describe('Platzieren prüfen', () => {
  it('erlaubt die eigene Ecke für Gebautes beider Rollen und für Deko', () => {
    expect(decidePlacement(catalog, place())).toEqual({ type: 'erlaubt' });
    expect(decidePlacement(catalog, place({ object: { catalogKey: 'apfelbaum', origin: 'gebaut' } }))).toEqual({ type: 'erlaubt' });
    expect(decidePlacement(withDeko, place({ object: { catalogKey: 'muschelkette', origin: 'challenge' } }))).toEqual({ type: 'erlaubt' });
  });

  it('im Rollenbereich Gebautes nur der aktuellen eigenen Rolle, Deko immer', () => {
    const rollenbereich = { key: 'grundinsel:4:0', ownerPersonId: self };
    expect(decidePlacement(catalog, place({ field: rollenbereich }))).toEqual({ type: 'erlaubt' });
    expect(decidePlacement(catalog, place({ field: rollenbereich, object: { catalogKey: 'apfelbaum', origin: 'gebaut' } }))).toEqual({
      type: 'verboten',
      reason: 'falsche_rolle',
    });
    // Nach einem Rollentausch gilt beim Umstellen die neue Rolle.
    expect(decidePlacement(catalog, place({ field: rollenbereich, person: { personId: self, role: 'natur' } }))).toEqual({ type: 'verboten', reason: 'falsche_rolle' });
    expect(decidePlacement(withDeko, place({ field: rollenbereich, object: { catalogKey: 'muschelkette', origin: 'challenge' } }))).toEqual({ type: 'erlaubt' });
  });

  it.each([
    ['ein Feld des Partners', { key: 'grundinsel:12:0', ownerPersonId: partner }, 'fremdes_feld'],
    ['den Gemeinschaftsplatz', { key: 'grundinsel:6:0', ownerPersonId: null }, 'gemeinsamer_bereich'],
  ] as const)('nie auf %s', (_, field, reason) => {
    expect(decidePlacement(catalog, place({ field }))).toEqual({ type: 'verboten', reason });
  });

  it('lehnt unbekannte Schlüssel ab: Bauplan, Deko und Feld', () => {
    expect(decidePlacement(catalog, place({ object: { catalogKey: 'goldturm', origin: 'gebaut' } }))).toEqual({ type: 'verboten', reason: 'unbekannter_schluessel' });
    expect(decidePlacement(catalog, place({ object: { catalogKey: 'muschelkette', origin: 'challenge' } }))).toEqual({ type: 'verboten', reason: 'unbekannter_schluessel' });
    expect(decidePlacement(catalog, place({ field: { key: 'grundinsel:99:99', ownerPersonId: self } }))).toEqual({ type: 'verboten', reason: 'unbekannter_schluessel' });
  });
});
