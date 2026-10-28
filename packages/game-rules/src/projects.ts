import type { CommonStage } from '@abnehm/contracts/island';

// Gemeinschaftsprojekte und gemeinsame Stufe (Spezifikation 4, Abschnitt 8; Werte neu festgelegt,
// nicht belegt). Die Stufe gilt für Gemeinschaftsprojekt und Challenge gleichermaßen.

/** Eingezahlter Stand und festgeschriebener Bedarf eines Anteils. */
export type Share = Readonly<{ paid: number; need: number }>;

/** Bedarf je Anteil von Projekt Nummer n: `min(20 + 10 × (n − 1), 100)`; danach Ausbau mit 100. */
export function projectNeed(sequenceNumber: number): number {
  if (!Number.isInteger(sequenceNumber) || sequenceNumber < 1) {
    throw new RangeError(`Projektnummer muss eine ganze Zahl ab 1 sein: ${sequenceNumber}`);
  }
  return Math.min(20 + 10 * (sequenceNumber - 1), 100);
}

/**
 * Gemeinsame Stufe aus `(min(a, A) + min(b, B)) / (A + B)`: unter 50 % `gestartet`, ab 50 %
 * `gut_unterwegs`, ab 80 % `fast_geschafft`; `geschafft` erst, wenn beide Anteile voll sind.
 */
export function commonStage(shares: readonly [Share, Share]): CommonStage {
  const [a, b] = shares;
  if (a.paid >= a.need && b.paid >= b.need) return 'geschafft';
  const paid = Math.min(a.paid, a.need) + Math.min(b.paid, b.need);
  const need = a.need + b.need;
  if (5 * paid >= 4 * need) return 'fast_geschafft';
  if (2 * paid >= need) return 'gut_unterwegs';
  return 'gestartet';
}
