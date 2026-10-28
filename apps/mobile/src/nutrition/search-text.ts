// Normalisierung der Lebensmittelsuche (Spezifikation 2, Abschnitt 4): Groß- und Kleinschreibung,
// Umlaute (ä → a bzw. ae), ß → ss und überzählige Leerzeichen. Suchnamen und Eingaben bestehen danach
// nur aus Wörtern aus a–z und 0–9, getrennt durch je ein Leerzeichen; so zerlegt sie auch der
// Tokenizer `unicode61` von FTS5 (https://www.sqlite.org/fts5.html#unicode61_tokenizer).
//
// Die Datei hat keine Importe: Das Build-Skript des BLS-Katalogs (`scripts/bls-catalog/`) läuft unter
// Node und berechnet mit ihr die Suchnamen des Assets, die App mit ihr die Anfrage.

/** Mindestlänge der Eingabe, ab der gesucht wird. */
const minimumInputLength = 2;

/** Ab dieser Länge darf ein Suchwort auch im Wortinneren treffen („saft“ in „Apfelsaft“). */
export const withinWordMinimumLength = 3;

/** Normalisierte Anfrage: die Wörter der Eingabe und ihr Text, durch je ein Leerzeichen getrennt. */
export type SearchQuery = Readonly<{ text: string; terms: readonly string[] }>;

/**
 * Normalisierte Suchnamen eines Lebensmittels: `searchName` mit ä → a, ö → o, ü → u und, falls
 * abweichend, `searchAlt` mit ä → ae, ö → oe, ü → ue. So finden „Musli“ und „Muesli“ beide „Müsli“.
 */
export function searchNames(name: string): { searchName: string; searchAlt: string | null } {
  const searchName = normalized(name, false);
  const searchAlt = normalized(name, true);
  return { searchName, searchAlt: searchAlt === searchName ? null : searchAlt };
}

/** Die Anfrage zur Eingabe der Person; `null`, solange sie kürzer als zwei Zeichen ist. */
export function searchQuery(input: string): SearchQuery | null {
  // Gezählt wird, was die Person getippt hat: „ß“ ist ein Zeichen, auch wenn daraus „ss“ wird.
  if ([...input.trim().replace(/\s+/g, ' ')].length < minimumInputLength) return null;
  const text = normalized(input, false);
  return { text, terms: text === '' ? [] : text.split(' ') };
}

const accents: Readonly<Record<string, string>> = {
  à: 'a', á: 'a', â: 'a', ã: 'a', å: 'a', æ: 'ae', ç: 'c', è: 'e', é: 'e', ê: 'e', ë: 'e', ì: 'i', í: 'i',
  î: 'i', ï: 'i', ñ: 'n', ò: 'o', ó: 'o', ô: 'o', õ: 'o', ø: 'o', œ: 'oe', ù: 'u', ú: 'u', û: 'u', ý: 'y', ÿ: 'y',
};

function normalized(text: string, umlautsAsE: boolean): string {
  // Eine feste Tabelle statt Unicode-Zerlegung: Sie verhält sich in Node und Hermes gleich.
  return text
    .toLowerCase()
    .replace(/[äöü]/g, (umlaut) => (umlautsAsE ? { ä: 'ae', ö: 'oe', ü: 'ue' } : { ä: 'a', ö: 'o', ü: 'u' })[umlaut as 'ä'])
    .replace(/ß/g, 'ss')
    .replace(/[àáâãåæçèéêëìíîïñòóôõøœùúûýÿ]/g, (letter) => accents[letter] as string)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
