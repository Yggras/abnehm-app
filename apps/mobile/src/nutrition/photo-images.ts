import type { AppType } from '@abnehm/backend/rpc';
import { hc } from 'hono/client';

import type { EntityId } from '@abnehm/contracts/base';
import type { MealPhotoVariant } from '@abnehm/contracts/nutrition';

import { fetchMemoryImage, type MemoryImage } from '../online/memory-image';
import type { OnlineResult } from '../online/online-result';

// Bildabruf eigener Mahlzeitenfotos (Spezifikation 2, Abschnitt 9; #164): online über den authentifizierten
// Endpunkt `GET /v1/nutrition/meal-photos/:id/:variant`. Das Bild bleibt nur im Speicher (`memory-image.ts`).
// Partnerfotos laufen nie hierüber, sondern über Fotoliste und Handle (`partner/partner-photos.ts`).
//
// Die Datei hat bewusst keine React- oder React-Native-Importe: Der Integrationstest des Backends prüft
// sie gegen den echten Server.

/** Ein abgerufenes Foto, nur im Speicher. */
export type MealPhotoImage = MemoryImage;

/** Ruft ein eigenes Mahlzeitenfoto ab; `rejected` mit `forbidden` für ein fremdes oder gelöschtes. */
export type MealPhotoImages = (photoId: EntityId, variant: MealPhotoVariant) => Promise<OnlineResult<MealPhotoImage>>;

/**
 * `fetch` ist das des Auth-Moduls (`AppAuth.fetch`): Es hängt die Sitzung an und sperrt bei `401`. Ohne
 * Netz oder bei einem Serverfehler ist das Ergebnis `offline`; das Protokoll zeigt dann nur das Symbol.
 */
export function createHttpMealPhotoImages({ baseUrl, fetch }: { baseUrl: string; fetch: typeof globalThis.fetch }): MealPhotoImages {
  const photos = hc<AppType>(baseUrl, { fetch }).v1.nutrition['meal-photos'][':id'][':variant'];
  return (photoId, variant) => fetchMemoryImage((signal) => photos.$get({ param: { id: photoId, variant } }, { init: { signal } }));
}
