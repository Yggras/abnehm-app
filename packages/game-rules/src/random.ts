// Deterministischer Zufall der Ereigniserzeugung (Spezifikation 4, Abschnitt 9): ein aus Insel-ID und
// Anlass abgeleiteter Zufallsgenerator. Dieselbe Saat ergibt auf Server und Gerät dieselbe Folge, damit
// eine wiederholte Erzeugung und eine offline vorläufig berechnete Belohnung übereinstimmen.
//
// Saat: 32-Bit-FNV-1a mit Offset-Basis 2166136261 und Primzahl 16777619
// (http://www.isthe.com/chongo/tech/comp/fnv/index.html), abweichend vom Original über die
// UTF-16-Einheiten der Zeichenfolge statt über Oktette; als Saat genügt das. Folge: Mulberry32, ein 32-Bit-Generator
// von Tommy Ettinger (https://gist.github.com/tommyettinger/46a874533244883189143505d203312c). Beide sind
// für Spielzufall gedacht, nicht für Kryptografie.

/** Liefert Zahlen in [0, 1); dieselbe Saat ergibt dieselbe Folge. */
export type Random = () => number;

const fnvOffset = 0x811c9dc5;
const fnvPrime = 0x01000193;

function fnv1a(text: string): number {
  let hash = fnvOffset;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, fnvPrime) >>> 0;
  }
  return hash;
}

export function seededRandom(seed: string): Random {
  let state = fnv1a(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ein Element der Liste; `undefined` bei leerer Liste. */
export function pick<T>(random: Random, items: readonly T[]): T | undefined {
  return items.length === 0 ? undefined : items[Math.floor(random() * items.length)];
}

/** Die Liste in zufälliger Reihenfolge (Fisher-Yates); das Original bleibt unverändert. */
export function shuffled<T>(random: Random, items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}
