import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it, onTestFinished } from 'vitest';

import { readConfig } from '../src/config.ts';

async function secretFile(content: string, name = 'postgres_password') {
  const directory = await mkdtemp(path.join(tmpdir(), 'abnehm-config-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, name);
  await writeFile(file, content);
  return file;
}

const authSecret = 'a'.repeat(64);
const authSecretDirectory = await mkdtemp(path.join(tmpdir(), 'abnehm-config-'));
const authSecretFile = path.join(authSecretDirectory, 'better_auth_secret');
await writeFile(authSecretFile, `${authSecret}\n`);
afterAll(() => rm(authSecretDirectory, { recursive: true, force: true }));

const baseEnvironment = {
  PORT: '8787',
  DATABASE_HOST: 'postgres',
  DATABASE_PORT: '5432',
  DATABASE_NAME: 'abnehm',
  DATABASE_USER: 'abnehm',
  BETTER_AUTH_SECRET_FILE: authSecretFile,
  AUTH_BASE_URL: 'http://localhost:8787',
};

describe('readConfig', () => {
  it('liest das Datenbankpasswort aus der Secret-Datei', async () => {
    const file = await secretFile('geheim-123\n');

    const config = readConfig({ ...baseEnvironment, DATABASE_PASSWORD_FILE: file });

    expect(config).toEqual({
      port: 8787,
      database: { host: 'postgres', port: 5432, name: 'abnehm', user: 'abnehm', password: 'geheim-123' },
      auth: { secret: authSecret, baseUrl: 'http://localhost:8787', trustedProxies: [] },
    });
  });

  it('liest das Better-Auth-Secret aus der Secret-Datei und verlangt mindestens 32 Zeichen', async () => {
    const file = await secretFile('geheim-123');
    const shortAuthSecret = await secretFile('zu-kurz', 'better_auth_secret');

    expect(() => readConfig({ ...baseEnvironment, DATABASE_PASSWORD_FILE: file, BETTER_AUTH_SECRET_FILE: shortAuthSecret })).toThrow(
      /BETTER_AUTH_SECRET_FILE ist kürzer als 32 Zeichen/,
    );
    expect(() => readConfig({ ...baseEnvironment, DATABASE_PASSWORD_FILE: file, BETTER_AUTH_SECRET_FILE: shortAuthSecret })).not.toThrow(/zu-kurz/);
    expect(() => readConfig({ ...baseEnvironment, DATABASE_PASSWORD_FILE: file, BETTER_AUTH_SECRET_FILE: undefined, BETTER_AUTH_SECRET: authSecret })).toThrow(
      /BETTER_AUTH_SECRET_FILE fehlt/,
    );
  });

  it('liest vertrauenswürdige Proxys als Liste', async () => {
    const file = await secretFile('geheim-123');

    const config = readConfig({ ...baseEnvironment, DATABASE_PASSWORD_FILE: file, AUTH_TRUSTED_PROXIES: '172.18.0.2, 10.0.0.0/24' });

    expect(config.auth.trustedProxies).toEqual(['172.18.0.2', '10.0.0.0/24']);
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
