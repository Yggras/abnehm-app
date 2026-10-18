import type { z } from 'zod';

/** Gültige und ungültige Beispiele eines Schemas. Die Namen beschreiben, was das Beispiel zeigt. */
export type SchemaFixtures = Readonly<{
  schema: z.ZodType;
  valid: Readonly<Record<string, unknown>>;
  invalid: Readonly<Record<string, unknown>>;
}>;

/** Erlaubt Fixtures mit `as const`, auch für Tupel. */
type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

/**
 * Fixtures eines Schemas. Gültige Beispiele prüft schon die Typprüfung gegen den Eingabetyp; alle
 * Beispiele müssen reines JSON sein, weil die Vertragstests sie auch über HTTP schicken.
 */
export function fixtures<S extends z.ZodType>(
  schema: S,
  cases: { valid: Record<string, DeepReadonly<z.input<S>>>; invalid: Record<string, unknown> },
): SchemaFixtures {
  return { schema, ...cases };
}

/** Kopie ohne die genannten Felder; fehlende Felder bleiben so auch in JSON fehlend. */
export function without<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key as K))) as Omit<T, K>;
}
