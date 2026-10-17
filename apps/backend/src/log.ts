/**
 * Kennung eines Fehlers fürs Log, ohne Meldungstext: Meldungen können Abfragedaten
 * enthalten, und Logs dürfen keine Gesundheitswerte oder Geheimnisse zeigen (#22).
 */
export function errorCodeForLog(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code;
  return error instanceof Error ? error.name : 'unbekannt';
}
