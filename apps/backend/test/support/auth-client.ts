import { asc } from 'drizzle-orm';

import { securityLog } from '../../src/db/schema/index.ts';
import { testBaseUrl, type TestBackend } from './app.ts';

/** Ein Gerät aus Sicht des Backends: eigene Quelladresse und eigenes Sitzungstoken. */
export type Device = { ip: string; token?: string };

let nextIp = 1;
/** Jedes Gerät erhält eine eigene Adresse, damit die Begrenzung pro IP nur greift, wo ein Test es will. */
export function newDevice(): Device {
  const n = nextIp++;
  return { ip: `198.51.${Math.floor(n / 250) % 250}.${(n % 250) + 1}` };
}

export type Reply = { status: number; body: unknown; headers: Headers };

/** Was `call` braucht: die echte App oder eine Test-App mit derselben Autorisierung. */
type Requestable = { app: { request(input: string, init: RequestInit): Response | Promise<Response> } };

/**
 * HTTP-Aufruf an die echte Hono-App, mit `X-Forwarded-For` und optional `Authorization: Bearer`. Ein
 * `FormData`-Body geht als `multipart/form-data`, jeder andere als JSON.
 */
export async function call(backend: Requestable, method: 'GET' | 'POST' | 'DELETE', path: string, device: Device, body?: unknown): Promise<Reply> {
  const headers = new Headers({ 'x-forwarded-for': device.ip });
  if (device.token !== undefined) headers.set('authorization', `Bearer ${device.token}`);
  const form = body instanceof FormData;
  if (body !== undefined && !form) headers.set('content-type', 'application/json');
  const response = await backend.app.request(`${testBaseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  const text = await response.text();
  const json = response.headers.get('content-type')?.includes('application/json') === true;
  return { status: response.status, body: text === '' ? null : json ? (JSON.parse(text) as unknown) : text, headers: response.headers };
}

export const defaultPassword = 'lange-sichere-passphrase';

/** Registriert ein Konto; das Gerät ist danach angemeldet. Liefert die Konto-ID. */
export async function signUp(backend: TestBackend, email: string, device: Device = newDevice(), password = defaultPassword) {
  const reply = await call(backend, 'POST', '/v1/auth/sign-up/email', device, { email, password, name: '' });
  if (reply.status !== 200) throw new Error(`Registrierung fehlgeschlagen: ${reply.status} ${JSON.stringify(reply.body)}`);
  const { token, user } = reply.body as { token: string; user: { id: string } };
  device.token = token;
  return { accountId: user.id, device };
}

/** Meldet ein (neues) Gerät an; liefert die Antwort und setzt bei Erfolg das Token. */
export async function signIn(backend: TestBackend, email: string, password: string, device: Device = newDevice()) {
  const reply = await call(backend, 'POST', '/v1/auth/sign-in/email', device, { email, password });
  if (reply.status === 200) device.token = (reply.body as { token: string }).token;
  return { reply, device };
}

/** Ob die Sitzung des Geräts gilt, geprüft wie ein Fach-Endpunkt. */
export async function sessionIsValid(backend: TestBackend, device: Device) {
  return (await backend.auth.sessions.authenticate(new Headers({ authorization: `Bearer ${device.token ?? ''}` }))) !== null;
}

/** Alle Einträge des Sicherheitslogs in Schreibreihenfolge. */
export async function securityLogEntries(backend: TestBackend) {
  const rows = await backend.database.db.select().from(securityLog).orderBy(asc(securityLog.occurredAt));
  return rows.map(({ eventType, accountId, details }) => ({ eventType, accountId, details }));
}
