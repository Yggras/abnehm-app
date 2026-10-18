import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Prüft, dass eslint.config.js die Grenzen aus docs/entwicklung.md tatsächlich erzwingt.

const eslint = new ESLint({ cwd: fileURLToPath(new URL('..', import.meta.url)) });

/** Lintet Quelltext so, als läge er unter `filePath`, und liefert die verletzten Regeln. */
async function violations(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages.map((message) => message.ruleId) ?? [];
}

describe('Importgrenze des Vertragsmoduls', () => {
  const inContracts = (code: string) => violations(code, 'packages/contracts/src/probe.ts');

  it.each([
    ["import { useState } from 'react';", 'React'],
    ["import { View } from 'react-native';", 'React Native'],
    ["import * as SQLite from 'expo-sqlite';", 'Plattform (Expo)'],
    ["import { pgTable } from 'drizzle-orm/pg-core';", 'Drizzle'],
    ["import { hc } from 'hono/client';", 'Netzwerk (Hono)'],
    ["import { readFileSync } from 'node:fs';", 'Plattform (Node)'],
    ["import type { Hono } from 'hono';", 'auch reine Typimporte'],
    ["export { z as zod } from 'zod-mini-fork';", 'ähnlich benannte Pakete'],
  ])('verbietet %s (%s)', async (code) => {
    expect(await inContracts(code)).toContain('no-restricted-imports');
  });

  it('verbietet dynamische Importe', async () => {
    expect(await inContracts("export const load = () => import('pg');")).toContain('no-restricted-syntax');
  });

  it.each([
    "export const x = fetch('https://example.org');",
    'export const env = process.env;',
    'export const w = window;',
  ])('verbietet globale Plattform-APIs: %s', async (code) => {
    expect(await inContracts(code)).toContain('no-restricted-globals');
  });

  it.each([
    "import { z } from 'zod';\nexport const s = z.string();",
    "import { Instant } from './base.ts';\nexport const i = Instant;",
  ])('erlaubt Zod und eigene Dateien: %s', async (code) => {
    expect(await inContracts(code)).toEqual([]);
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

describe('Bereichscode liest Zeit und Zone nur über die Uhr', () => {
  it.each([
    'export const t = Date.now();',
    'export const t = new Date();',
    'export const t = Date();',
    'export const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;',
  ])('verbietet %s in App und Backend', async (code) => {
    expect(await violations(code, 'apps/mobile/src/probe.ts')).toContain('no-restricted-syntax');
    expect(await violations(code, 'apps/backend/src/probe.ts')).toContain('no-restricted-syntax');
  });

  it('verbietet expo-localization außerhalb des Geräteadapters', async () => {
    const code = "import { getCalendars } from 'expo-localization';\nexport const c = getCalendars;";
    expect(await violations(code, 'apps/mobile/src/start/probe.ts')).toContain('no-restricted-imports');
    expect(await violations(code, 'apps/mobile/src/clock/probe.ts')).toEqual([]);
  });

  it('erlaubt das Umrechnen gespeicherter Zeitpunkte', async () => {
    const code = "export const t = new Date('2026-10-14T12:00:00.000Z').getTime();";
    expect(await violations(code, 'apps/backend/src/probe.ts')).toEqual([]);
  });
});

describe('Testuhr nur in Tests', () => {
  const testClockImport = "import { createTestClock } from '@abnehm/clock/testing';\nexport const c = createTestClock;";
  const conformanceImport =
    "import { clockConformanceCases } from '@abnehm/clock/conformance';\nexport const c = clockConformanceCases;";

  it.each(['apps/backend/src/probe.ts', 'apps/mobile/src/probe.ts', 'apps/mobile/src/clock/probe.ts'])(
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

describe('Vertrags-Fixtures nur in Tests', () => {
  const fixturesImport = "import { fixtureCases } from '@abnehm/contracts/fixtures';\nexport const f = fixtureCases;";

  it.each(['apps/backend/src/probe.ts', 'apps/mobile/src/probe.ts'])('sperrt sie in Produktionscode (%s)', async (filePath) => {
    expect(await violations(fixturesImport, filePath)).toContain('no-restricted-imports');
  });

  it.each(['apps/mobile/src/probe.test.ts', 'apps/backend/test/probe.test.ts'])('erlaubt sie in Testdateien (%s)', async (filePath) => {
    expect(await violations(fixturesImport, filePath)).toEqual([]);
  });

  it('die Fixtures selbst nutzen wie das Vertragsmodul nur Zod und eigene Dateien', async () => {
    const code = "import { Hono } from 'hono';\nexport const h = Hono;";
    expect(await violations(code, 'packages/contracts/fixtures/probe.ts')).toContain('no-restricted-imports');
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

describe('Farben nur aus den Design-Tokens', () => {
  const inApp = (code: string) => violations(code, 'apps/mobile/src/start/probe.tsx');

  it.each([
    "export const s = { color: '#1D3332' };",
    "export const s = { backgroundColor: 'white' };",
    "export const s = { borderColor: 'rgba(0, 0, 0, 0.2)' };",
    "export const s = { boxShadow: '0 4px 0 0 #E4D2B0' };",
    "export const ink = '#1d3332';",
    "export const ink = 'hsl(170, 28%, 17%)';",
    'export const e = <Svg stroke="#0B7470" />;',
    "export const e = <Text style={{ color: 'red' }} />;",
    'export const e = <Path fill={`#${hex}`} />;',
  ])('verbietet rohe Farben: %s', async (code) => {
    expect(await inApp(code)).toContain('abnehm/token-farben');
  });

  it.each([
    "import { color } from '../design';\nexport const s = { color: color.ink, backgroundColor: 'transparent' };",
    "import Svg from 'react-native-svg';\nexport const e = <Svg fill=\"none\" />;",
    "export const t = 'Ticket #12 und Punkt 3';",
  ])('erlaubt Tokens und Schlüsselwörter: %s', async (code) => {
    expect(await inApp(code)).toEqual([]);
  });

  it('erlaubt rohe Farben nur in der Token-Datei und in Tests', async () => {
    const code = "export const s = { color: '#1D3332' };";
    expect(await violations(code, 'apps/mobile/src/design/tokens.ts')).toEqual([]);
    expect(await violations(code, 'apps/mobile/src/design/Button.test.tsx')).toEqual([]);
  });
});

describe('Plattformbibliotheken nur hinter ihrem Projektmodul', () => {
  it.each([
    ["import * as Haptics from 'expo-haptics';\nexport const h = Haptics;", 'apps/mobile/src/haptics/probe.ts'],
    ["import { Host } from '@expo/ui';\nexport const h = Host;", 'apps/mobile/src/design/native/probe.tsx'],
    ["import { MenuView } from '@expo/ui/community/menu';\nexport const m = MenuView;", 'apps/mobile/src/design/native/probe.tsx'],
    ["import { useFonts } from 'expo-font';\nexport const f = useFonts;", 'apps/mobile/src/design/fonts.ts'],
  ])('erlaubt %s in %s', async (code, filePath) => {
    expect(await violations(code, filePath)).toEqual([]);
  });

  it.each([
    "import * as Haptics from 'expo-haptics';\nexport const h = Haptics;",
    "import { Host } from '@expo/ui';\nexport const h = Host;",
    "import { labelsHidden } from '@expo/ui/swift-ui/modifiers';\nexport const l = labelsHidden;",
    "import { useFonts } from 'expo-font';\nexport const f = useFonts;",
    "import { Rubik_400Regular } from '@expo-google-fonts/rubik/400Regular';\nexport const r = Rubik_400Regular;",
    "export const h = () => import('expo-haptics');",
  ])('verbietet im Bereichscode: %s', async (code) => {
    expect(await violations(code, 'apps/mobile/src/start/probe.tsx')).toContain('abnehm/bibliotheksgrenzen');
  });
});
