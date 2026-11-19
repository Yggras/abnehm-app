import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { beforeAll, describe, expect, it } from 'vitest';

// Produktiv-Gate (#115): Die Grenzen des Produktivbetriebs, wie Docker Compose sie tatsächlich auflöst.
// Postgres ohne Port, das Backend nur auf 127.0.0.1 (HTTPS davor liefert `tailscale serve`), Secrets nur als
// Dateien außerhalb des Repos, das Image ohne Testfähigkeiten. Ablauf und Nachweise: docs/betrieb.md.

const root = fileURLToPath(new URL('..', import.meta.url));
const composeFile = join(root, 'compose.prod.yaml');
const run = promisify(execFile);

type Port = { host_ip?: string; published?: string; target: number };
type Service = {
  ports?: Port[];
  network_mode?: string;
  environment?: Record<string, string>;
  secrets?: { source: string; target?: string }[];
  build?: { target?: string };
  networks?: Record<string, unknown>;
};
type ComposeConfig = {
  name: string;
  services: { backend: Service; postgres: Service };
  secrets: Record<string, { file: string }>;
  networks: Record<string, { ipam?: { config?: { subnet: string; gateway: string }[] } }>;
};

const productionUrl = 'https://heimserver.tail0000.ts.net';
const secretsDir = '/Users/beispiel/Library/Application Support/abnehm-app/produktion/secrets';

async function composeConfig(environment: Record<string, string>): Promise<ComposeConfig> {
  const { stdout } = await run('docker', ['compose', '--file', composeFile, 'config', '--format', 'json'], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...environment },
  });
  return JSON.parse(stdout) as ComposeConfig;
}

describe('compose.prod.yaml', () => {
  let config: ComposeConfig;
  beforeAll(async () => {
    config = await composeConfig({ ABNEHM_PROD_URL: productionUrl, ABNEHM_PROD_SECRETS_DIR: secretsDir });
  });

  it('ist ein eigener Stack neben Entwicklung und E2E', () => {
    expect(config.name).toBe('abnehm-prod');
    expect(Object.keys(config.services).sort()).toEqual(['backend', 'postgres']);
  });

  it('veröffentlicht Postgres nicht und das Backend nur auf 127.0.0.1', () => {
    const { postgres, backend } = config.services;
    expect(postgres.ports ?? []).toEqual([]);
    for (const service of Object.values(config.services)) expect(service.network_mode).toBeUndefined();
    expect(backend.ports).toHaveLength(1);
    expect(backend.ports?.[0]).toMatchObject({ host_ip: '127.0.0.1', published: '8790', target: 8787 });
  });

  it('baut das Backend ohne Testfähigkeiten', () => {
    expect(config.services.backend.build?.target).toBe('production');
  });

  it('übergibt Geheimnisse nur als Dateien von außerhalb des Repos', () => {
    for (const [name, service] of Object.entries(config.services)) {
      // Compose normalisiert das Ziel zu einem absoluten Pfad unter /run/secrets/.
      const mounted = new Set((service.secrets ?? []).map((secret) => secret.target ?? `/run/secrets/${secret.source}`));
      for (const [key, value] of Object.entries(service.environment ?? {})) {
        if (/SECRET|PASSWORD|KEY|TOKEN/.test(key)) {
          expect(key, `${name}: ${key}`).toMatch(/_FILE$/);
          expect(mounted.has(value), `${name}: ${key} zeigt auf ein eingebundenes Secret`).toBe(true);
        }
      }
    }
    for (const secret of Object.values(config.secrets)) {
      expect(secret.file.startsWith(`${secretsDir}/`)).toBe(true);
      expect(secret.file.startsWith(root)).toBe(false);
    }
    // Jedes Secret erhält nur der Dienst, der es braucht.
    expect(config.services.postgres.secrets?.map((secret) => secret.source)).toEqual(['postgres_password']);
  });

  it('bindet das optionale Zugriffstoken der erweiterten Expo-Push-Sicherheit als Secret ein (#142)', () => {
    const { backend } = config.services;
    expect(backend.environment?.EXPO_ACCESS_TOKEN_FILE).toBe('/run/secrets/expo_access_token');
    expect(backend.secrets?.map((secret) => secret.source)).toContain('expo_access_token');
    expect(config.secrets.expo_access_token?.file).toBe(`${secretsDir}/expo_access_token`);
  });

  it('nennt die HTTPS-Adresse und vertraut nur dem Gateway des eigenen Netzes', () => {
    const environment = config.services.backend.environment ?? {};
    expect(environment.AUTH_BASE_URL).toBe(productionUrl);
    const gateways = Object.values(config.networks).flatMap((network) => network.ipam?.config ?? []).map((entry) => entry.gateway);
    expect(gateways).toEqual([environment.AUTH_TRUSTED_PROXIES]);
    expect(Object.keys(config.services.backend.networks ?? {})).toEqual(Object.keys(config.networks));
  });

  it('startet nicht ohne HTTPS-Adresse oder Secret-Verzeichnis', async () => {
    await expect(composeConfig({ ABNEHM_PROD_SECRETS_DIR: secretsDir })).rejects.toThrow('ABNEHM_PROD_URL');
    await expect(composeConfig({ ABNEHM_PROD_URL: productionUrl })).rejects.toThrow('ABNEHM_PROD_SECRETS_DIR');
  });
});
