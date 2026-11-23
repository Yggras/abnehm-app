import { ContractError } from '@abnehm/contracts/errors';

import type { OnlineResult } from './online-result';

// Bildabruf nur in den Arbeitsspeicher (Spezifikation 0, Abschnitt 5; Spezifikation 2, Abschnitt 9): eigene
// Mahlzeitenfotos (#164) und Partnerfotos (#122). Das JPEG kommt als `data:`-URI zurück und erreicht die
// Bildkomponente nie als Datei- oder Netz-URL. Für `data:`-URIs schreibt die native Bildkomponente nichts
// auf die Platte:
// - Android (Fresco): Die Sequenz für `data:` (`dataFetchSequence`) hat nur den Bitmap-Speichercache; den
//   Plattencache baut allein `newDiskCacheSequence` für andere Quellen ein
//   (https://github.com/facebook/fresco/blob/main/imagepipeline/src/main/java/com/facebook/imagepipeline/core/ProducerSequenceFactory.kt).
// - iOS: `RCTDataRequestHandler` liest die URI nur (`dataWithContentsOfURL:`), ohne `NSURLSession` und damit
//   ohne `NSURLCache`; dekodierte Bilder hält `RCTImageCache` in einem `NSCache` im Speicher
//   (https://github.com/facebook/react-native/blob/main/packages/react-native/Libraries/Network/RCTDataRequestHandler.mm,
//   https://github.com/facebook/react-native/blob/main/packages/react-native/Libraries/Image/RCTImageCache.mm).
// Die Antworten des Servers sind zudem `no-store`.
//
// Die Datei hat bewusst keine React- oder React-Native-Importe: Integrationstests des Backends laden sie.

/** Ein abgerufenes Bild, nur im Speicher. */
export type MemoryImage = Readonly<{ uri: string }>;

/** Längste Wartezeit auf ein Bild (Designwert, nicht belegt), wie bei den Einladungsabläufen. */
const TIMEOUT_MS = 10_000;

/** Base64 eines Bildes in Stücken, damit `String.fromCharCode` nicht an der Argumentzahl scheitert. */
function base64Of(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = '';
  for (let start = 0; start < bytes.length; start += chunk) binary += String.fromCharCode(...bytes.subarray(start, start + chunk));
  return btoa(binary);
}

type ImageResponse = Pick<Response, 'status' | 'headers' | 'arrayBuffer' | 'json'>;

/**
 * Ruft ein JPEG über `request` ab, etwa einen Hono-RPC-Aufruf mit dem `fetch` des Auth-Moduls. Ohne Netz,
 * nach Zeitüberschreitung oder bei einem Serverfehler ist das Ergebnis `offline`, bei `403 forbidden`
 * `rejected`, bei `401` `unauthorized`.
 */
export async function fetchMemoryImage(request: (signal: AbortSignal) => Promise<ImageResponse>): Promise<OnlineResult<MemoryImage, 'forbidden'>> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    let response: ImageResponse;
    try {
      response = await request(abort.signal);
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
}
