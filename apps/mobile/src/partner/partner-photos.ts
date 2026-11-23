import type { AppType } from '@abnehm/backend/rpc';
import { hc } from 'hono/client';

import { PartnerPhotoList, type PartnerPhotoRequest } from '@abnehm/contracts/partner';

import { fetchOnline, type OnlineResponse } from '../online/fetch-online';
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

/**
 * `fetch` ist das des Auth-Moduls (`AppAuth.fetch`): Es hängt die Sitzung an und sperrt bei `401`. Ohne
 * Netz oder bei einem Serverfehler ist das Ergebnis `offline`.
 */
export function createHttpPartnerPhotos({ baseUrl, fetch }: { baseUrl: string; fetch: typeof globalThis.fetch }): PartnerPhotos {
  const photos = hc<AppType>(baseUrl, { fetch }).v1.nutrition['partner-photos'];
  return {
    list: () =>
      fetchOnline<OnlineResponse, PartnerPhotoList>(
        // Nur der Erfolg ist im RPC-Typ beschrieben; Guard und Auth antworten auch mit 401 und 403.
        (signal): Promise<OnlineResponse> => photos.$get(undefined, { init: { signal } }),
        async (response) => {
          const list = PartnerPhotoList.safeParse(await response.json().catch(() => undefined));
          return list.success ? { type: 'ok', value: list.data } : { type: 'failed' };
        },
      ),
    image: (handle, variant) => fetchMemoryImage((signal) => photos[':handle'][':variant'].$get({ param: { handle, variant } }, { init: { signal } })),
  };
}
