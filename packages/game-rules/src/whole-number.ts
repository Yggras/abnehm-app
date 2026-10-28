/** Wirft, wenn der Wert keine ganze Zahl ab `min` ist; Level, Energie und Nummern sind ganzzahlig. */
export function assertWholeNumber(value: number, min: number, label: string): number {
  if (!Number.isInteger(value) || value < min) throw new RangeError(`${label} muss eine ganze Zahl ab ${min} sein: ${value}`);
  return value;
}
