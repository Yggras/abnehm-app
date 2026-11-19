import type { ServerPushData } from '@abnehm/contracts/notifications';

// Expo-Push-Port (Spezifikation 5, Abschnitt 9): die einzige Stelle des Servers, die mit dem Expo Push
// Service spricht. Er sendet Stapel und ruft Quittungen ab; was daraus folgt, entscheidet der Zusteller.
// Format, Grenzen und Fehlercodes: https://docs.expo.dev/push-notifications/sending-notifications/
// In Tests und im Development-Backend steht der Fake der Testfähigkeit `fake-expo-push` dahinter.

/** Eine Nachricht im Anfrageformat von Expo („Message request format“). */
export type ExpoPushMessage = Readonly<{
  to: string;
  title: string;
  body: string;
  data: ServerPushData;
  /** Sekunden, die Expo und die Plattform die Nachricht für eine spätere Zustellung aufheben. */
  ttl: number;
  /** Android-Kanal; die App legt `partner_momo` beim Start an (Spezifikation 5, Abschnitt 8). */
  channelId: 'partner_momo';
  /** iOS-Unterbrechungsstufe; nie Time Sensitive (Spezifikation 5, Abschnitt 8). */
  interruptionLevel: 'active';
}>;

/** Fehler einer einzelnen Nachricht oder Quittung; `error` etwa `DeviceNotRegistered`. */
export type ExpoPushError = Readonly<{ status: 'error'; message: string; details?: Readonly<{ error?: string }> }>;

/** Ticket je Nachricht: `ok` mit Quittungs-ID heißt, Expo hat die Nachricht angenommen. */
export type ExpoPushTicket = Readonly<{ status: 'ok'; id: string }> | ExpoPushError;

export type ExpoPushReceipt = Readonly<{ status: 'ok' }> | ExpoPushError;

/** Ausgang einer Sendeanfrage, so wie der Zusteller ihn für „höchstens einmal“ braucht. */
export type SendOutcome =
  /** Expo hat geantwortet: ein Ticket je Nachricht, in derselben Reihenfolge. */
  | Readonly<{ type: 'tickets'; tickets: readonly ExpoPushTicket[] }>
  /**
   * Nachweislich nichts gesendet: Die Verbindung scheiterte vor dem Senden, oder Expo hat die ganze
   * Anfrage mit 4xx/5xx abgelehnt („If the entire request failed, the HTTP status code is 4xx or 5xx“).
   * `retryable` bei Verbindungsfehler, 429 und 5xx („Retry on failure“).
   */
  | Readonly<{ type: 'not_sent'; retryable: boolean; code: string }>
  /** Die Anfrage kann Expo erreicht haben (Zeitüberschreitung, Abbruch, unlesbare Antwort). */
  | Readonly<{ type: 'unknown'; code: string }>;

export type ReceiptsOutcome =
  /** Quittungen je Ticket-ID; fehlt eine ID, liegt (noch) keine Quittung vor. */
  | Readonly<{ type: 'receipts'; receipts: Readonly<Record<string, ExpoPushReceipt>> }>
  | Readonly<{ type: 'failed'; code: string }>;

export type ExpoPushPort = {
  /** Höchstens `MAX_MESSAGES_PER_REQUEST` Nachrichten. Wirft nie; jeder Fehler ist ein Ausgang. */
  send(messages: readonly ExpoPushMessage[]): Promise<SendOutcome>;
  /** Höchstens `MAX_RECEIPT_IDS_PER_REQUEST` Ticket-IDs. Wirft nie. */
  getReceipts(ticketIds: readonly string[]): Promise<ReceiptsOutcome>;
};

/** „an array of up to 100 message objects“ (Expo, „HTTP/2 API“). */
export const MAX_MESSAGES_PER_REQUEST = 100;
/** „an array of 1000 (or fewer) ticket ID strings“ (Expo, „Request errors“). */
export const MAX_RECEIPT_IDS_PER_REQUEST = 1000;

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
/** Frist je Anfrage; Designwert, nicht belegt. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Fehlercodes, bei denen die Verbindung nachweislich vor dem Senden scheiterte: Namensauflösung
 * (`ENOTFOUND`, `EAI_AGAIN`, https://nodejs.org/api/errors.html#common-system-errors), abgewiesene
 * Verbindung (`ECONNREFUSED`, ebenda) und Zeitüberschreitung beim Verbindungsaufbau
 * (`UND_ERR_CONNECT_TIMEOUT`, https://undici.nodejs.org/#/docs/api/Errors). Alle anderen Fehler können
 * nach dem Senden liegen und gelten als unbekannter Ausgang.
 */
const CONNECT_ERROR_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT']);

/** Code eines `fetch`-Fehlers; Node verpackt Systemfehler als `cause`. */
function errorCode(error: unknown): string {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    if (current.name === 'TimeoutError' || current.name === 'AbortError') return 'zeitueberschreitung';
  }
  return 'unbekannt';
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function asError(value: Record<string, unknown>): ExpoPushError {
  const details = isRecord(value.details) && typeof value.details.error === 'string' ? { error: value.details.error } : undefined;
  return { status: 'error', message: typeof value.message === 'string' ? value.message : '', ...(details && { details }) };
}

function asTicket(value: unknown): ExpoPushTicket | null {
  if (!isRecord(value)) return null;
  if (value.status === 'ok' && typeof value.id === 'string') return { status: 'ok', id: value.id };
  if (value.status === 'error') return asError(value);
  return null;
}

function asReceipt(value: unknown): ExpoPushReceipt | null {
  if (!isRecord(value)) return null;
  if (value.status === 'ok') return { status: 'ok' };
  if (value.status === 'error') return asError(value);
  return null;
}

/**
 * Adapter über HTTP. `accessToken` ist das Zugriffstoken der erweiterten Push-Sicherheit, falls sie
 * aktiviert ist („Additional security“: `Authorization: Bearer …`); es kommt als Docker-Compose-Secret.
 * Eigene Wiederholungen gibt es hier nicht: Ob eine Nachricht erneut gesendet werden darf, entscheidet
 * allein der Zusteller.
 */
export function createExpoPushClient({
  accessToken,
  fetch: fetchImpl = fetch,
}: {
  accessToken: string | null;
  fetch?: typeof fetch;
}): ExpoPushPort {
  const headers = {
    accept: 'application/json',
    'accept-encoding': 'gzip, deflate',
    'content-type': 'application/json',
    ...(accessToken !== null && { authorization: `Bearer ${accessToken}` }),
  };
  const post = (url: string, body: unknown) =>
    fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

  return {
    async send(messages) {
      if (messages.length > MAX_MESSAGES_PER_REQUEST) throw new Error(`Mehr als ${MAX_MESSAGES_PER_REQUEST} Nachrichten je Anfrage`);
      let response: Response;
      try {
        response = await post(SEND_URL, messages);
      } catch (error) {
        const code = errorCode(error);
        return CONNECT_ERROR_CODES.has(code) ? { type: 'not_sent', retryable: true, code } : { type: 'unknown', code };
      }
      if (response.status === 429 || response.status >= 500) return { type: 'not_sent', retryable: true, code: `http_${response.status}` };
      if (response.status >= 400) return { type: 'not_sent', retryable: false, code: `http_${response.status}` };
      try {
        const body: unknown = await response.json();
        const data = isRecord(body) && Array.isArray(body.data) ? body.data : null;
        const tickets = data?.map(asTicket) ?? [];
        if (data === null || tickets.length !== messages.length || tickets.some((ticket) => ticket === null)) {
          return { type: 'unknown', code: 'antwort_ungueltig' };
        }
        return { type: 'tickets', tickets: tickets as ExpoPushTicket[] };
      } catch (error) {
        return { type: 'unknown', code: errorCode(error) };
      }
    },

    async getReceipts(ticketIds) {
      if (ticketIds.length > MAX_RECEIPT_IDS_PER_REQUEST) throw new Error(`Mehr als ${MAX_RECEIPT_IDS_PER_REQUEST} Quittungen je Anfrage`);
      try {
        const response = await post(RECEIPTS_URL, { ids: ticketIds });
        if (!response.ok) return { type: 'failed', code: `http_${response.status}` };
        const body: unknown = await response.json();
        if (!isRecord(body) || !isRecord(body.data)) return { type: 'failed', code: 'antwort_ungueltig' };
        const receipts: Record<string, ExpoPushReceipt> = {};
        for (const id of ticketIds) {
          const receipt = Object.prototype.hasOwnProperty.call(body.data, id) ? asReceipt(body.data[id]) : null;
          if (receipt !== null) receipts[id] = receipt;
        }
        return { type: 'receipts', receipts };
      } catch (error) {
        return { type: 'failed', code: errorCode(error) };
      }
    },
  };
}
