import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { color, elevation, fontFamily, motion, opacity, radius, size, space, type, type ShadowLayer } from './tokens';

// Quelle der Tokens ist research/design-system.md (Ergebnis von #65). Der Test liest deren Tabellen
// und verlangt, dass jedes dort dokumentierte Token mit demselben Wert typisiert vorliegt – und
// keines zusätzlich. Ändert sich das Design-System, schlägt er fehl, bis die Tokens nachgezogen sind.

const designSystem = readFileSync(join(__dirname, '../../../../research/design-system.md'), 'utf8');

type Row = { section: string; name: string; cells: string[] };

/** Tabellenzeilen unter `### <Abschnitt>` des Kapitels „Tokens“, deren erste Zelle ein Token-Name ist. */
function tokenRows(): Row[] {
  const tokensChapter = designSystem.slice(designSystem.indexOf('## Tokens'), designSystem.indexOf('## Komponenten'));
  const rows: Row[] = [];
  let section = '';
  for (const line of tokensChapter.split('\n')) {
    const heading = /^### (.+)$/.exec(line);
    if (heading?.[1]) section = heading[1];
    const row = /^\| `([a-zA-Z0-9.-]+)` \|(.*)\|$/.exec(line);
    if (row?.[1] && row[2] !== undefined) {
      rows.push({ section, name: row[1], cells: row[2].split('|').map((cell) => cell.trim()) });
    }
  }
  return rows;
}

const rows = tokenRows();
const inSection = (prefix: string) => rows.filter((row) => row.section.startsWith(prefix));
const camel = (kebab: string) => kebab.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
const code = (cell: string | undefined) => /`([^`]+)`/.exec(cell ?? '')?.[1];

function documented<T>(prefix: string, toEntry: (row: Row) => [string, T]): Record<string, T> {
  return Object.fromEntries(inSection(prefix).filter((row) => !row.name.includes('.')).map(toEntry));
}

test('Farben: alle 61 Farb-Tokens mit ihrem Hex-Wert', () => {
  const expected = documented('Farbe', (row) => [camel(row.name), code(row.cells[0])]);

  expect(Object.keys(expected)).toHaveLength(61);
  expect(color).toEqual(expected);
});

test('Typografie: alle 11 Textstile mit Schnitt, Größe, Zeilenhöhe, Laufweite und tabellarischen Ziffern', () => {
  const families: Record<string, string> = {
    '400': fontFamily.regular,
    '500': fontFamily.medium,
    '600': fontFamily.semibold,
    '700': fontFamily.bold,
  };
  const expected = documented('Typografie', (row) => {
    const [weight = '', metrics = '', tracking = '', purpose = ''] = row.cells;
    const [fontSize, lineHeight] = metrics.split('/').map((value) => Number(value.trim()));
    return [
      camel(row.name),
      {
        fontFamily: families[weight],
        fontSize,
        lineHeight,
        ...(tracking === '–' ? {} : { letterSpacing: Number(tracking) }),
        ...(purpose.includes('Ziffern tabellarisch') ? { fontVariant: ['tabular-nums'] } : {}),
      },
    ];
  });

  expect(Object.keys(expected)).toHaveLength(11);
  expect(type).toEqual(expected);
});

test('Schriftfamilien: die vier Rubik-Schnitte mit den Exportnamen von @expo-google-fonts/rubik', () => {
  const expected = Object.fromEntries(
    inSection('Typografie')
      .filter((row) => row.name.startsWith('fontFamily.'))
      .map((row) => [row.name.slice('fontFamily.'.length), code(row.cells[0])]),
  );

  expect(fontFamily).toEqual(expected);
});

test('Abstände, Radien, Größen und Deckkräfte', () => {
  const numbers = (prefix: string, key: (name: string) => string) =>
    documented(prefix, (row) => [key(row.name), Number(code(row.cells[0]))]);

  expect(space).toEqual(numbers('Abstände', (name) => name.replace('space-', '')));
  expect(radius).toEqual(numbers('Radien', (name) => name.replace('radius-', '')));
  expect(size).toEqual(numbers('Größen', camel));
  expect(opacity).toEqual(numbers('Deckkraft', (name) => camel(name.replace('opacity-', ''))));
  expect([space, radius, size, opacity].map((group) => Object.keys(group).length)).toEqual([8, 6, 20, 6]);
});

test('Elevationen: alle 10 Schatten stimmen mit der Web-Syntax des Design-Systems überein', () => {
  const px = (value: number) => (value === 0 ? '0' : `${value}px`);
  const css = (layers: readonly ShadowLayer[]) =>
    layers
      .map((layer) => [px(layer.offsetX), px(layer.offsetY), px(layer.blur), px(layer.spread), layer.color].join(' '))
      .join(', ');
  const expected = documented('Elevation', (row) => [camel(row.name.replace('elevation-', '')), code(row.cells[0])]);

  expect(Object.keys(expected)).toHaveLength(10);
  expect(Object.fromEntries(Object.entries(elevation).map(([name, layers]) => [name, css(layers)]))).toEqual(expected);
});

test('Bewegung: 5 Dauern, 3 Kurven und 2 Federn', () => {
  const durations = documented('Bewegung', (row) => [row.name, code(row.cells[0])]);
  const expectedDurations = Object.fromEntries(
    Object.entries(durations)
      .filter(([name]) => name.startsWith('duration-'))
      .map(([name, value]) => [name.replace('duration-', ''), Number(value?.replace('ms', ''))]),
  );
  const expectedEasings = Object.fromEntries(
    Object.entries(durations)
      .filter(([name]) => name.startsWith('easing-'))
      .map(([name, value]) => [
        name.replace('easing-', ''),
        /cubic-bezier\((.+)\)/
          .exec(value ?? '')?.[1]
          ?.split(',')
          .map((part) => Number(part.trim())),
      ]),
  );
  const expectedSprings = Object.fromEntries(
    Object.entries(durations)
      .filter(([name]) => name.startsWith('spring-'))
      .map(([name, value]) => [
        name.replace('spring-', ''),
        Object.fromEntries((value ?? '').split(',').map((pair) => pair.trim().split(' ')).map(([key, number]) => [key, Number(number)])),
      ]),
  );

  expect(motion.duration).toEqual(expectedDurations);
  expect(motion.easing).toEqual(expectedEasings);
  expect(motion.spring).toEqual(expectedSprings);
  expect([expectedDurations, expectedEasings, expectedSprings].map((group) => Object.keys(group).length)).toEqual([5, 3, 2]);
});
