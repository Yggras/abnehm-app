// Eingabe des Körpergewichts: gespeichert in g, eingegeben in kg mit einer Nachkommastelle
// (Spezifikation 3, Abschnitt 1). Umgerechnet wird nur an der Oberfläche; die Anzeige formatiert
// `thousandthsWithOneDecimal` aus `shell/texts.ts`.

const gramsPerKg = 1000;
/** Eine Nachkommastelle in kg sind 100 g; das ist die Einheit, nicht die Schrittregel der Eingabe. */
const gramsPerTenthKg = 100;

/** Ganze kg mit höchstens einer Nachkommastelle, mit Komma oder Punkt. */
const kgInput = /^(\d{1,3})(?:[.,](\d))?$/;

/**
 * Eingabe in kg als g, etwa „91,8“ oder „91.8“ als 91 800. Ohne Zahl oder mit mehr als einer
 * Nachkommastelle `null`; den Bereich prüfen die Tracker-Regeln.
 */
export function gramsOfKgText(text: string): number | null {
  const match = kgInput.exec(text.trim());
  if (match === null) return null;
  return Number(match[1]) * gramsPerKg + Number(match[2] ?? 0) * gramsPerTenthKg;
}
