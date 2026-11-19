import { describe, expect, it } from 'vitest';

import { ContractError } from '@abnehm/contracts/errors';

import { gameCatalog } from '../content/index.ts';
import { testCatalog } from '../fixtures/index.ts';
import { indexCatalog, withCatalogNames } from '../src/catalog.ts';

// Nachweis für #179: Katalogformat nach Abschnitt 4 von #83; unbekannte Schlüssel ergeben
// `unknown_catalog_key`.

const shipped = indexCatalog(gameCatalog);
const test = indexCatalog(testCatalog());

describe('Nachschlagen im Katalog', () => {
  it('findet Einträge je Art', () => {
    expect(shipped.find('bauplan', 'holzweg')).toEqual({
      type: 'found',
      entry: expect.objectContaining({ key: 'holzweg', role: 'bauen', origin: 'start', startPrice: 1 }),
    });
    expect(shipped.find('gemeinschaftsprojekt', 'gartenhaeuschen')).toEqual({
      type: 'found',
      entry: expect.objectContaining({ key: 'gartenhaeuschen', sequenceNumber: 1, site: 'grundinsel:7:2' }),
    });
    expect(test.find('gebiet', 't_gebiet_2')).toEqual({ type: 'found', entry: expect.objectContaining({ unlockLevel: 8 }) });
    expect(test.find('deko', 't_ent_deko_1')).toEqual({ type: 'found', entry: expect.objectContaining({ origin: 'entdeckung' }) });
    expect(test.find('landschaftsvorlage', 't_vorlage_zweite').type).toBe('found');
  });

  it('meldet unbekannte Schlüssel als `unknown_catalog_key`, auch einen Schlüssel einer anderen Art', () => {
    for (const [kind, key] of [
      ['bauplan', 'gibt_es_nicht'],
      ['deko', 'holzweg'],
      ['accessoire', 'strohhut'],
      ['challenge_vorlage', 'wasser_marathon'],
      ['besuchervorlage', 'igel'],
    ] as const) {
      const result = shipped.find(kind, key);
      expect(result).toEqual({ type: 'contract_error', error: { code: 'unknown_catalog_key', context: { kind }, retryable: false } });
    }
  });

  it('liefert einen gültigen `ContractError` ohne den Schlüssel, damit ein manipulierter Schlüssel kein Text im Kontext wird', () => {
    const result = shipped.find('bauplan', 'Ein ganzer Satz mit Leerzeichen');
    expect(result).toEqual({ type: 'contract_error', error: { code: 'unknown_catalog_key', context: { kind: 'bauplan' }, retryable: false } });
    if (result.type === 'contract_error') expect(ContractError.safeParse(result.error).success).toBe(true);
  });
});

describe('Felder', () => {
  it('löst Feldschlüssel ‹gebiet›:‹x›:‹y› der Grundinsel und fester Gebiete auf', () => {
    expect(shipped.find('feld', 'grundinsel:0:0')).toEqual({
      type: 'found',
      entry: { key: 'grundinsel:0:0', area: 'grundinsel', x: 0, y: 0, kind: 'ecke', side: 'a' },
    });
    expect(shipped.find('feld', 'grundinsel:7:11')).toEqual({
      type: 'found',
      entry: { key: 'grundinsel:7:11', area: 'grundinsel', x: 7, y: 11, kind: 'strand' },
    });
    expect(test.find('feld', 't_gebiet_1:0:-5')).toEqual({
      type: 'found',
      entry: { key: 't_gebiet_1:0:-5', area: 't_gebiet_1', x: 0, y: -5, kind: 'ecke', side: 'a' },
    });
  });

  it('löst Felder endloser Gebiete über ihre Landschaftsvorlage auf', () => {
    expect(test.find('feld', 'endlos_2_t_vorlage_zweite:3:0')).toEqual({
      type: 'found',
      entry: { key: 'endlos_2_t_vorlage_zweite:3:0', area: 'endlos_2_t_vorlage_zweite', x: 3, y: 0, kind: 'rollenbereich', side: 'a' },
    });
  });

  it.each([
    'grundinsel:16:0',
    'grundinsel:0',
    'grundinsel:00:0',
    'unbekannt:0:0',
    'endlos_0_t_vorlage_erste:0:0',
    'endlos_1_t_vorlage_unbekannt:0:0',
    'endlos_1_t_vorlage_erste:99:0',
  ])('kennt %s nicht', (key) => {
    expect(test.find('feld', key)).toMatchObject({ type: 'contract_error', error: { code: 'unknown_catalog_key' } });
  });
});

describe('withCatalogNames', () => {
  it('ergänzt zu jedem Katalogschlüssel `‹x›Key` den Namen als `‹x›Name` und lässt alles andere unverändert (#210)', () => {
    const payload = { challengeId: 'c', templateKey: 'gut_getrunken', senderDisplayName: 'Anna', encouragementKey: 'stark_heute', decoKey: 'muschel' };
    expect(withCatalogNames(gameCatalog, payload)).toEqual({ ...payload, templateName: 'Gut getrunken', decoName: 'Muschel' });
    expect(withCatalogNames(gameCatalog, { templateKey: 'gibt_es_nicht' })).toEqual({ templateKey: 'gibt_es_nicht' });
    expect(withCatalogNames(gameCatalog, null)).toBeNull();
  });
});
