import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const eslint = new ESLint({ cwd: repoRoot });

/** Lintet Quelltext so, als läge er im Vertragsmodul, und liefert die verletzten Regeln. */
async function violations(code: string) {
  const [result] = await eslint.lintText(code, { filePath: 'packages/contracts/src/probe.ts' });
  return result?.messages.map((message) => message.ruleId) ?? [];
}

describe('Importgrenze des Vertragsmoduls', () => {
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
    expect(await violations(code)).toContain('no-restricted-imports');
  });

  it('verbietet dynamische Importe', async () => {
    expect(await violations("export const load = () => import('pg');")).toContain('no-restricted-syntax');
  });

  it.each([
    ["export const x = fetch('https://example.org');", 'fetch'],
    ['export const env = process.env;', 'process'],
    ['export const w = window;', 'window'],
  ])('verbietet die globale Plattform-API in %s (%s)', async (code) => {
    expect(await violations(code)).toContain('no-restricted-globals');
  });

  it.each([
    "import { z } from 'zod';\nexport const s = z.string();",
    "import { Instant } from './base.ts';\nexport const i = Instant;",
    "import { Instant } from '../src/base.ts';\nexport const i = Instant;",
  ])('erlaubt Zod und eigene Dateien: %s', async (code) => {
    expect(await violations(code)).toEqual([]);
  });
});
