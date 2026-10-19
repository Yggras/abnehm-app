import { readFileSync } from 'node:fs';

import type { AuthSettings } from './auth/auth-module.ts';
import type { InvitationSettings } from './backend.ts';
import { MIN_INVITE_CODE_SECRET_LENGTH } from './coupling/invite-codes.ts';
import type { DatabaseSettings } from './database.ts';

export type BackendConfig = {
  port: number;
  database: DatabaseSettings;
  auth: AuthSettings;
  invitations: InvitationSettings;
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

  const url = (name: string) => {
    const raw = required(name);
    if (raw !== '' && !URL.canParse(raw)) problems.push(`${name} ist keine URL`);
    return raw;
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
  };
  if (problems.length > 0) throw new Error(`Ungültige Backend-Konfiguration: ${problems.join(', ')}`);
  return config;
}
