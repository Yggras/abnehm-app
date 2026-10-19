import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { SchemaFixtures } from '../fixtures/define.ts';
import { contractFixtures, fixtureCases, type FixtureCase } from '../fixtures/index.ts';

// Nachweis für #94: Jedes exportierte Schema hat mindestens ein gültiges und ein ungültiges Fixture,
// und die Fixtures sind genau das, was über HTTP (JSON) zwischen App und Backend reist.

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  exports: Record<string, string>;
};

/** Alle exportierten Schemas, benannt als `<Teilpfad>.<Export>` bzw. `<Teilpfad>.<Tabelle>.<Schlüssel>`. */
async function exportedSchemas(): Promise<Map<string, z.ZodType>> {
  const schemas = new Map<string, z.ZodType>();
  for (const [subpath, file] of Object.entries(packageJson.exports)) {
    if (subpath === './fixtures' || subpath === './seeds') continue;
    const module = (await import(new URL(`../${file}`, import.meta.url).href)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(module)) {
      const prefix = `${subpath.slice(2)}.${name}`;
      if (value instanceof z.ZodType) schemas.set(prefix, value);
      else if (isSchemaTable(value)) for (const [key, schema] of Object.entries(value)) schemas.set(`${prefix}.${key}`, schema);
    }
  }
  return schemas;
}

function isSchemaTable(value: unknown): value is Record<string, z.ZodType> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entries = Object.values(value);
  return entries.length > 0 && entries.every((entry) => entry instanceof z.ZodType);
}

const registered = new Map<string, SchemaFixtures>(
  Object.entries(contractFixtures).flatMap(([area, fixtures]) =>
    Object.entries(fixtures).map(([name, entry]) => [`${area}.${name}`, entry] as const),
  ),
);

describe('Fixture-Register', () => {
  it('enthält genau die exportierten Schemas', async () => {
    const exported = await exportedSchemas();

    expect([...registered.keys()].sort()).toEqual([...exported.keys()].sort());
    for (const [name, schema] of exported) expect(registered.get(name)?.schema, name).toBe(schema);
  });

  it.each([...registered])('%s hat mindestens ein gültiges und ein ungültiges Fixture', (_, entry) => {
    expect(Object.keys(entry.valid).length).toBeGreaterThan(0);
    expect(Object.keys(entry.invalid).length).toBeGreaterThan(0);
  });
});

describe.each(fixtureCases())('$name', ({ schema, value, valid }: FixtureCase) => {
  it('übersteht JSON unverändert', () => {
    expect(JSON.parse(JSON.stringify(value))).toStrictEqual(value);
  });

  if (valid) {
    it('ist gültig und wird unverändert übernommen', () => {
      const result = schema.safeParse(value);
      expect(result.error?.issues).toBeUndefined();
      expect(result.data).toStrictEqual(value);
    });
  } else {
    it('scheitert am Schema', () => {
      expect(schema.safeParse(value).success).toBe(false);
    });
  }
});
