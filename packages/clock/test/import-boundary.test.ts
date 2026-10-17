import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const eslint = new ESLint({ cwd: repoRoot });

async function violations(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages.map((message) => message.ruleId) ?? [];
}

const testClockImport = "import { createTestClock } from '@abnehm/clock/testing';\nexport const c = createTestClock;";
const conformanceImport =
  "import { clockConformanceCases } from '@abnehm/clock/conformance';\nexport const c = clockConformanceCases;";

describe('Testuhr nur in Tests', () => {
  it.each(['apps/backend/src/probe.ts', 'apps/mobile/src/probe.ts', 'apps/mobile/src/app/probe.tsx'])(
    'sperrt Testuhr und Testkit in Produktionscode (%s)',
    async (filePath) => {
      expect(await violations(testClockImport, filePath)).toContain('no-restricted-imports');
      expect(await violations(conformanceImport, filePath)).toContain('no-restricted-imports');
    },
  );

  it.each(['apps/mobile/src/probe.test.ts', 'apps/backend/test/probe.test.ts'])(
    'erlaubt sie in Testdateien (%s)',
    async (filePath) => {
      expect(await violations(testClockImport, filePath)).toEqual([]);
    },
  );
});

describe('Bereichscode liest die Zeit nur über die Uhr', () => {
  it.each(['export const t = Date.now();', 'export const t = new Date();'])(
    'verbietet %s in App und Backend',
    async (code) => {
      expect(await violations(code, 'apps/mobile/src/probe.ts')).toContain('no-restricted-syntax');
      expect(await violations(code, 'apps/backend/src/probe.ts')).toContain('no-restricted-syntax');
    },
  );

  it('erlaubt das Umrechnen gespeicherter Zeitpunkte', async () => {
    const code = "export const t = new Date('2026-10-14T12:00:00.000Z').getTime();";
    expect(await violations(code, 'apps/backend/src/probe.ts')).toEqual([]);
  });
});

describe('Importgrenze der Uhr', () => {
  it.each(["import { Platform } from 'react-native';", "import * as Localization from 'expo-localization';"])(
    'verbietet %s',
    async (code) => {
      expect(await violations(code, 'packages/clock/src/probe.ts')).toContain('no-restricted-imports');
    },
  );

  it('erlaubt das Vertragsmodul', async () => {
    const code = "import { Instant } from '@abnehm/contracts/base';\nexport const i = Instant;";
    expect(await violations(code, 'packages/clock/src/probe.ts')).toEqual([]);
  });
});

describe('Backend in der App', () => {
  it('erlaubt nur Typen aus dem Backend', async () => {
    const typeOnly = "import type { AppType } from '@abnehm/backend/rpc';\nexport type A = AppType;";
    const runtime = "import { createApp } from '@abnehm/backend/rpc';\nexport const a = createApp;";

    expect(await violations(typeOnly, 'apps/mobile/src/probe.ts')).toEqual([]);
    expect(await violations(runtime, 'apps/mobile/src/probe.ts')).toContain('no-restricted-imports');
  });
});
