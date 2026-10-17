import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { readConfig } from '../src/config.ts';

async function secretFile(content: string) {
  const directory = await mkdtemp(path.join(tmpdir(), 'abnehm-config-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'postgres_password');
  await writeFile(file, content);
  return file;
}

const baseEnvironment = {
  PORT: '8787',
  DATABASE_HOST: 'postgres',
  DATABASE_PORT: '5432',
  DATABASE_NAME: 'abnehm',
  DATABASE_USER: 'abnehm',
};

describe('readConfig', () => {
  it('liest das Datenbankpasswort aus der Secret-Datei', async () => {
    const file = await secretFile('geheim-123\n');

    const config = readConfig({ ...baseEnvironment, DATABASE_PASSWORD_FILE: file });

    expect(config).toEqual({
      port: 8787,
      database: { host: 'postgres', port: 5432, database: 'abnehm', user: 'abnehm', password: 'geheim-123' },
    });
  });

  it('nimmt kein Passwort aus einer Umgebungsvariablen an', () => {
    expect(() => readConfig({ ...baseEnvironment, DATABASE_PASSWORD: 'geheim-123' })).toThrow(
      /DATABASE_PASSWORD_FILE/,
    );
  });

  it('lehnt eine leere Secret-Datei ab', async () => {
    const file = await secretFile('\n');

    expect(() => readConfig({ ...baseEnvironment, DATABASE_PASSWORD_FILE: file })).toThrow(/leer/);
  });

  it('nennt fehlende Variablen, ohne Werte auszugeben', async () => {
    const file = await secretFile('geheim-123');

    expect(() => readConfig({ DATABASE_PASSWORD_FILE: file })).toThrow(/DATABASE_HOST/);
    expect(() => readConfig({ DATABASE_PASSWORD_FILE: file })).not.toThrow(/geheim/);
  });
});
