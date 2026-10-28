/**
 * @jest-environment node
 */
import { testCatalogFoods } from '../../src/nutrition/testing/test-catalog';
import { writeCatalogFile } from './catalog-file.ts';

// Nachweis für #154: Das Build-Skript erzeugt den Katalog reproduzierbar.

const info = { version: 'test-1', attribution: 'Testquelle' };

describe('writeCatalogFile', () => {
  it('erzeugt aus denselben Lebensmitteln dieselben Bytes, unabhängig von ihrer Reihenfolge', () => {
    const first = writeCatalogFile(testCatalogFoods, info);
    const second = writeCatalogFile([...testCatalogFoods].reverse(), info);

    expect(second.equals(first)).toBe(true);
  });

  it('ändert die Bytes mit der Katalogversion', () => {
    expect(writeCatalogFile(testCatalogFoods, { ...info, version: 'test-2' }).equals(writeCatalogFile(testCatalogFoods, info))).toBe(false);
  });
});
