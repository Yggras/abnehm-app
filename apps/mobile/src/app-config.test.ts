import type { ConfigContext } from 'expo/config';
import type { ExportedConfig } from 'expo/config-plugins';

import createConfig from '../app.config';

const original = {
  variant: process.env.APP_VARIANT,
  e2e: process.env.EXPO_PUBLIC_E2E_BUILD,
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
};

function setEnv(name: 'APP_VARIANT' | 'EXPO_PUBLIC_E2E_BUILD' | 'EXPO_PUBLIC_API_URL', value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  setEnv('APP_VARIANT', original.variant);
  setEnv('EXPO_PUBLIC_E2E_BUILD', original.e2e);
  setEnv('EXPO_PUBLIC_API_URL', original.apiUrl);
});

function configFor(variant: string | undefined, e2eBuild?: string) {
  setEnv('APP_VARIANT', variant);
  setEnv('EXPO_PUBLIC_E2E_BUILD', e2eBuild);
  return createConfig({ config: {} } as ConfigContext);
}

/** Wendet den Android-Manifest-Mod der Konfiguration auf ein leeres Manifest an. */
async function androidApplicationAttributes(config: ExportedConfig): Promise<Record<string, string>> {
  const mod = config.mods?.android?.manifest;
  if (mod === undefined) return {};
  const result = await mod({ modRequest: {}, modResults: { manifest: { application: [{ $: {} }] } } } as never);
  return (result as unknown as { modResults: { manifest: { application: [{ $: Record<string, string> }] } } }).modResults.manifest.application[0].$;
}

test('erlaubt lokales HTTP (ATS) nur im Development- und im E2E-Build', () => {
  for (const config of [configFor('development'), configFor('e2e', 'true')]) {
    expect(config.ios?.infoPlist?.NSAppTransportSecurity).toEqual({
      NSAllowsArbitraryLoads: false,
      NSAllowsLocalNetworking: true,
    });
  }
});

test.each([undefined, 'production', 'preview', 'Development', 'E2E'])(
  'baut ohne ausdrückliche Development- oder E2E-Variante (%s) ohne Netzwerkausnahme',
  async (variant) => {
    const config = configFor(variant);
    expect(config.ios?.infoPlist?.NSAppTransportSecurity).toEqual({ NSAllowsArbitraryLoads: false });
    expect(await androidApplicationAttributes(config)).toEqual({});
  },
);

test('der E2E-Build erlaubt Klartext-HTTP zum lokalen Backend auch als Android-Release-Build', async () => {
  expect(await androidApplicationAttributes(configFor('e2e', 'true'))).toEqual({ 'android:usesCleartextTraffic': 'true' });
  expect(await androidApplicationAttributes(configFor('development'))).toEqual({});
});

test('Development-, E2E- und Produktionsbuild lassen sich nebeneinander installieren', () => {
  const builds = [configFor('development'), configFor('e2e', 'true'), configFor(undefined)];

  expect(new Set(builds.map((config) => config.ios?.bundleIdentifier)).size).toBe(3);
  expect(new Set(builds.map((config) => config.android?.package)).size).toBe(3);
  expect(new Set(builds.map((config) => config.scheme)).size).toBe(3);
});

test('die Testfähigkeiten lassen sich nur im E2E-Build per Bündel-Schalter einschalten', () => {
  // Release-Sperre (#114): ein Produktions- oder Development-Build mit dem Schalter bricht ab.
  for (const variant of [undefined, 'production', 'development']) {
    for (const value of ['true', '1', 'false']) expect(() => configFor(variant, value)).toThrow('nur im E2E-Build');
  }
  // Umgekehrt entsteht der E2E-Build nie ohne den Schalter, den das Bundle prüft.
  for (const value of [undefined, '1', 'false']) expect(() => configFor('e2e', value)).toThrow('EXPO_PUBLIC_E2E_BUILD=true');
});

test('der Produktionsbuild spricht das Backend nur über HTTPS an (Produktiv-Gate #115)', () => {
  for (const url of ['http://192.168.178.20:8787', 'http://localhost:8787', 'ftp://example.test', 'keine-url']) {
    setEnv('EXPO_PUBLIC_API_URL', url);
    expect(() => configFor(undefined)).toThrow('nur über https://');
    expect(() => configFor('production')).toThrow('nur über https://');
  }
  setEnv('EXPO_PUBLIC_API_URL', 'https://heimserver.tail0000.ts.net');
  expect(configFor(undefined).ios?.bundleIdentifier).toBe('de.yggras.abnehmapp');
  // Ohne Adresse bleibt der Export der Release-Sperren möglich; zur Laufzeit fehlt sie dann laut (src/backend/client.ts).
  setEnv('EXPO_PUBLIC_API_URL', undefined);
  expect(() => configFor(undefined)).not.toThrow();
});

test('Development- und E2E-Build dürfen das lokale Backend per HTTP ansprechen', () => {
  setEnv('EXPO_PUBLIC_API_URL', 'http://192.168.178.20:8788');
  expect(() => configFor('development')).not.toThrow();
  expect(() => configFor('e2e', 'true')).not.toThrow();
});
