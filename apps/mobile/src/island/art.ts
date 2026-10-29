import type { ArtKey, Stage } from '@abnehm/game-rules/catalog';
import { gameCatalog } from '@abnehm/game-rules/content';

// Grafiken der Inselobjekte. Der Spielkatalog nennt je Bauplan die Grafik jeder Stufe nur als
// Schlüssel (`art`), die App zeichnet sie. Bis der Bau-Modus (#192) die endgültigen Grafiken der
// Start-Baupläne liefert, sind es flächige Vorzeichnungen in Inselfarben; unbekannte Schlüssel zeichnet
// die Inselansicht als neutralen Block.

export type ArtShape = 'baum' | 'busch' | 'blumen' | 'weg' | 'bank' | 'laterne' | 'block';

/** Wie die Inselansicht eine Grafik zeichnet; `lit` leuchtet abends in `island-lamp`. */
export type ArtSpec = Readonly<{ shape: ArtShape; stage: Stage; lit: boolean }>;

/** Vorzeichnung je Bauplan. */
const drawings: Readonly<Record<string, Readonly<{ shape: ArtShape; lit: boolean }>>> = {
  holzweg: { shape: 'weg', lit: false },
  sitzbank: { shape: 'bank', lit: false },
  laterne: { shape: 'laterne', lit: true },
  blumenwiese: { shape: 'blumen', lit: false },
  beerenstrauch: { shape: 'busch', lit: false },
  apfelbaum: { shape: 'baum', lit: false },
};

const byArt = new Map<ArtKey, ArtSpec>(
  gameCatalog.blueprints.flatMap((blueprint) => {
    const drawing = drawings[blueprint.key];
    return drawing === undefined ? [] : blueprint.art.map((art, index) => [art, { ...drawing, stage: (index + 1) as Stage }] as const);
  }),
);

const unknown: ArtSpec = { shape: 'block', stage: 1, lit: false };

export function artOf(art: ArtKey): ArtSpec {
  return byArt.get(art) ?? unknown;
}
