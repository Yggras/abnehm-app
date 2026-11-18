import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fakeMealVisionMarker } from '../apps/backend/dev/meal-vision/fake-analyzer.ts';
import { belongsTo, deepLinkHandler, testCapabilities, testCapabilityRoots, type TestCapability } from './test-capabilities.ts';

// Release-Sperren (Spezifikation 0, Abschnitt 12 und Testing Decisions; #112): Für jede registrierte
// Testfähigkeit enthalten weder das Produktions-Image des Backends noch das Produktions-Bundle der App
// ihre Module, Einstiege oder Marker. Nichts davon lässt sich per Konfiguration aktivieren, weil der
// Code im Artefakt gar nicht vorkommt und das Backend keinen Code dynamisch nachlädt. Die Gegenprobe
// an den Development-Artefakten zeigt, dass die Prüfung die Fähigkeit tatsächlich fände.
//
// Backend: Node führt die Quellen ohne Build-Schritt aus; das Image enthält genau, was die
// COPY-Anweisungen der Stage kopieren, abzüglich `.dockerignore`. App: echter `expo export` im
// Produktions- bzw. Development-Modus, geprüft an Bundle und Source Maps.

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function filesBelow(path: string): string[] {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return [path];
  return readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)));
}

const isTestFile = (file: string) => /\.test\.tsx?$/.test(file);

// Backend-Image ------------------------------------------------------------------------------------

/** `.dockerignore` als Prüffunktion; unterstützt die dort genutzten Muster (`**`, `*`, Ordner mit `/`). */
function dockerIgnore(): (file: string) => boolean {
  const patterns = read('.dockerignore')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  const expressions = patterns.map((pattern) => {
    const directory = pattern.endsWith('/');
    const body = pattern
      .replace(/\/$/, '')
      .split('**/')
      .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
      .join('(?:.*/)?');
    return new RegExp(`^${body}${directory ? '/' : '(?:/|$)'}`);
  });
  return (file) => expressions.some((expression) => expression.test(file));
}

/** COPY-Quellen einer Stage samt der Stages, auf denen sie aufbaut. */
function copiedSources(stage: string): string[] {
  const stages = new Map<string, { from: string; lines: string[] }>();
  let current: { from: string; lines: string[] } | null = null;
  for (const line of read('apps/backend/Dockerfile').split('\n')) {
    const from = /^FROM\s+(\S+)\s+AS\s+(\S+)/i.exec(line);
    if (from) {
      current = { from: from[1]!, lines: [] };
      stages.set(from[2]!, current);
    } else if (current !== null && /^(COPY|ADD)\b/i.test(line)) current.lines.push(line);
  }
  const sources: string[] = [];
  for (let name: string | undefined = stage; name !== undefined && stages.has(name); name = stages.get(name)!.from) {
    for (const line of stages.get(name)!.lines) {
      // Nur einfache Kopien aus dem Build-Kontext; alles andere könnte Unbekanntes ins Image holen.
      expect(line, `nicht unterstützte Anweisung: ${line}`).toMatch(/^COPY\s+(?!--)/);
      const parts = line.trim().split(/\s+/).slice(1, -1);
      sources.push(...parts);
    }
  }
  return sources;
}

function imageFiles(stage: 'production' | 'development'): string[] {
  const ignored = dockerIgnore();
  return copiedSources(stage)
    .flatMap(filesBelow)
    .filter((file) => !ignored(file));
}

/** Importierte Module einer Quelldatei: statisch, dynamisch und per `require`. */
function specifiers(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)['"]([^'"]+)['"]/g)].map((match) => match[1]!);
}

const packageModules: Readonly<Record<string, string>> = {
  '@abnehm/contracts/seeds': 'packages/contracts/seeds/',
  '@abnehm/clock/testing': 'packages/clock/src/testing.ts',
  '@abnehm/clock/conformance': 'packages/clock/src/conformance.ts',
};

/** Mögliche Repo-Pfade eines Imports, soweit er auf eigenen Code zeigt; auch ohne Dateiendung. */
function resolved(file: string, specifier: string): string[] {
  if (!specifier.startsWith('.')) return specifier in packageModules ? [packageModules[specifier]!] : [];
  const path = relative(root, join(root, file, '..', specifier));
  return [path, ...['.ts', '.tsx', '/index.ts', '/index.tsx'].map((suffix) => `${path}${suffix}`)];
}

// App-Bundle ---------------------------------------------------------------------------------------

type Bundle = { platform: string; js: string; sources: string[] };

const execFileAsync = promisify(execFile);
const exportDirectory = mkdtempSync(join(tmpdir(), 'abnehm-release-'));
/** Produktion, Development Build und E2E-Build (#114): ein Release-Bundle mit den Testfähigkeiten. */
type Artifact = 'production' | 'development' | 'e2e';
const bundles: Record<Artifact, Bundle[]> = { production: [], development: [], e2e: [] };

/** Umgebung des Bündelns je Artefakt, wie `scripts/e2e-build` sie für den E2E-Build setzt. */
function exportEnvironment(artifact: Artifact, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.EXPO_PUBLIC_E2E_BUILD;
  const variant = artifact === 'e2e' ? { APP_VARIANT: 'e2e', NODE_ENV: 'production', EXPO_PUBLIC_E2E_BUILD: 'true' } : { APP_VARIANT: artifact, NODE_ENV: artifact };
  return { ...environment, ...variant, ...extra };
}

async function runExport(artifact: Artifact, output: string, environment: NodeJS.ProcessEnv) {
  await execFileAsync(
    'npx',
    ['expo', 'export', '--platform', 'ios', '--platform', 'android', '--no-bytecode', '--source-maps', '--output-dir', output, ...(artifact === 'development' ? ['--dev'] : [])],
    // Wie ein Store-Build: Produktionsvariante, keine Entwicklungs-URL.
    { cwd: join(root, 'apps/mobile'), env: environment, maxBuffer: 64 * 1024 * 1024 },
  );
}

async function exportApp(artifact: Artifact): Promise<Bundle[]> {
  const output = join(exportDirectory, artifact);
  await runExport(artifact, output, exportEnvironment(artifact));
  return ['ios', 'android'].map((platform) => {
    const directory = join(output, '_expo/static/js', platform);
    const files = readdirSync(directory);
    const js = readFileSync(join(directory, files.find((name) => name.endsWith('.js'))!), 'utf8');
    const map = JSON.parse(readFileSync(join(directory, files.find((name) => name.endsWith('.js.map'))!), 'utf8')) as {
      sections: { map: { sources: string[] } }[];
    };
    return { platform, js, sources: map.sections.flatMap((section) => section.map.sources).map((source) => source.replace(/^\//, '')) };
  });
}

beforeAll(async () => {
  [bundles.production, bundles.development, bundles.e2e] = await Promise.all([exportApp('production'), exportApp('development'), exportApp('e2e')]);
}, 600_000);

afterAll(() => rmSync(exportDirectory, { recursive: true, force: true }));

// Prüfungen ----------------------------------------------------------------------------------------

describe('Registry der Testfähigkeiten', () => {
  it('jede Datei in den Ordnern der Testfähigkeiten gehört genau einer registrierten Fähigkeit', () => {
    const files = testCapabilityRoots.flatMap(filesBelow).filter((file) => !isTestFile(file));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      expect(testCapabilities.filter((capability) => belongsTo(file, capability.modules)).map(({ key }) => key), file).toHaveLength(1);
    }
  });

  it('jedes registrierte Modul existiert, jede Fähigkeit hat Module und Marker', () => {
    expect(new Set(testCapabilities.map(({ key }) => key)).size).toBe(testCapabilities.length);
    for (const capability of testCapabilities) {
      expect(capability.modules.length, capability.key).toBeGreaterThan(0);
      expect(capability.markers.length, capability.key).toBeGreaterThan(0);
      for (const module of capability.modules) expect(filesBelow(module.replace(/\/$/, '')).length, module).toBeGreaterThan(0);
    }
  });

  it('jeder registrierte Deep Link wird ausschließlich im Deep-Link-Modul der Testfähigkeiten angenommen', () => {
    const handler = read(deepLinkHandler);
    const paths = testCapabilities.flatMap(({ entries }) => entries.deepLinks ?? []);
    expect(paths.sort()).toEqual(['fehler', 'geraetetest', 'health', 'profil', 'seed', 'uhr']);
    for (const path of paths) expect(handler, path).toContain(`'${path}'`);
    expect(testCapabilities.some(({ modules }) => belongsTo(deepLinkHandler, modules))).toBe(true);
  });

  it('Gegenprobe: jeder Marker steht in einem Development-Artefakt, die Prüfung fände ihn also', () => {
    const developmentImage = imageFiles('development').map(read).join('\n');
    for (const { key, markers } of testCapabilities) {
      for (const marker of markers) {
        const found = developmentImage.includes(marker) || bundles.development.every((bundle) => bundle.js.includes(marker));
        expect(found, `${key}: ${marker}`).toBe(true);
      }
    }
  });
});

describe('Produktions-Image des Backends', () => {
  const production = imageFiles('production');

  it('ist die Standard-Stage und startet den produktiven Prozess', () => {
    const dockerfile = read('apps/backend/Dockerfile');
    expect(/FROM\s+\S+\s+AS\s+(\S+)[^]*$/i.exec(dockerfile.slice(dockerfile.lastIndexOf('FROM')))?.[1]).toBe('production');
    expect(dockerfile.slice(dockerfile.lastIndexOf('FROM'))).toContain('CMD ["node", "apps/backend/src/main.ts"]');
    expect(production).toContain('apps/backend/src/main.ts');
  });

  it('lädt keinen Code dynamisch nach, den eine Konfiguration aktivieren könnte', () => {
    for (const file of production.filter((path) => /\.[cm]?[jt]s$/.test(path))) {
      expect(read(file), file).not.toMatch(/(?<!typeof\s)\bimport\s*\(|\brequire\s*\(/);
    }
  });

  it('npm-Skripte im Image nennen kein Kommando einer Testfähigkeit', () => {
    const modules = testCapabilities.flatMap(({ modules: own }) => own);
    for (const file of production.filter((path) => path.endsWith('package.json'))) {
      const { scripts = {} } = JSON.parse(read(file)) as { scripts?: Record<string, string> };
      for (const command of Object.values(scripts)) expect(modules.some((module) => command.includes(module.replace(/^apps\/backend\//, ''))), `${file}: ${command}`).toBe(false);
    }
  });

  describe.each(testCapabilities.map((capability) => [capability.key, capability] as const))('%s', (_, capability: TestCapability) => {
    it('kopiert keine Datei der Fähigkeit', () => {
      expect(production.filter((file) => belongsTo(file, capability.modules))).toEqual([]);
    });

    it('kein Produktionscode importiert die Fähigkeit', () => {
      for (const file of production) {
        for (const specifier of specifiers(read(file))) {
          expect(resolved(file, specifier).some((target) => belongsTo(target, capability.modules)), `${file} → ${specifier}`).toBe(false);
        }
      }
    });

    it('enthält weder Route, Kommando noch Marker der Fähigkeit', () => {
      const routes = (capability.entries.backendRoutes ?? []).map((route) => route.split(' ')[1]!);
      const commands = (capability.entries.commands ?? []).map((command) => command.replace(/^apps\/backend\//, ''));
      for (const file of production) {
        const content = read(file);
        for (const marker of [...routes, ...commands, ...capability.markers]) expect(content.includes(marker), `${file}: ${marker}`).toBe(false);
      }
    });
  });

  it('Gegenprobe: das Development-Image enthält die Fähigkeiten des Backends', () => {
    const development = imageFiles('development');
    for (const module of [
      'apps/backend/dev/main.ts',
      'apps/backend/dev/seed/server-seed.ts',
      'apps/backend/dev/seed-command.ts',
      'apps/backend/dev/meal-vision/fake-analyzer.ts',
      'apps/backend/dev/server-clock.ts',
      'packages/contracts/seeds/index.ts',
      'packages/contracts/seeds/server-clock.ts',
    ]) {
      expect(development).toContain(module);
    }
    expect(read('apps/backend/Dockerfile')).toMatch(/AS development[^]*CMD \["node", "apps\/backend\/dev\/main\.ts"\]/);
  });
});

// Fake der Fotoanalyse (#161) ------------------------------------------------------------------------
//
// #112: „Spätere Tickets müssen neue Testfähigkeiten zentral registrieren und ihren eigenen negativen
// Produktionsartefakt-Test ergänzen.“ Die allgemeinen Prüfungen oben laufen für `fake-fotoanalyse` schon
// über die Registry; dieser Block belegt zusätzlich, dass das produktive Backend den Fake auch nicht über
// seine Konfiguration erreicht.

describe('Fake der Fotoanalyse (#161)', () => {
  const capability = testCapabilities.find(({ key }) => key === 'fake-fotoanalyse')!;
  const production = imageFiles('production');

  it('ist zentral registriert, mit Modul, Steuerroute und Marker', () => {
    expect(capability).toMatchObject({ modules: ['apps/backend/dev/meal-vision/'], entries: { backendRoutes: ['POST /dev/fotoanalyse'] } });
    expect(capability.markers).toEqual([fakeMealVisionMarker]);
  });

  it('das Produktions-Image enthält weder den Fake noch einen Verweis auf ihn, wohl aber den Claude-Adapter', () => {
    expect(production).toContain('apps/backend/src/nutrition/claude-meal-vision.ts');
    expect(production.filter((file) => belongsTo(file, capability.modules))).toEqual([]);
    for (const file of production.filter((path) => /\.[cm]?[jt]s$/.test(path))) {
      const content = read(file);
      for (const reference of ['fake-analyzer', 'createFakeMealVision', '/dev/fotoanalyse', ...capability.markers]) {
        expect(content.includes(reference), `${file}: ${reference}`).toBe(false);
      }
    }
  });

  it('der produktive Prozess startet ohne API-Schlüssel nicht, auch wenn die Umgebung einen Fake verlangt', async () => {
    // Vollständige Konfiguration bis auf den Schlüssel; die Prüfung scheitert vor jedem Datenbankzugriff.
    const secrets = mkdtempSync(join(tmpdir(), 'abnehm-release-secrets-'));
    try {
      for (const name of ['postgres_password', 'better_auth_secret', 'invite_code_secret']) writeFileSync(join(secrets, name), 'x'.repeat(64));
      const environment = {
        PATH: process.env.PATH,
        PORT: '8787',
        DATABASE_HOST: '127.0.0.1',
        DATABASE_PORT: '1',
        DATABASE_NAME: 'abnehm',
        DATABASE_USER: 'abnehm',
        DATABASE_PASSWORD_FILE: join(secrets, 'postgres_password'),
        BETTER_AUTH_SECRET_FILE: join(secrets, 'better_auth_secret'),
        INVITE_CODE_SECRET_FILE: join(secrets, 'invite_code_secret'),
        AUTH_BASE_URL: 'http://localhost:8787',
        PHOTO_STORAGE_DIR: join(secrets, 'fotos'),
        MEAL_VISION_ANALYZER: 'fake',
        MEAL_VISION_MODEL: 'fake',
      };
      const run = execFileAsync('node', ['apps/backend/src/main.ts'], { cwd: root, env: environment, timeout: 30_000 });
      const failure = (await run.then(() => null, (error: unknown) => error)) as { code?: number; stderr?: string } | null;
      expect(failure?.code).toBe(1);
      expect(failure?.stderr).toContain('Ungültige Backend-Konfiguration: ANTHROPIC_API_KEY_FILE fehlt');
    } finally {
      rmSync(secrets, { recursive: true, force: true });
    }
  }, 60_000);

  it('Gegenprobe: das Development-Image enthält den Fake', () => {
    expect(imageFiles('development')).toContain('apps/backend/dev/meal-vision/fake-analyzer.ts');
  });

  it('kein Modul der App erreicht den Fake', () => {
    for (const bundle of [...bundles.production, ...bundles.development, ...bundles.e2e]) {
      expect(bundle.sources.filter((source) => belongsTo(source, capability.modules)), bundle.platform).toEqual([]);
    }
  });
});

// Steuerbare Serveruhr (#271) ------------------------------------------------------------------------
//
// Die allgemeinen Prüfungen laufen für `serveruhr` über die Registry. Dieser Block belegt zusätzlich,
// dass das produktive Backend nur die Systemuhr kennt: Weder das Uhr-Paket noch ein anderer
// Produktionscode bringt eine steuerbare Uhr oder einen Weg dorthin mit.

describe('Steuerbare Serveruhr (#271)', () => {
  const capability = testCapabilities.find(({ key }) => key === 'serveruhr')!;
  const production = imageFiles('production');

  it('ist zentral registriert, mit Modulen, Steuerroute und Marker', () => {
    expect(capability).toMatchObject({
      modules: ['apps/backend/dev/server-clock.ts', 'apps/mobile/src/test-capabilities/server-clock.ts'],
      entries: { backendRoutes: ['POST /dev/uhr'] },
      markers: ['/dev/uhr'],
    });
  });

  it('das Produktions-Image enthält keine steuerbare Uhr: nur die Systemuhr aus dem Uhr-Paket', () => {
    expect(production.filter((file) => file.startsWith('packages/clock/'))).toEqual(['packages/clock/package.json', 'packages/clock/src/clock.ts', 'packages/clock/src/reading.ts']);
    for (const file of production.filter((path) => /\.[cm]?[jt]s$/.test(path))) {
      const content = read(file);
      for (const reference of ['server-clock', 'createServerClock', 'createTestClock', '/dev/uhr']) expect(content.includes(reference), `${file}: ${reference}`).toBe(false);
    }
    // Der produktive Prozess startet ohne Uhr; `createBackend` nimmt dann die Systemuhr.
    expect(read('apps/backend/src/main.ts')).toMatch(/runBackend\(\)/);
  });

  it('Gegenprobe: das Development-Image enthält die Serveruhr, und sein Prozess liest sie', () => {
    expect(imageFiles('development')).toContain('apps/backend/dev/server-clock.ts');
    expect(read('apps/backend/dev/main.ts')).toContain('clock: serverClock');
  });
});

// Health-Attrappe (#183) -------------------------------------------------------------------------------
//
// Die allgemeinen Prüfungen laufen für `health-attrappe` über die Registry. Dieser Block belegt zusätzlich,
// dass das Produktions-Bundle den Health-Import samt Plattform-Adapter enthält, aber weder die Attrappe noch
// ihren Link, und dass es keinen Schalter gibt, der sie dort einschaltet.

describe('Health-Attrappe (#183)', () => {
  const capability = testCapabilities.find(({ key }) => key === 'health-attrappe')!;
  const healthFakeMarker = 'health_attrappe';

  it('ist zentral registriert, mit Modulen, Link und Marker', () => {
    expect(read('apps/mobile/src/health/testing/fake-platform.ts')).toContain(`healthFakeMarker = '${healthFakeMarker}'`);
    expect(capability).toMatchObject({
      modules: ['apps/mobile/src/health/testing/', 'apps/mobile/src/test-capabilities/health.ts'],
      entries: { deepLinks: ['health'] },
      markers: [healthFakeMarker],
    });
  });

  it('das Produktions-Bundle enthält den Health-Import, aber weder Attrappe noch Szenarien noch Link', () => {
    for (const bundle of bundles.production) {
      expect(bundle.sources, bundle.platform).toEqual(expect.arrayContaining(['apps/mobile/src/health/health-import.ts', 'apps/mobile/src/health/platform.ts']));
      expect(bundle.sources.filter((source) => belongsTo(source, capability.modules)), bundle.platform).toEqual([]);
      for (const reference of [healthFakeMarker, 'token_verfallen', 'zwei_weckungen', 'Health-Attrappe']) {
        expect(bundle.js.includes(reference), `${bundle.platform}: ${reference}`).toBe(false);
      }
    }
  });

  it('Gegenprobe: Development- und E2E-Bundle enthalten die Attrappe samt Szenarien', () => {
    for (const bundle of [...bundles.development, ...bundles.e2e]) {
      expect(bundle.sources, bundle.platform).toEqual(expect.arrayContaining(['apps/mobile/src/health/testing/fake-platform.ts', 'apps/mobile/src/test-capabilities/health.ts']));
      for (const reference of [healthFakeMarker, 'token_verfallen', 'zwei_weckungen']) expect(bundle.js.includes(reference), `${bundle.platform}: ${reference}`).toBe(true);
    }
  });

  it('der Composition Root erreicht die Attrappe nur über die Grenze der Testfähigkeiten', () => {
    const root = read('apps/mobile/src/session/device-session.ts');
    expect(root).toContain('testCapabilities?.adapters.healthPlatform(devicePlatform) ?? devicePlatform');
    expect(root).not.toMatch(/fake-platform|test-capabilities\/health/);
  });
});

describe('Produktions-Bundle der App', () => {
  describe.each(testCapabilities.map((capability) => [capability.key, capability] as const))('%s', (_, capability: TestCapability) => {
    it('enthält kein Modul der Fähigkeit', () => {
      for (const bundle of bundles.production) {
        expect(bundle.sources.filter((source) => belongsTo(source, capability.modules)), bundle.platform).toEqual([]);
      }
    });

    it('enthält keinen Marker der Fähigkeit', () => {
      for (const bundle of bundles.production) {
        for (const marker of capability.markers) expect(bundle.js.includes(marker), `${bundle.platform}: ${marker}`).toBe(false);
      }
    });

    it.runIf((capability.entries.deepLinks ?? []).length > 0)('nimmt keinen Deep Link der Fähigkeit an', () => {
      for (const bundle of bundles.production) expect(bundle.sources, bundle.platform).not.toContain(deepLinkHandler);
      for (const bundle of [...bundles.development, ...bundles.e2e]) expect(bundle.sources, bundle.platform).toContain(deepLinkHandler);
    });
  });

  it('die Grenze selbst ist im Bundle und verweist auf nichts', () => {
    for (const bundle of bundles.production) {
      expect(bundle.sources).toContain('apps/mobile/src/build-capabilities.ts');
      expect(bundle.sources.filter((source) => testCapabilityRoots.some((rootPath) => source.startsWith(rootPath)))).toEqual([]);
    }
  });

  it.each(['development', 'e2e'] as const)('Gegenprobe: das %s-Bundle enthält jede Fähigkeit der App samt Markern', (artifact) => {
    const appCapabilities = testCapabilities.filter(({ modules }) => modules.some((module) => module.startsWith('apps/mobile/')));
    expect(appCapabilities.map(({ key }) => key).sort()).toEqual([
      'fehler-adapter', 'fixture-insel', 'geraetetest', 'health-attrappe', 'laufzeitprofile', 'seed', 'serveruhr', 'testgeruest', 'testuhr', 'transport-fehlermodus',
    ]);
    for (const bundle of bundles[artifact]) {
      for (const capability of appCapabilities) {
        expect(bundle.sources.some((source) => belongsTo(source, capability.modules)), `${bundle.platform}: ${capability.key}`).toBe(true);
      }
      for (const marker of appCapabilities.flatMap(({ markers }) => markers).filter((marker) => marker !== '@abnehm/clock/testing')) {
        expect(bundle.js.includes(marker), `${bundle.platform}: ${marker}`).toBe(true);
      }
    }
  });
});

// E2E-Build (#114) ---------------------------------------------------------------------------------
//
// Der E2E-Build ist ein Release-Binary: Metro bündelt ohne `__DEV__`, minifiziert und faltet
// Konstanten wie im Produktionsbuild. Nur `EXPO_PUBLIC_E2E_BUILD=true` unterscheidet ihn, und
// `app.config.ts` lässt den Schalter ausschließlich mit `APP_VARIANT=e2e` zu. Der Transport-Fehlermodus,
// der auf iOS Maestros `setAirplaneMode` ersetzt, existiert damit nur dort und im Development Build.

describe('E2E-Build der App', () => {
  it('ist ein minifiziertes Release-Bundle ohne Development-Code von React', () => {
    for (const bundle of bundles.e2e) {
      // Das Development-Bundle trägt Reacts Entwicklungsfassungen samt Warntexten, das Release-Bundle nicht.
      expect(bundle.sources.some((source) => source.includes('.development.js')), bundle.platform).toBe(false);
      expect(bundles.development.find(({ platform }) => platform === bundle.platform)!.sources.some((source) => source.includes('.development.js'))).toBe(true);
    }
  });

  it('Transport-Fehlermodus: im E2E-Bundle vorhanden, im Produktions-Bundle weder Modul noch Marker', () => {
    const mode = testCapabilities.find(({ key }) => key === 'transport-fehlermodus')!;
    for (const bundle of bundles.e2e) {
      expect(bundle.sources.some((source) => belongsTo(source, mode.modules)), bundle.platform).toBe(true);
      for (const marker of mode.markers) expect(bundle.js.includes(marker), `${bundle.platform}: ${marker}`).toBe(true);
    }
    for (const bundle of bundles.production) {
      expect(bundle.sources.filter((source) => belongsTo(source, mode.modules)), bundle.platform).toEqual([]);
      for (const marker of mode.markers) expect(bundle.js.includes(marker), `${bundle.platform}: ${marker}`).toBe(false);
    }
  });

  it('Transport-Fehlermodus und alle Testfähigkeiten lassen sich im Produktionsbuild nicht per Konfiguration einschalten', async () => {
    // Der einzige Schalter der Testfähigkeiten bricht einen Produktions-Export schon an der App-Konfiguration ab.
    await expect(runExport('production', join(exportDirectory, 'production-mit-e2e-schalter'), exportEnvironment('production', { EXPO_PUBLIC_E2E_BUILD: 'true' }))).rejects.toThrow(
      'nur im E2E-Build',
    );
  }, 120_000);
});
