import { readFileSync } from 'node:fs';

import type { DatabaseSettings } from './database.ts';

export type BackendConfig = {
  port: number;
  database: DatabaseSettings;
};

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

  const config: BackendConfig = {
    port: port('PORT'),
    database: {
      host: required('DATABASE_HOST'),
      port: port('DATABASE_PORT'),
      name: required('DATABASE_NAME'),
      user: required('DATABASE_USER'),
      password: secret('DATABASE_PASSWORD_FILE'),
    },
  };
  if (problems.length > 0) throw new Error(`Ungültige Backend-Konfiguration: ${problems.join(', ')}`);
  return config;
}
