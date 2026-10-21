import { createHmac } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { canonicalJson } from '../canonical-json.ts';
import type { DbExecutor } from '../database.ts';
import { onlineRequest } from '../db/schema/index.ts';
import type { OnlineFlow } from './flows.ts';

// Idempotenz der Online-Abläufe (Spezifikation 0, Abschnitt 9). Das Ergebnis eines erfolgreichen
// Ablaufs liegt unter der clientseitigen `requestId`, gebunden an Konto, Ablaufart und Hash der
// Anfrage. Ablehnungen werden nicht gespeichert: Ein Retry rechnet sie neu, sonst bliebe etwa eine
// vorübergehende Begrenzung an der `requestId` hängen.

export type OnlineRequestBinding = Readonly<{ requestId: string; accountId: string; flow: OnlineFlow; requestHash: string }>;

/**
 * Bindung einer Anfrage an Konto und Ablaufart. Der Inhalt geht als HMAC der kanonischen Anfrage ein,
 * mit dem Schlüssel des Ablaufs: So steht ein enthaltener Code (eine Million Möglichkeiten) nie
 * durchprobierbar in der Datenbank.
 */
export function onlineRequestBinding({
  hashKey,
  accountId,
  flow,
  request,
}: {
  hashKey: string;
  accountId: string;
  flow: OnlineFlow;
  request: { requestId: string };
}): OnlineRequestBinding {
  return { requestId: request.requestId, accountId, flow, requestHash: onlineRequestHash({ hashKey, flow, request }) };
}

/** Der Schlüssel-Hash einer Anfrage allein, ohne Konto; so bindet das Abmelden an die Sitzung. */
export function onlineRequestHash({ hashKey, flow, request }: { hashKey: string; flow: OnlineFlow; request: { requestId: string } }): string {
  return createHmac('sha256', hashKey).update(`anfrage:${flow}:${canonicalJson(request)}`).digest('hex');
}

export type StoredOnlineResult =
  | Readonly<{ type: 'none' }>
  | Readonly<{ type: 'stored'; result: Record<string, unknown> }>
  /** Dieselbe `requestId` mit anderem Inhalt oder anderer Ablaufart desselben Kontos. */
  | Readonly<{ type: 'conflict' }>
  /** Die `requestId` gehört einem anderen Konto; die Antwort verrät davon nichts. */
  | Readonly<{ type: 'foreign' }>;

export async function storedOnlineResult(executor: DbExecutor, binding: OnlineRequestBinding): Promise<StoredOnlineResult> {
  const stored = await storedOnlineRequest(executor, binding.requestId);
  if (stored === null) return { type: 'none' };
  if (stored.accountId !== binding.accountId) return { type: 'foreign' };
  if (stored.flow !== binding.flow || stored.requestHash !== binding.requestHash) return { type: 'conflict' };
  return { type: 'stored', result: stored.result };
}

/**
 * Die gespeicherte Anfrage zur `requestId` samt Bindung, ohne Prüfung. Für Abläufe, deren Hash-Schlüssel
 * selbst bindet: Beim Abmelden ist es die vorgelegte, womöglich schon widerrufene Sitzung.
 */
export async function storedOnlineRequest(executor: DbExecutor, requestId: string) {
  const [stored] = await executor.select().from(onlineRequest).where(eq(onlineRequest.requestId, requestId));
  return stored ?? null;
}

/**
 * Hält das Ergebnis in der Transaktion des Ablaufs fest. Schreibt eine gleichzeitige identische Anfrage
 * zuerst, scheitert diese Transaktion am Primärschlüssel; der Aufrufer wiederholt und findet das Ergebnis.
 */
export async function storeOnlineResult(executor: DbExecutor, binding: OnlineRequestBinding, result: Record<string, unknown>, at: Date) {
  await executor.insert(onlineRequest).values({ ...binding, result, createdAt: at });
}
