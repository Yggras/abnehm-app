import type { ArtKey, Stage } from '@abnehm/game-rules/catalog';

// Grafiken der Inselobjekte. Der Spielkatalog nennt Grafiken nur als Schlüssel `‹bauplan›_‹stufe›`
// (`content/define.ts`), die App zeichnet sie. Bis der Bau-Modus (#192) die endgültigen Grafiken der
// Start-Baupläne liefert, sind es flächige Vorzeichnungen in Inselfarben; unbekannte Schlüssel zeichnet
// die Inselansicht als neutralen Block.

export type ArtShape = 'baum' | 'busch' | 'blumen' | 'weg' | 'bank' | 'laterne' | 'block';

/** Wie die Inselansicht eine Grafik zeichnet; `lit` leuchtet abends in `island-lamp`. */
export type ArtSpec = Readonly<{ shape: ArtShape; stage: Stage; lit: boolean }>;

const subjects: Readonly<Record<string, Readonly<{ shape: ArtShape; lit: boolean }>>> = {
  holzweg: { shape: 'weg', lit: false },
  sitzbank: { shape: 'bank', lit: false },
  laterne: { shape: 'laterne', lit: true },
  blumenwiese: { shape: 'blumen', lit: false },
  beerenstrauch: { shape: 'busch', lit: false },
  apfelbaum: { shape: 'baum', lit: false },
};

export function artOf(art: ArtKey): ArtSpec {
  const match = /^(.+)_([123])$/.exec(art);
  const subject = match === null ? undefined : subjects[match[1]!];
  return { shape: subject?.shape ?? 'block', stage: match === null ? 1 : (Number(match[2]) as Stage), lit: subject?.lit ?? false };
}
