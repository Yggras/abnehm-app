import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SeedScenarioKey, seedManifests } from '@abnehm/contracts/seeds';

import { deviceConfigs } from '../apps/mobile/src/design/testing/device-configs.ts';
import { runtimeProfiles } from '../apps/mobile/src/test-capabilities/profiles.ts';
import { seedVariants, type SeedVariant, type SeedVariantKind } from './seed-varianten.ts';

// Aggregationstest der Seed-Varianten (#113): Die Registry (`test/seed-varianten.ts`) listet jedes
// Seed-Manifest, jedes Laufzeitprofil und jede Gerätekonfiguration genau einmal, und jede Variante nennt
// mindestens eine ausführbare Testdatei, die ihren Schlüssel ausdrücklich enthält.

const root = fileURLToPath(new URL('..', import.meta.url));

/** Testdateien, die eine der Suiten ausführt: Jest für die App, Vitest für Backend, Pakete und Repo. */
const executable = [/^apps\/mobile\/src\/.+\.test\.tsx?$/, /^apps\/backend\/test\/.+\.test\.ts$/, /^packages\/[^/]+\/test\/.+\.test\.ts$/, /^test\/.+\.test\.ts$/];

type Defined = Readonly<Record<SeedVariantKind, readonly string[]>>;

/** Was an der Registry nicht stimmt; leer, wenn alles passt. `read` liefert den Inhalt einer Testdatei oder `null`. */
export function variantProblems(variants: readonly SeedVariant[], defined: Defined, read: (file: string) => string | null): string[] {
  const problems: string[] = [];
  for (const kind of Object.keys(defined) as SeedVariantKind[]) {
    const registered = variants.filter((variant) => variant.kind === kind).map((variant) => variant.key);
    for (const key of new Set(registered.filter((key, index) => registered.indexOf(key) !== index))) problems.push(`${kind} ${key}: doppelt registriert`);
    for (const key of defined[kind]) if (!registered.includes(key)) problems.push(`${kind} ${key}: definiert, aber nicht registriert`);
    for (const key of registered) if (!defined[kind].includes(key)) problems.push(`${kind} ${key}: registriert, aber nicht definiert`);
  }
  for (const { kind, key, tests } of variants) {
    if (tests.length === 0) problems.push(`${kind} ${key}: kein Test`);
    for (const file of tests) {
      const source = read(file);
      if (source === null) problems.push(`${kind} ${key}: ${file} fehlt`);
      else if (!executable.some((pattern) => pattern.test(file))) problems.push(`${kind} ${key}: ${file} führt keine Testsuite aus`);
      else if (!source.includes(`'${key}'`)) problems.push(`${kind} ${key}: ${file} nennt den Schlüssel nicht`);
    }
  }
  return problems;
}

const readRepoFile = (file: string) => {
  const path = `${root}${file}`;
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
};

const defined: Defined = {
  'seed-manifest': Object.keys(seedManifests),
  laufzeitprofil: Object.keys(runtimeProfiles),
  geraetekonfiguration: Object.keys(deviceConfigs),
};

describe('Registry der Seed-Varianten', () => {
  it('listet jedes Manifest, Laufzeitprofil und jede Gerätekonfiguration genau einmal, jede mit ausführbarem Test', () => {
    expect(variantProblems(seedVariants, defined, readRepoFile)).toEqual([]);
  });

  it('jedes Szenario des Seed-Formats hat ein Manifest', () => {
    expect(Object.keys(seedManifests).sort()).toEqual([...SeedScenarioKey.options].sort());
  });

  it('Gerätekonfigurationen sind keine Seeds: weder Schlüssel eines Szenarios noch eines Laufzeitprofils', () => {
    const others = new Set([...defined['seed-manifest'], ...defined.laufzeitprofil]);
    for (const key of defined.geraetekonfiguration) expect(others.has(key)).toBe(false);
    // Sie stellen nur Systemeinstellungen nach, keinen Datenbankzustand.
    for (const config of Object.values(deviceConfigs)) expect(Object.keys(config).filter((field) => !['description', 'fontScale', 'reduceMotion'].includes(field))).toEqual([]);
  });

  describe('findet Fehler der Registry', () => {
    const tiny: Defined = { 'seed-manifest': ['solo'], laufzeitprofil: ['transport-offline'], geraetekonfiguration: [] };
    const file = 'apps/backend/test/beispiel.test.ts';
    const read = (path: string) => (path === file ? "manifestSuite('solo'); profil('transport-offline');" : null);

    it('fehlende und doppelte Schlüssel', () => {
      const variants: SeedVariant[] = [
        { kind: 'seed-manifest', key: 'solo', tests: [file] },
        { kind: 'seed-manifest', key: 'solo', tests: [file] },
        { kind: 'laufzeitprofil', key: 'uhr-reise', tests: [file] },
      ];
      expect(variantProblems(variants, tiny, read)).toEqual([
        'seed-manifest solo: doppelt registriert',
        'laufzeitprofil transport-offline: definiert, aber nicht registriert',
        'laufzeitprofil uhr-reise: registriert, aber nicht definiert',
        `laufzeitprofil uhr-reise: ${file} nennt den Schlüssel nicht`,
      ]);
    });

    it('Varianten ohne Test, mit fehlender oder nicht ausgeführter Testdatei', () => {
      const variants: SeedVariant[] = [
        { kind: 'seed-manifest', key: 'solo', tests: [] },
        { kind: 'laufzeitprofil', key: 'transport-offline', tests: ['apps/backend/test/fehlt.test.ts', 'apps/backend/test/support/seed-world.ts'] },
      ];
      const readAny = (path: string) => (path.endsWith('fehlt.test.ts') ? null : "'transport-offline'");
      expect(variantProblems(variants, tiny, readAny)).toEqual([
        'seed-manifest solo: kein Test',
        'laufzeitprofil transport-offline: apps/backend/test/fehlt.test.ts fehlt',
        'laufzeitprofil transport-offline: apps/backend/test/support/seed-world.ts führt keine Testsuite aus',
      ]);
    });
  });
});
