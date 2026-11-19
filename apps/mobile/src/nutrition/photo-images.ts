import type { AppType } from '@abnehm/backend/rpc';
import { hc } from 'hono/client';

import type { EntityId } from '@abnehm/contracts/base';
import { ContractError } from '@abnehm/contracts/errors';
import type { MealPhotoVariant } from '@abnehm/contracts/nutrition';

import type { OnlineResult } from '../online/online-result';

// Bildabruf eigener Mahlzeitenfotos (Spezifikation 2, Abschnitt 9; #164): online über den authentifizierten
// Endpunkt `GET /v1/nutrition/meal-photos/:id/:variant`. Das Bild bleibt nur im Speicher: Es kommt als
// `data:`-URI zurück und landet weder in einer Datei noch in einem Bild-Cache auf dem Gerät; die Antwort
// des Servers ist ohnehin `no-store`. Partnerfotos laufen nie hierüber.
//
// Die Datei hat bewusst keine React- oder React-Native-Importe: Der Integrationstest des Backends prüft
// sie gegen den echten Server.

/** Ein abgerufenes Foto, nur im Speicher. */
export type MealPhotoImage = Readonly<{ uri: string }>;

/** Ruft ein eigenes Mahlzeitenfoto ab; `rejected` mit `forbidden` für ein fremdes oder gelöschtes. */
export type MealPhotoImages = (photoId: EntityId, variant: MealPhotoVariant) => Promise<OnlineResult<MealPhotoImage>>;

/** Längste Wartezeit auf ein Bild (Designwert, nicht belegt), wie bei den Einladungsabläufen. */
const TIMEOUT_MS = 10_000;

/** Base64 eines Bildes in Stücken, damit `String.fromCharCode` nicht an der Argumentzahl scheitert. */
function base64Of(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = '';
  for (let start = 0; start < bytes.length; start += chunk) binary += String.fromCharCode(...bytes.subarray(start, start + chunk));
  return btoa(binary);
}

/**
 * `fetch` ist das des Auth-Moduls (`AppAuth.fetch`): Es hängt die Sitzung an und sperrt bei `401`. Ohne
 * Netz oder bei einem Serverfehler ist das Ergebnis `offline`; das Protokoll zeigt dann nur das Symbol.
 */
export function createHttpMealPhotoImages({ baseUrl, fetch }: { baseUrl: string; fetch: typeof globalThis.fetch }): MealPhotoImages {
  const photos = hc<AppType>(baseUrl, { fetch }).v1.nutrition['meal-photos'][':id'][':variant'];
  return async (photoId, variant) => {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      let response: Pick<Response, 'status' | 'headers' | 'arrayBuffer' | 'json'>;
      try {
        response = await photos.$get({ param: { id: photoId, variant } }, { init: { signal: abort.signal } });
      } catch {
        return { type: 'offline' };
      }
      if (response.status === 200 && response.headers.get('content-type') === 'image/jpeg') {
        return { type: 'ok', value: { uri: `data:image/jpeg;base64,${base64Of(new Uint8Array(await response.arrayBuffer()))}` } };
      }
      if (response.status === 401) return { type: 'unauthorized' };
      if (response.status >= 500) return { type: 'offline' };
      const error = ContractError.safeParse(await response.json().catch(() => undefined));
      return error.success && error.data.code === 'forbidden' ? { type: 'rejected', code: 'forbidden' } : { type: 'failed' };
    } catch {
      // Abgebrochen oder unterwegs abgerissen.
      return { type: 'offline' };
    } finally {
      clearTimeout(timeout);
    }
  };
}
