import { eq } from 'drizzle-orm';
import type { Context } from 'hono';

import type { ContractError } from '@abnehm/contracts/errors';
import type { MealPhotoVariant } from '@abnehm/contracts/nutrition';

import type { Database } from '../database.ts';
import { mealPhoto } from '../db/schema/index.ts';
import type { PhotoStorage } from './photo-storage.ts';

// Gemeinsamer Schluss beider Bildabrufe: eigene Mahlzeitenfotos (`meal-photos.ts`, #164) und Partnerfotos
// (`partner-photos.ts`, #165). Ob das Foto gelesen werden darf, hat der Guard der Route schon entschieden.

/** Antwort auf eine unbekannte Fassung; die Foto-ID bzw. das Handle hat der Guard schon geprüft. */
export const invalidVariant = { code: 'invalid_payload', retryable: false } as const satisfies ContractError;

/**
 * Antwort-Header des Bildabrufs: JPEG, nie als etwas anderes interpretiert und nicht cachebar (`no-store`,
 * RFC 9111, Abschnitt 5.2.2.5, https://www.rfc-editor.org/rfc/rfc9111#name-no-store). Die App hält das Bild
 * nur im Speicher (Spezifikation 2, Abschnitt 9).
 */
const imageHeaders = { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } as const;

/** Eine Fassung des Fotos `photoId` als JPEG; ohne Datei, etwa zwischen Löschen und Aufräumen, `404` und nichts Cachebares. */
export async function servePhoto(
  c: Context,
  { database, storage }: { database: Database; storage: PhotoStorage },
  photoId: string,
  variant: MealPhotoVariant,
): Promise<Response> {
  const [photo] = await database.db.select({ imageKey: mealPhoto.imageKey }).from(mealPhoto).where(eq(mealPhoto.id, photoId));
  const image = photo === undefined ? null : await storage.readPhoto(photo.imageKey, variant);
  if (image === null) return c.body(null, 404, { 'cache-control': 'no-store' });
  return c.body(new Uint8Array(image), 200, imageHeaders);
}
