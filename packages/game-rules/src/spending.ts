import { shownEnergy } from '@abnehm/contracts/energy';

// Ausgaben prüfen (Spezifikation 4, Abschnitt 3): gemeinsam für Bauen, Aufwerten (`building.ts`) und Einzahlen
// (`projects.ts`, #208). Das Gerät erlaubt eine Ausgabe nur bei ausreichendem lokalem Bestand. Der Server lehnt erst
// ab, wenn der Bestand danach unter der Schutzgrenze läge: Zwei eigene Offline-Geräte dürfen sich überschneiden
// (#35), ein manipulierter Client kann sich aber nicht beliebig verschulden.

/** Schutzgrenze des Servers (neu festgelegt in #83, Abschnitt 3; nicht belegt). */
export const serverDebtLimit = -30;

/** Wer den Bestand prüft: `geraet` nur bei ausreichendem Bestand, `server` nur bis zur Schutzgrenze. */
export type Checker = 'geraet' | 'server';

/** Ausgabe abgelehnt: auf dem Server die Schutzgrenze, auf dem Gerät mit dem, was zum Preis fehlt. */
export type SpendingRefusal =
  | Readonly<{ type: 'verboten'; reason: 'schutzgrenze' }>
  /** Preis und was dazu fehlt; die Oberfläche zeigt neutral „Noch ‹n› Energie“. */
  | Readonly<{ type: 'verboten'; reason: 'zu_wenig_energie'; price: number; missing: number }>;

export type Spending = Readonly<{ type: 'erlaubt'; price: number }> | SpendingRefusal;

/** Was das Gerät ausgeben darf: der angezeigte Bestand; ein negativer Zwischenstand zählt als 0 (Spezifikation 0, Abschnitt 4). */
export function availableOnDevice(balance: number): number {
  return shownEnergy(balance);
}

/** Ob die Person `price` ausgeben darf. */
export function spend(price: number, balance: number, checkedBy: Checker): Spending {
  if (checkedBy === 'server') return balance - price < serverDebtLimit ? { type: 'verboten', reason: 'schutzgrenze' } : { type: 'erlaubt', price };
  const available = availableOnDevice(balance);
  return available < price ? { type: 'verboten', reason: 'zu_wenig_energie', price, missing: price - available } : { type: 'erlaubt', price };
}
