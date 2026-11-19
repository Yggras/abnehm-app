import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it, onTestFinished } from 'vitest';

import { readConfig } from '../src/config.ts';
import { productionMealVisionAnalyzer } from '../src/nutrition/claude-meal-vision.ts';

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
const inviteCodeSecret = 'b'.repeat(64);
const inviteCodeSecretFile = path.join(authSecretDirectory, 'invite_code_secret');
await writeFile(inviteCodeSecretFile, `${inviteCodeSecret}\n`);
afterAll(() => rm(authSecretDirectory, { recursive: true, force: true }));

const baseEnvironment = {
  PORT: '8787',
  DATABASE_HOST: 'postgres',
  DATABASE_PORT: '5432',
  DATABASE_NAME: 'abnehm',
  DATABASE_USER: 'abnehm',
  BETTER_AUTH_SECRET_FILE: authSecretFile,
  INVITE_CODE_SECRET_FILE: inviteCodeSecretFile,
  AUTH_BASE_URL: 'http://localhost:8787',
  PHOTO_STORAGE_DIR: '/var/lib/abnehm/fotos',
};

describe('readConfig', () => {
  it('liest das Datenbankpasswort aus der Secret-Datei', async () => {
    const file = await secretFile('geheim-123\n');

    const config = readConfig({ ...baseEnvironment, DATABASE_PASSWORD_FILE: file });

    expect(config).toEqual({
      port: 8787,
      database: { host: 'postgres', port: 5432, name: 'abnehm', user: 'abnehm', password: 'geheim-123' },
      auth: { secret: authSecret, baseUrl: 'http://localhost:8787', trustedProxies: [] },
      invitations: { codeSecret: inviteCodeSecret },
      photoStorageDirectory: '/var/lib/abnehm/fotos',
      mealVision: null,
      expoPush: { accessToken: null },
    });
  });

  it('liest das optionale Expo-Zugriffstoken aus der Secret-Datei; leer oder ohne Variable sendet das Backend ohne', async () => {
    const file = await secretFile('geheim-123');
    const token = await secretFile('expo-token-xyz\n', 'expo_access_token');
    const empty = await secretFile('', 'expo_access_token');

    expect(readConfig({ ...baseEnvironment, DATABASE_PASSWORD_FILE: file, EXPO_ACCESS_TOKEN_FILE: token }).expoPush).toEqual({ accessToken: 'expo-token-xyz' });
    expect(readConfig({ ...baseEnvironment, DATABASE_PASSWORD_FILE: file, EXPO_ACCESS_TOKEN_FILE: empty }).expoPush).toEqual({ accessToken: null });
    expect(readConfig({ ...baseEnvironment, DATABASE_PASSWORD_FILE: file }).expoPush).toEqual({ accessToken: null });
    // Das Token selbst steht nur in der Datei, nie in einer Variablen.
    expect(readConfig({ ...baseEnvironment, DATABASE_PASSWORD_FILE: file, EXPO_ACCESS_TOKEN: 'aus-variable' }).expoPush).toEqual({ accessToken: null });
  });

  it('liest das Einladungs-Secret aus der Secret-Datei und verlangt mindestens 32 Zeichen', async () => {
    const file = await secretFile('geheim-123');
    const shortSecret = await secretFile('zu-kurz', 'invite_code_secret');

    expect(() => readConfig({ ...baseEnvironment, DATABASE_PASSWORD_FILE: file, INVITE_CODE_SECRET_FILE: shortSecret })).toThrow(
      /INVITE_CODE_SECRET_FILE ist kürzer als 32 Zeichen/,
    );
    expect(() => readConfig({ ...baseEnvironment, DATABASE_PASSWORD_FILE: file, INVITE_CODE_SECRET_FILE: undefined })).toThrow(
      /INVITE_CODE_SECRET_FILE fehlt/,
    );
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

  it('verlangt ein absolutes Verzeichnis für die Fotoentwürfe', async () => {
    const file = await secretFile('geheim-123');

    expect(() => readConfig({ ...baseEnvironment, DATABASE_PASSWORD_FILE: file, PHOTO_STORAGE_DIR: undefined })).toThrow(/PHOTO_STORAGE_DIR fehlt/);
    expect(() => readConfig({ ...baseEnvironment, DATABASE_PASSWORD_FILE: file, PHOTO_STORAGE_DIR: 'fotos' })).toThrow(/PHOTO_STORAGE_DIR ist kein absoluter Pfad/);
  });
});

describe('readConfig: Fotoanalyse', () => {
  it('liest den Schlüssel aus der Secret-Datei und startet mit Sonnet 5.5, Effort medium, Prompt v1 und 16.000 Tokens', async () => {
    const file = await secretFile('geheim-123');
    const apiKey = await secretFile('sk-ant-test\n', 'anthropic_api_key');

    const config = readConfig({ ...baseEnvironment, DATABASE_PASSWORD_FILE: file, ANTHROPIC_API_KEY_FILE: apiKey });

    expect(config.mealVision).toEqual({ apiKey: 'sk-ant-test', model: 'claude-sonnet-5-5', effort: 'medium', promptVersion: 'v1', maxTokens: 16_000 });
  });

  it('nimmt Modell, Effort, Prompt-Version und max_tokens aus der Umgebung', async () => {
    const file = await secretFile('geheim-123');
    const apiKey = await secretFile('sk-ant-test', 'anthropic_api_key');

    const config = readConfig({
      ...baseEnvironment,
      DATABASE_PASSWORD_FILE: file,
      ANTHROPIC_API_KEY_FILE: apiKey,
      MEAL_VISION_MODEL: 'claude-haiku-5-5',
      MEAL_VISION_EFFORT: 'low',
      MEAL_VISION_PROMPT_VERSION: 'v1',
      MEAL_VISION_MAX_TOKENS: '8000',
    });

    expect(config.mealVision).toEqual({ apiKey: 'sk-ant-test', model: 'claude-haiku-5-5', effort: 'low', promptVersion: 'v1', maxTokens: 8_000 });
  });

  it('lehnt unbekannte Effort-Stufen, Prompt-Versionen und max_tokens ab', async () => {
    const file = await secretFile('geheim-123');
    const apiKey = await secretFile('sk-ant-test', 'anthropic_api_key');
    const environment = { ...baseEnvironment, DATABASE_PASSWORD_FILE: file, ANTHROPIC_API_KEY_FILE: apiKey };

    expect(() => readConfig({ ...environment, MEAL_VISION_EFFORT: 'mittel' })).toThrow(/MEAL_VISION_EFFORT/);
    expect(() => readConfig({ ...environment, MEAL_VISION_PROMPT_VERSION: 'v9' })).toThrow(/MEAL_VISION_PROMPT_VERSION/);
    expect(() => readConfig({ ...environment, MEAL_VISION_MAX_TOKENS: '0' })).toThrow(/MEAL_VISION_MAX_TOKENS/);
  });

  it('nimmt den Schlüssel nicht aus einer Umgebungsvariablen an', async () => {
    const file = await secretFile('geheim-123');

    expect(readConfig({ ...baseEnvironment, DATABASE_PASSWORD_FILE: file, ANTHROPIC_API_KEY: 'sk-ant-test' }).mealVision).toBeNull();
  });

  it('das produktive Backend startet ohne Schlüssel nicht; keine Einstellung wählt einen Fake', async () => {
    const file = await secretFile('geheim-123');

    const config = readConfig({ ...baseEnvironment, DATABASE_PASSWORD_FILE: file, MEAL_VISION_ANALYZER: 'fake', MEAL_VISION_MODEL: 'fake' });

    expect(() => productionMealVisionAnalyzer(config.mealVision)).toThrow(/ANTHROPIC_API_KEY_FILE fehlt/);
  });
});
