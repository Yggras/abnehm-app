/**
 * @jest-environment node
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';

import { writeCatalogFile } from '../../scripts/bls-catalog/catalog-file.ts';
import { testCatalogFoods } from '../nutrition/testing/test-catalog';
import { catalogAssetSource, catalogVersion, type BundledCatalog, type InstalledCatalogs } from './catalog';
import { openCatalog } from './testing/better-sqlite-catalog';

// Nachweis für #154: Die App ersetzt die installierte Katalogdatei nur bei einer neuen Katalogversion.
// Das Kopieren übernimmt in der App expo-sqlite (`SQLiteProvider` mit `assetSource`); `importAsset`
// bildet dessen Verhalten nach: Eine vorhandene Datei bleibt, außer bei `forceOverwrite`
// (expo-sqlite 58.0.13, `importAssetDatabase` in ios/SQLiteModule.swift und
// `importAssetDatabaseAsync` in android/…/SQLiteModule.kt).

let directory: string;
const databaseName = 'bls-katalog.db';
const installedPath = () => join(directory, databaseName);

const installed: InstalledCatalogs = {
  version: (name) => {
    if (!existsSync(join(directory, name))) return null;
    const database = openCatalog(join(directory, name));
    try {
      return catalogVersion(database);
    } finally {
      database.close();
    }
  },
};

/** Gebündeltes Asset einer Katalogversion; die Asset-ID ist hier der Index in `assets`. */
const assets: string[] = [];
function bundle(version: string): BundledCatalog {
  const path = join(directory, `asset-${version}.db`);
  writeFileSync(path, writeCatalogFile(testCatalogFoods, { version, attribution: 'Testquelle' }));
  assets.push(path);
  return { databaseName, version, assetId: assets.length - 1 };
}

function importAsset(catalog: BundledCatalog) {
  const { assetId, forceOverwrite } = catalogAssetSource(catalog, installed);
  if (existsSync(installedPath()) && !forceOverwrite) return;
  copyFileSync(assets[assetId] as string, installedPath());
}

function installedState() {
  const client = new Database(installedPath(), { readonly: true });
  try {
    return client.prepare('SELECT version, attribution FROM catalog_info').get();
  } finally {
    client.close();
  }
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'abnehm-katalog-'));
  assets.length = 0;
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('Katalogversion beim Öffnen', () => {
  it('kopiert das Asset beim ersten Start', () => {
    const catalog = bundle('v1');

    expect(catalogAssetSource(catalog, installed)).toEqual({ assetId: catalog.assetId, forceOverwrite: true });
    importAsset(catalog);
    expect(installedState()).toEqual({ version: 'v1', attribution: 'Testquelle' });
  });

  it('lässt die installierte Datei bei gleicher Version stehen', () => {
    const catalog = bundle('v1');
    importAsset(catalog);
    markInstalledFile();

    expect(catalogAssetSource(catalog, installed).forceOverwrite).toBe(false);
    importAsset(catalog);
    expect(installedState()).toEqual({ version: 'v1', attribution: 'markiert' });
  });

  it('ersetzt die installierte Datei bei einer neuen Version', () => {
    importAsset(bundle('v1'));
    markInstalledFile();
    const update = bundle('v2');

    expect(catalogAssetSource(update, installed).forceOverwrite).toBe(true);
    importAsset(update);
    expect(installedState()).toEqual({ version: 'v2', attribution: 'Testquelle' });
  });

  it('ersetzt eine leere oder fremde Datei unter dem Katalognamen', () => {
    // expo-sqlite legt beim Öffnen einer fehlenden Datei eine leere an; sie hat keine Version.
    new Database(installedPath()).close();
    const catalog = bundle('v1');

    expect(catalogAssetSource(catalog, installed).forceOverwrite).toBe(true);
    importAsset(catalog);
    expect(installedState()).toEqual({ version: 'v1', attribution: 'Testquelle' });
  });
});

/** Ändert die installierte Datei, damit sichtbar wird, ob sie ersetzt wurde. */
function markInstalledFile() {
  const client = new Database(installedPath());
  client.prepare("UPDATE catalog_info SET attribution = 'markiert'").run();
  client.close();
}
