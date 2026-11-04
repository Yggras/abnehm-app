import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SeedScenarioKey, seedManifests } from '@abnehm/contracts/seeds';

import { deviceConfigs } from '../apps/mobile/src/design/testing/device-configs.ts';
import { runtimeProfiles } from '../apps/mobile/src/test-capabilities/profiles.ts';
import { seedVariants, variantProblems, type DefinedVariants, type SeedVariant } from './seed-varianten.ts';

// Aggregationstest der Seed-Varianten (#113): Die Registry (`test/seed-varianten.ts`) listet jedes
// Seed-Manifest, jedes Laufzeitprofil und jede Gerätekonfiguration genau einmal, und jede Variante nennt
// mindestens eine ausführbare Testdatei, die sie mit dem Aufruf ihrer Art ausführt.

const root = fileURLToPath(new URL('..', import.meta.url));

const readRepoFile = (file: string) => {
  const path = `${root}${file}`;
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
};

const defined: DefinedVariants = {
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
    const tiny: DefinedVariants = { 'seed-manifest': ['solo'], laufzeitprofil: ['transport-offline'], geraetekonfiguration: [] };
    const file = 'apps/backend/test/beispiel.test.ts';

    it('fehlende und doppelte Schlüssel', () => {
      const read = () => "manifestSuite('solo');\nprofiled('uhr-reise');";
      const variants: SeedVariant[] = [
        { kind: 'seed-manifest', key: 'solo', tests: [file] },
        { kind: 'seed-manifest', key: 'solo', tests: [file] },
        { kind: 'laufzeitprofil', key: 'uhr-reise', tests: [file] },
      ];
      expect(variantProblems(variants, tiny, read)).toEqual([
        'seed-manifest solo: doppelt registriert',
        'laufzeitprofil transport-offline: definiert, aber nicht registriert',
        'laufzeitprofil uhr-reise: registriert, aber nicht definiert',
      ]);
    });

    it('Varianten ohne Test, mit fehlender oder nicht ausgeführter Testdatei', () => {
      const variants: SeedVariant[] = [
        { kind: 'seed-manifest', key: 'solo', tests: [] },
        { kind: 'laufzeitprofil', key: 'transport-offline', tests: ['apps/backend/test/fehlt.test.ts', 'apps/backend/test/support/seed-world.ts'] },
      ];
      const read = (path: string) => (path.endsWith('fehlt.test.ts') ? null : "profiled('transport-offline');");
      expect(variantProblems(variants, tiny, read)).toEqual([
        'seed-manifest solo: kein Test',
        'laufzeitprofil transport-offline: apps/backend/test/fehlt.test.ts fehlt',
        'laufzeitprofil transport-offline: apps/backend/test/support/seed-world.ts führt keine Testsuite aus',
        "laufzeitprofil transport-offline: kein Test ruft profiled('transport-offline') auf",
      ]);
    });

    it.each([
      ['nur als Wert eines anderen Felds', "expect(state).toMatchObject({ currentState: 'solo' });"],
      ['nur im Kommentar', "// manifestSuite('solo');"],
      ['in einer Datei mit übersprungenen Tests', "manifestSuite('solo');\nit.skip('später', () => {});"],
    ])('ein Schlüssel %s ist kein Nachweis', (_, source) => {
      const problems = variantProblems([{ kind: 'seed-manifest', key: 'solo', tests: [file] }], { ...tiny, laufzeitprofil: [] }, () => source);
      expect(problems).toContain("seed-manifest solo: kein Test ruft manifestSuite('solo') auf");
    });
  });
});
