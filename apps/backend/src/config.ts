import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import type { AuthSettings } from './auth/auth-module.ts';
import { MIN_INVITE_CODE_SECRET_LENGTH, type InvitationSettings } from './coupling/invite-codes.ts';
import type { DatabaseSettings } from './database.ts';
import {
  mealVisionDefaults,
  mealVisionEfforts,
  mealVisionPrompts,
  type MealVisionEffort,
  type MealVisionPromptVersion,
  type MealVisionSettings,
} from './nutrition/meal-vision-settings.ts';

export type BackendConfig = {
  port: number;
  database: DatabaseSettings;
  auth: AuthSettings;
  invitations: InvitationSettings;
  /** Verzeichnis der Fotoentwürfe, außerhalb der App und jedes öffentlichen Pfads. */
  photoStorageDirectory: string;
  /**
   * Modellaufruf der Fotoanalyse; `null` ohne `ANTHROPIC_API_KEY_FILE`. Das produktive Backend startet
   * dann nicht (`productionMealVisionAnalyzer`); das Development-Backend nutzt ohnehin seinen Fake.
   */
  mealVision: MealVisionSettings | null;
  /**
   * Expo Push: `accessToken` nur, wenn die erweiterte Push-Sicherheit aktiviert ist
   * (https://docs.expo.dev/push-notifications/sending-notifications/#additional-security). Es kommt als
   * Docker-Compose-Secret über `EXPO_ACCESS_TOKEN_FILE`; ohne Variable oder mit leerer Datei sendet das
   * Backend ohne Token.
   */
  expoPush: { accessToken: string | null };
};

/** Better Auth signiert damit Sitzungstokens; `openssl rand -hex 32` ergibt 64 Zeichen. */
const MIN_AUTH_SECRET_LENGTH = 32;

/**
 * Liest die Konfiguration aus der Umgebung. Geheimnisse kommen ausschließlich aus
 * Dateien (`*_FILE`, in Docker Compose als Secret eingebunden), nie aus Variablen,
 * Git oder dem Container-Image (#22). Fehler nennen nur Variablennamen, nie Werte.
 */
export function readConfig(environment: NodeJS.ProcessEnv): BackendConfig {
  const problems: string[] = [];
  const required = (name: string) => {
    const value = environment[name];
    if (value === undefined || value === '') problems.push(`${name} fehlt`);
    return value ?? '';
  };
  const port = (name: string) => {
    const raw = required(name);
    const value = Number(raw);
    if (raw !== '' && (!Number.isInteger(value) || value < 1 || value > 65_535)) problems.push(`${name} ist kein Port`);
    return value;
  };
  const secret = (name: string) => {
    const file = required(name);
    if (file === '') return '';
    const value = readFileSync(file, 'utf8').trim();
    if (value === '') problems.push(`Secret-Datei aus ${name} ist leer`);
    return value;
  };

  /** Secret, das fehlen darf: ohne Variable oder mit leerer Datei `null`. */
  const optionalSecret = (name: string) => {
    const file = environment[name];
    if (file === undefined || file === '') return null;
    const value = readFileSync(file, 'utf8').trim();
    return value === '' ? null : value;
  };

  const url = (name: string) => {
    const raw = required(name);
    if (raw !== '' && !URL.canParse(raw)) problems.push(`${name} ist keine URL`);
    return raw;
  };
  const absolutePath = (name: string) => {
    const raw = required(name);
    if (raw !== '' && !isAbsolute(raw)) problems.push(`${name} ist kein absoluter Pfad`);
    return raw;
  };
  /** Optionale Einstellung mit Startwert; erlaubt nur die genannten Werte. */
  const oneOf = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
    const raw = environment[name];
    if (raw === undefined || raw === '') return fallback;
    if (!(allowed as readonly string[]).includes(raw)) problems.push(`${name} ist keiner von ${allowed.join(', ')}`);
    return raw as T;
  };
  const mealVisionSettings = (): MealVisionSettings | null => {
    const model = environment.MEAL_VISION_MODEL || mealVisionDefaults.model;
    const effort = oneOf<MealVisionEffort>('MEAL_VISION_EFFORT', mealVisionEfforts, mealVisionDefaults.effort);
    const promptVersion = oneOf<MealVisionPromptVersion>(
      'MEAL_VISION_PROMPT_VERSION',
      Object.keys(mealVisionPrompts) as MealVisionPromptVersion[],
      mealVisionDefaults.promptVersion,
    );
    const rawMaxTokens = environment.MEAL_VISION_MAX_TOKENS;
    const maxTokens = rawMaxTokens === undefined || rawMaxTokens === '' ? mealVisionDefaults.maxTokens : Number(rawMaxTokens);
    if (!Number.isInteger(maxTokens) || maxTokens < 1) problems.push('MEAL_VISION_MAX_TOKENS ist keine positive ganze Zahl');
    if ((environment.ANTHROPIC_API_KEY_FILE ?? '') === '') return null;
    const apiKey = secret('ANTHROPIC_API_KEY_FILE');
    return { apiKey, model, effort, promptVersion, maxTokens };
  };

  const authSecret = secret('BETTER_AUTH_SECRET_FILE');
  if (authSecret !== '' && authSecret.length < MIN_AUTH_SECRET_LENGTH) {
    problems.push(`Secret aus BETTER_AUTH_SECRET_FILE ist kürzer als ${MIN_AUTH_SECRET_LENGTH} Zeichen`);
  }

  const inviteCodeSecret = secret('INVITE_CODE_SECRET_FILE');
  if (inviteCodeSecret !== '' && inviteCodeSecret.length < MIN_INVITE_CODE_SECRET_LENGTH) {
    problems.push(`Secret aus INVITE_CODE_SECRET_FILE ist kürzer als ${MIN_INVITE_CODE_SECRET_LENGTH} Zeichen`);
  }

  const config: BackendConfig = {
    port: port('PORT'),
    database: {
      host: required('DATABASE_HOST'),
      port: port('DATABASE_PORT'),
      name: required('DATABASE_NAME'),
      user: required('DATABASE_USER'),
      password: secret('DATABASE_PASSWORD_FILE'),
    },
    auth: {
      secret: authSecret,
      baseUrl: url('AUTH_BASE_URL'),
      // Optional: Ohne Reverse Proxy (lokale Entwicklung) bleibt die Liste leer.
      trustedProxies: (environment.AUTH_TRUSTED_PROXIES ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ''),
    },
    invitations: { codeSecret: inviteCodeSecret },
    photoStorageDirectory: absolutePath('PHOTO_STORAGE_DIR'),
    mealVision: mealVisionSettings(),
    expoPush: { accessToken: optionalSecret('EXPO_ACCESS_TOKEN_FILE') },
  };
  if (problems.length > 0) throw new Error(`Ungültige Backend-Konfiguration: ${problems.join(', ')}`);
  return config;
}
