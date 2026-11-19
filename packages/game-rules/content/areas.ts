import type { Area, Blueprint, Deko } from '../src/catalog.ts';
import { rect, stageArt } from './define.ts';

// Gebiete (Spezifikation 4, Abschnitte 4 und 5): Gebiet 1 schaltet mit der Form „Hüpfer“ bei Level 4 frei
// (#204). Die Gebiete 2–7 und die Landschaftsvorlagen liefert #205. Motive, Namen, Preislevel und die Lage
// sind Designwerte aus #204, nicht belegt; die Grafiken zeichnet die App (`apps/mobile/src/island/art.ts`).
//
// Gebiet 1 liegt als Streifen von 16 × 5 Feldern direkt hinter der Grundinsel (y = −5 … −1). Seite a liegt
// über Seite a der Grundinsel, Seite b über Seite b; die Ecken schließen an die Ecken der Grundinsel an:
//
//   x  0 … 1 | 2 … 7           | 8 … 13          | 14 … 15
//      Ecke a | Rollenbereich a | Rollenbereich b | Ecke b
//
// Je Seite 10 Felder Ecke und 30 Felder Rollenbereich, der Zuwachs je Gebiet (Abschnitt 3).

const discoveryBlueprint = (key: string, name: string, role: Blueprint['role'], priceLevel: number): Blueprint => ({
  key, name, role, origin: 'entdeckung', priceLevel, art: stageArt(key),
});

/** Preislevel 4 wie das Freischaltlevel: Grundpreis 5 Energie. */
export const areaBlueprints: readonly Blueprint[] = [
  discoveryBlueprint('steinmauer', 'Steinmauer', 'bauen', 4),
  discoveryBlueprint('briefkasten', 'Briefkasten', 'bauen', 4),
  discoveryBlueprint('seerosenteich', 'Seerosenteich', 'natur', 4),
  discoveryBlueprint('schilfgras', 'Schilfgras', 'natur', 4),
];

export const areaDeko: readonly Deko[] = [{ key: 'steinfrosch', name: 'Steinfrosch', origin: 'entdeckung', art: 'steinfrosch' }];

export const areas: readonly Area[] = [
  {
    key: 'schilfwiese',
    name: 'Schilfwiese',
    unlockLevel: 4,
    fields: [
      ...rect(0, -5, 2, 5, { kind: 'ecke', side: 'a' }),
      ...rect(2, -5, 6, 5, { kind: 'rollenbereich', side: 'a' }),
      ...rect(8, -5, 6, 5, { kind: 'rollenbereich', side: 'b' }),
      ...rect(14, -5, 2, 5, { kind: 'ecke', side: 'b' }),
    ],
    discoveryBlueprints: { bauen: ['steinmauer', 'briefkasten'], natur: ['seerosenteich', 'schilfgras'] },
    discoveryDeko: ['steinfrosch'],
  },
];
