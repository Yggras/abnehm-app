/**
 * @jest-environment node
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Das Build-Skript läuft unter Node ohne Bundler und lädt dabei App-Dateien (`search-text.ts`,
// `bls-catalog-version.ts`). Jest löst Importe wie Metro auf und bemerkt deshalb nicht, wenn eine
// dieser Dateien einen Import bekommt, den Node nicht laden kann. Dieser Test lädt die Module wie
// `npm run bls-katalog`.

it('lädt seine Module unter Node wie npm run bls-katalog', () => {
  const modules = ['bls-source.ts', 'catalog-file.ts', '../../src/nutrition/bls-catalog-version.ts'];
  const script = modules.map((file) => `await import(${JSON.stringify(pathToFileURL(join(__dirname, file)).href)});`).join('\n');

  expect(() =>
    execFileSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--input-type=module', '--eval', script], {
      stdio: 'pipe',
    }),
  ).not.toThrow();
});
