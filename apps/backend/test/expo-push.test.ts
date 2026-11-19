import { describe, expect, it } from 'vitest';

import { createExpoPushClient, type ExpoPushMessage } from '../src/notifications/expo-push.ts';

// HTTP-Adapter des Expo-Push-Ports (Spezifikation 5, Abschnitt 9; #142) über ein eingespeistes `fetch`:
// Anfrageformat, Zugriffstoken und die Einordnung jedes Ausgangs für „höchstens einmal“. Format und
// Fehler laut https://docs.expo.dev/push-notifications/sending-notifications/.

const message: ExpoPushMessage = {
  to: 'ExponentPushToken[anna-iphone]',
  title: 'Philipp feuert dich an',
  body: 'Gemeinsam für Momo 🐣',
  data: { intentId: 'e:a:anfeuern', target: { type: 'partner', focus: 'received_encouragement' } },
  ttl: 86_400,
  channelId: 'partner_momo',
  interruptionLevel: 'active',
};

type Call = { url: string; init: RequestInit };

function fetchReturning(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Ein Fehler, wie Node `fetch` ihn bei einem Systemfehler wirft: `TypeError` mit `cause.code`. */
const fetchFailure = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });

describe('Expo-Push-Adapter: senden', () => {
  it('sendet den Stapel als JSON-Array an Expo und liefert die Tickets in Reihenfolge', async () => {
    const { calls, fetchImpl } = fetchReturning(() =>
      json(200, { data: [{ status: 'ok', id: 'ticket-1' }, { status: 'error', message: 'nicht registriert', details: { error: 'DeviceNotRegistered' } }] }),
    );
    const client = createExpoPushClient({ accessToken: null, fetch: fetchImpl });

    const outcome = await client.send([message, { ...message, to: 'ExponentPushToken[alt]' }]);

    expect(outcome).toEqual({
      type: 'tickets',
      tickets: [
        { status: 'ok', id: 'ticket-1' },
        { status: 'error', message: 'nicht registriert', details: { error: 'DeviceNotRegistered' } },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://exp.host/--/api/v2/push/send');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual([message, { ...message, to: 'ExponentPushToken[alt]' }]);
    expect(calls[0]!.init.headers).toMatchObject({ 'content-type': 'application/json', accept: 'application/json' });
    expect(calls[0]!.init.headers).not.toHaveProperty('authorization');
  });

  it('schickt das Zugriffstoken der erweiterten Push-Sicherheit als Bearer-Token mit', async () => {
    const { calls, fetchImpl } = fetchReturning(() => json(200, { data: [{ status: 'ok', id: 't' }] }));
    await createExpoPushClient({ accessToken: 'geheim', fetch: fetchImpl }).send([message]);
    expect(calls[0]!.init.headers).toMatchObject({ authorization: 'Bearer geheim' });
  });

  it('Verbindungsfehler vor dem Senden: nachweislich nichts gesendet, wiederholbar', async () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']) {
      const client = createExpoPushClient({ accessToken: null, fetch: (async () => Promise.reject(fetchFailure(code))) as unknown as typeof fetch });
      expect(await client.send([message])).toEqual({ type: 'not_sent', retryable: true, code });
    }
  });

  it('Abbruch oder Zeitüberschreitung nach dem Verbindungsaufbau: Ausgang unbekannt, keine Wiederholung', async () => {
    const reset = createExpoPushClient({ accessToken: null, fetch: (async () => Promise.reject(fetchFailure('ECONNRESET'))) as unknown as typeof fetch });
    expect(await reset.send([message])).toEqual({ type: 'unknown', code: 'ECONNRESET' });

    const timeout = Object.assign(new Error('Zeit abgelaufen'), { name: 'TimeoutError' });
    const slow = createExpoPushClient({ accessToken: null, fetch: (async () => Promise.reject(timeout)) as unknown as typeof fetch });
    expect(await slow.send([message])).toEqual({ type: 'unknown', code: 'zeitueberschreitung' });
  });

  it('Expo lehnt die ganze Anfrage ab: 429 und 5xx wiederholbar, andere 4xx nicht', async () => {
    const statusOutcome = (status: number) =>
      createExpoPushClient({ accessToken: null, fetch: fetchReturning(() => json(status, { errors: [{ code: 'X' }] })).fetchImpl }).send([message]);
    expect(await statusOutcome(429)).toEqual({ type: 'not_sent', retryable: true, code: 'http_429' });
    expect(await statusOutcome(503)).toEqual({ type: 'not_sent', retryable: true, code: 'http_503' });
    expect(await statusOutcome(400)).toEqual({ type: 'not_sent', retryable: false, code: 'http_400' });
    expect(await statusOutcome(401)).toEqual({ type: 'not_sent', retryable: false, code: 'http_401' });
  });

  it('eine unlesbare Antwort oder falsche Ticketzahl gilt als unbekannter Ausgang', async () => {
    const outcome = (respond: () => Response) => createExpoPushClient({ accessToken: null, fetch: fetchReturning(respond).fetchImpl }).send([message]);
    expect(await outcome(() => new Response('kein json', { status: 200 }))).toMatchObject({ type: 'unknown' });
    expect(await outcome(() => json(200, { data: [] }))).toEqual({ type: 'unknown', code: 'antwort_ungueltig' });
    expect(await outcome(() => json(200, { data: [{ status: 'vielleicht' }] }))).toEqual({ type: 'unknown', code: 'antwort_ungueltig' });
  });

  it('mehr als 100 Nachrichten je Anfrage sind ein Programmierfehler', async () => {
    const { calls, fetchImpl } = fetchReturning(() => json(200, { data: [] }));
    await expect(createExpoPushClient({ accessToken: null, fetch: fetchImpl }).send(Array.from({ length: 101 }, () => message))).rejects.toThrow(/100/);
    expect(calls).toEqual([]);
  });
});

describe('Expo-Push-Adapter: Quittungen', () => {
  it('ruft Quittungen zu Ticket-IDs ab; fehlende IDs bleiben fehlend', async () => {
    const { calls, fetchImpl } = fetchReturning(() =>
      json(200, { data: { a: { status: 'ok' }, b: { status: 'error', message: 'weg', details: { error: 'DeviceNotRegistered' } }, fremd: { status: 'ok' } } }),
    );

    const outcome = await createExpoPushClient({ accessToken: 'geheim', fetch: fetchImpl }).getReceipts(['a', 'b', 'c']);

    expect(outcome).toEqual({
      type: 'receipts',
      receipts: { a: { status: 'ok' }, b: { status: 'error', message: 'weg', details: { error: 'DeviceNotRegistered' } } },
    });
    expect(calls[0]!.url).toBe('https://exp.host/--/api/v2/push/getReceipts');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ ids: ['a', 'b', 'c'] });
    expect(calls[0]!.init.headers).toMatchObject({ authorization: 'Bearer geheim' });
  });

  it('meldet Netz- und HTTP-Fehler als gescheiterten Abruf', async () => {
    const failing = createExpoPushClient({ accessToken: null, fetch: (async () => Promise.reject(fetchFailure('ECONNRESET'))) as unknown as typeof fetch });
    expect(await failing.getReceipts(['a'])).toEqual({ type: 'failed', code: 'ECONNRESET' });
    const rejected = createExpoPushClient({ accessToken: null, fetch: fetchReturning(() => json(503, {})).fetchImpl });
    expect(await rejected.getReceipts(['a'])).toEqual({ type: 'failed', code: 'http_503' });
  });
});
