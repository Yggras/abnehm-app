import type { BaseIsland } from '../src/catalog.ts';
import { rect } from './define.ts';

// Grundinsel (Spezifikation 4, Abschnitte 4 und 7). Raster 16 × 12, Feldschlüssel
// `grundinsel:‹x›:‹y›`. Die Spezifikation legt die Aufteilung nicht fest; diese ist ein Designwert
// aus der Umsetzung von #179, nicht belegt (docs/entwicklung.md, „Spielregeln und Spielkatalog“):
//
//   x  0 … 3 | 4 … 5 | 6 … 9               | 10 … 11 | 12 … 15
//   y 0 … 4  Ecke a  | Rolle a | Gemeinschaftsplatz | Rolle b | Ecke b
//   y 5 … 9  Rollenbereich a  | Lichtung           | Rollenbereich b
//   y 10…11  Strand über die ganze Breite
//
// Je Seite 20 Felder Ecke und 40 Felder Rollenbereich, das Kontingent zum Schlüpfen.

export const baseIsland: BaseIsland = {
  fields: [
    ...rect(0, 0, 4, 5, { kind: 'ecke', side: 'a' }),
    ...rect(4, 0, 2, 5, { kind: 'rollenbereich', side: 'a' }),
    ...rect(0, 5, 6, 5, { kind: 'rollenbereich', side: 'a' }),
    ...rect(6, 0, 4, 5, { kind: 'gemeinschaftsplatz' }),
    ...rect(6, 5, 4, 5, { kind: 'lichtung' }),
    ...rect(10, 0, 2, 5, { kind: 'rollenbereich', side: 'b' }),
    ...rect(10, 5, 6, 5, { kind: 'rollenbereich', side: 'b' }),
    ...rect(12, 0, 4, 5, { kind: 'ecke', side: 'b' }),
    ...rect(0, 10, 16, 2, { kind: 'strand' }),
  ],
};
