import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testCapabilities, testCapabilityRoots, type TestCapability } from './test-capabilities.ts';

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

const belongsTo = (file: string, modules: readonly string[]) => modules.some((module) => (module.endsWith('/') ? file.startsWith(module) : file === module));
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

/** Repo-Pfad eines Imports, soweit er auf eigenen Code zeigt. */
function resolved(file: string, specifier: string): string | null {
  if (specifier.startsWith('.')) return relative(root, join(root, file, '..', specifier));
  return packageModules[specifier] ?? null;
}

// App-Bundle ---------------------------------------------------------------------------------------

type Bundle = { platform: string; js: string; sources: string[] };

const execFileAsync = promisify(execFile);
const exportDirectory = mkdtempSync(join(tmpdir(), 'abnehm-release-'));
const bundles: Record<'production' | 'development', Bundle[]> = { production: [], development: [] };

async function exportApp(mode: 'production' | 'development'): Promise<Bundle[]> {
  const output = join(exportDirectory, mode);
  await execFileAsync(
    'npx',
    ['expo', 'export', '--platform', 'ios', '--platform', 'android', '--no-bytecode', '--source-maps', '--output-dir', output, ...(mode === 'development' ? ['--dev'] : [])],
    // Wie ein Store-Build: Produktionsvariante, keine Entwicklungs-URL.
    { cwd: join(root, 'apps/mobile'), env: { ...process.env, APP_VARIANT: mode, NODE_ENV: mode }, maxBuffer: 64 * 1024 * 1024 },
  );
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
  [bundles.production, bundles.development] = await Promise.all([exportApp('production'), exportApp('development')]);
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
          const target = resolved(file, specifier);
          expect(target !== null && belongsTo(target.replace(/\.ts$/, '.ts'), capability.modules), `${file} → ${specifier}`).toBe(false);
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
    for (const module of ['apps/backend/dev/main.ts', 'apps/backend/dev/seed/server-seed.ts', 'apps/backend/dev/seed-command.ts', 'packages/contracts/seeds/index.ts']) {
      expect(development).toContain(module);
    }
    expect(read('apps/backend/Dockerfile')).toMatch(/AS development[^]*CMD \["node", "apps\/backend\/dev\/main\.ts"\]/);
  });
});

describe('Produktions-Bundle der App', () => {
  describe.each(testCapabilities.map((capability) => [capability.key, capability] as const))('%s', (_, capability: TestCapability) => {
    it('enthält kein Modul der Fähigkeit', () => {
      for (const bundle of bundles.production) {
        expect(bundle.sources.filter((source) => belongsTo(source, capability.modules)), bundle.platform).toEqual([]);
      }
    });

    it('enthält keinen Marker und keinen Deep-Link-Einstieg der Fähigkeit', () => {
      for (const bundle of bundles.production) {
        for (const marker of capability.markers) expect(bundle.js.includes(marker), `${bundle.platform}: ${marker}`).toBe(false);
      }
    });
  });

  it('die Grenze selbst ist im Bundle und verweist auf nichts', () => {
    for (const bundle of bundles.production) {
      expect(bundle.sources).toContain('apps/mobile/src/build-capabilities.ts');
      expect(bundle.sources.filter((source) => testCapabilityRoots.some((rootPath) => source.startsWith(rootPath)))).toEqual([]);
    }
  });

  it('Gegenprobe: das Development-Bundle enthält jede Fähigkeit der App samt Markern', () => {
    const appCapabilities = testCapabilities.filter(({ modules }) => modules.some((module) => module.startsWith('apps/mobile/')));
    expect(appCapabilities.map(({ key }) => key).sort()).toEqual(['fehler-adapter', 'seed', 'testgeruest', 'testuhr']);
    for (const bundle of bundles.development) {
      for (const capability of appCapabilities) {
        expect(bundle.sources.some((source) => belongsTo(source, capability.modules)), `${bundle.platform}: ${capability.key}`).toBe(true);
      }
      for (const marker of ['/dev/seed', 'momo-insel-testpasswort', 'Fehler-Adapter', 'Seed fehlgeschlagen']) {
        expect(bundle.js.includes(marker), `${bundle.platform}: ${marker}`).toBe(true);
      }
    }
  });
});
