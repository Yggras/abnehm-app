/** Ist der Wert eine ganze Zahl ab `min`? Level, Energie und Nummern sind ganzzahlig. */
export function isWholeNumber(value: number, min: number): boolean {
  return Number.isInteger(value) && value >= min;
}

/** Wirft, wenn der Wert keine ganze Zahl ab `min` ist. */
export function assertWholeNumber(value: number, min: number, label: string): number {
  if (!isWholeNumber(value, min)) throw new RangeError(`${label} muss eine ganze Zahl ab ${min} sein: ${value}`);
  return value;
}

/** Wirft bei einem Level unter 1 oder einem Bruchteil. */
export function assertLevel(level: number): number {
  return assertWholeNumber(level, 1, 'Level');
}
