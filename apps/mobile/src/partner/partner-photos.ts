import type { AppType } from '@abnehm/backend/rpc';
import { hc } from 'hono/client';

import { ContractError } from '@abnehm/contracts/errors';
import { PartnerPhotoList, type PartnerPhotoRequest } from '@abnehm/contracts/partner';

import { fetchMemoryImage, type MemoryImage } from '../online/memory-image';
import type { OnlineResult } from '../online/online-result';

// „Fotos von heute“ (Spezifikation 5, Abschnitt 2; #122): die beiden Online-Abläufe Fotoliste und Bildabruf
// aus Spezifikation 0, Abschnitt 5, gegen den Lesepfad von #165. Die Liste kommt ohne Tagesparameter; den
// lokalen Tag des Partners bestimmt der Server. Weder Liste noch Bilder landen in SQLite oder in einer Datei.
//
// Die Datei hat bewusst keine React- oder React-Native-Importe: Der Integrationstest des Backends prüft
// sie gegen den echten Server.

export type PartnerPhotoVariant = PartnerPhotoRequest['variant'];

/** Online-Port der Partnerfotos; Komponententests geben einen Fake. */
export type PartnerPhotos = Readonly<{
  /** Die heute geteilten Fotos des Partners; `forbidden` ohne Kopplung oder bei Fotofreigabe `privat`. */
  list(): Promise<OnlineResult<PartnerPhotoList, 'forbidden'>>;
  /** Ein Bild der Liste per Handle; `forbidden`, wenn es nicht (mehr) sichtbar oder das Handle abgelaufen ist. */
  image(handle: string, variant: PartnerPhotoVariant): Promise<OnlineResult<MemoryImage, 'forbidden'>>;
}>;

/** Längste Wartezeit auf die Fotoliste (Designwert, nicht belegt), wie beim Bildabruf. */
const TIMEOUT_MS = 10_000;

/**
 * `fetch` ist das des Auth-Moduls (`AppAuth.fetch`): Es hängt die Sitzung an und sperrt bei `401`. Ohne
 * Netz oder bei einem Serverfehler ist das Ergebnis `offline`.
 */
export function createHttpPartnerPhotos({ baseUrl, fetch }: { baseUrl: string; fetch: typeof globalThis.fetch }): PartnerPhotos {
  const photos = hc<AppType>(baseUrl, { fetch }).v1.nutrition['partner-photos'];
  return {
    async list() {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), TIMEOUT_MS);
      try {
        // Nur der Erfolg ist im RPC-Typ beschrieben; Guard und Auth antworten auch mit 401 und 403.
        let response: Pick<Response, 'status' | 'json'>;
        try {
          response = await photos.$get(undefined, { init: { signal: abort.signal } });
        } catch {
          return { type: 'offline' };
        }
        if (response.status === 401) return { type: 'unauthorized' };
        if (response.status >= 500) return { type: 'offline' };
        const body: unknown = await response.json().catch(() => undefined);
        if (response.status === 200) {
          const list = PartnerPhotoList.safeParse(body);
          return list.success ? { type: 'ok', value: list.data } : { type: 'failed' };
        }
        const error = ContractError.safeParse(body);
        return error.success && error.data.code === 'forbidden' ? { type: 'rejected', code: 'forbidden' } : { type: 'failed' };
      } catch {
        // Abgebrochen oder unterwegs abgerissen.
        return { type: 'offline' };
      } finally {
        clearTimeout(timeout);
      }
    },
    image: (handle, variant) => fetchMemoryImage((signal) => photos[':handle'][':variant'].$get({ param: { handle, variant } }, { init: { signal } })),
  };
}
