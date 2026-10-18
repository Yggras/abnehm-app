import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// Nachweis für #94: Das Vertragsmodul ist nach Fachbereichen geschnitten. Jeder Bereich ist ein
// eigener Teilpfad des Pakets; es gibt kein globales Barrel und keine gegenseitigen Bereichsimporte.

const srcDir = new URL('../src/', import.meta.url);
const sourceFiles = readdirSync(srcDir).filter((file) => file.endsWith('.ts'));
const source = (file: string) => readFileSync(new URL(file, srcDir), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  exports: Record<string, string>;
};

/** Relative Importe einer Quelldatei als Dateinamen in `src/`. */
function localImports(file: string): string[] {
  return [...source(file).matchAll(/from '\.\/([^']+)'/g)].map((match) => match[1] as string);
}

describe('Zuschnitt des Vertragsmoduls', () => {
  it('hat kein Paket-Barrel, sondern je Bereich einen Teilpfad auf seine eigene Datei', () => {
    expect(Object.keys(packageJson.exports)).not.toContain('.');
    for (const [subpath, file] of Object.entries(packageJson.exports)) {
      if (subpath === './fixtures') continue;
      expect(file).toBe(`./src/${subpath.slice(2)}.ts`);
    }
  });

  it.each(sourceFiles)('%s reicht keine Exporte anderer Dateien weiter', (file) => {
    expect(source(file)).not.toMatch(/^export\s+(?:\*|\{[^}]*\}|type\s+\{[^}]*\})\s+from\s/m);
  });

  it('Bereiche importieren sich nicht gegenseitig, auch nicht über Umwege', () => {
    const cycles: string[] = [];
    const visit = (file: string, path: string[]) => {
      if (path.includes(file)) {
        cycles.push([...path.slice(path.indexOf(file)), file].join(' → '));
        return;
      }
      for (const imported of localImports(file)) visit(imported, [...path, file]);
    };
    for (const file of sourceFiles) visit(file, []);

    expect(cycles).toEqual([]);
  });

  it('importiert nur vorhandene Dateien', () => {
    for (const file of sourceFiles) for (const imported of localImports(file)) expect(sourceFiles).toContain(imported);
  });
});
