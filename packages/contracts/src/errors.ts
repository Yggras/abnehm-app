import { z } from 'zod';

/**
 * Stabile Fehlercodes. Den sichtbaren deutschen Text erzeugt die App aus dem Code; die
 * Einladungscodes stammen aus Spezifikation 0, Abschnitt 9, die Fotocodes aus Spezifikation 2.
 */
export const ContractErrorCode = z.enum([
  'invalid_payload',
  'invalid_snapshot',
  'unknown_catalog_key',
  'forbidden',
  'conflict',
  'operation_conflict',
  'permanently_rejected',
  'schema_update_required',
  'full_resync_required',
  'invite_invalid',
  'invite_expired',
  'invite_consumed',
  'invite_self',
  'already_coupled',
  'invite_rate_limited',
  'photo_invalid_image',
  'photo_no_food_detected',
  'photo_analysis_failed',
  'photo_analysis_limit_reached',
  'photo_draft_expired',
  'photo_analysis_unavailable',
]);
export type ContractErrorCode = z.infer<typeof ContractErrorCode>;

// Kontextwerte sind Kennungen, Zahlen oder Wahrheitswerte. Zeichenfolgen ohne Leerraum schließen
// Sätze und damit sichtbaren Text aus; IDs, Zeitpunkte, Zonen und Schlüssel passen hinein.
const ContextToken = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9_.:+/-]+$/);
const ContextScalar = z.union([ContextToken, z.number(), z.boolean(), z.null()]);

/** Fehler an jeder Vertragsgrenze: stabiler Code, optional strukturierter Kontext ohne sichtbaren Text. */
export const ContractError = z.strictObject({
  code: ContractErrorCode,
  context: z
    .record(z.string().regex(/^[a-z][A-Za-z0-9]*$/), z.union([ContextScalar, z.array(ContextScalar).max(50)]))
    .optional(),
  retryable: z.boolean(),
});
export type ContractError = z.infer<typeof ContractError>;
