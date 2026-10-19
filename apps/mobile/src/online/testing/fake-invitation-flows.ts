import { EntityId, Instant } from '@abnehm/contracts/base';
import type { AcceptInvitationResult, CheckInvitationResult, CreateInvitationResult } from '@abnehm/contracts/coupling';

import type { InvitationFlows, OnlineResult } from '../invitation-flows';

// Online-Test-Adapter der Einladungsabläufe (#103) für Komponententests, etwa der Bildschirme
// `partner.invite` und `partner.redeem` (Spezifikation 5). Ohne Vorgabe gelingt jeder Aufruf; `respond`
// legt die nächsten Ausgänge je Ablauf fest, `hold` hält den nächsten Aufruf bis zur Freigabe an.

type Method = keyof InvitationFlows;
type Values = { createCode: CreateInvitationResult; checkCode: CheckInvitationResult; acceptCode: AcceptInvitationResult };

/** Was ein Aufruf erhielt; `requestId` nur bei Erzeugen und Annehmen. */
export type FakeInvitationCall = Readonly<{ method: Method; requestId?: EntityId; code?: string }>;

export type FakeInvitationFlows = InvitationFlows & {
  readonly calls: readonly FakeInvitationCall[];
  /** Erfolgreiche Werte, die ohne Vorgabe zurückkommen. */
  readonly defaults: Values;
  /** Die nächsten Ausgänge des Ablaufs in Reihenfolge; ein `Error` wird geworfen. */
  respond<M extends Method>(method: M, ...outcomes: (OnlineResult<Values[M]> | Error)[]): void;
  /** Hält den nächsten Aufruf des Ablaufs an; die zurückgegebene Funktion gibt ihn frei. */
  hold(method: Method): () => void;
};

export function fakeInvitationFlows(): FakeInvitationFlows {
  const defaults: Values = {
    createCode: { code: '482915', expiresAt: Instant.parse('2026-10-15T12:00:00.000Z') },
    checkCode: { inviterDisplayName: 'Philipp', reactivates: false },
    acceptCode: { couplingId: EntityId.parse('5d1c7e3a-2b4f-4a8e-b6c1-3e9f0a7d5c01'), reactivated: false },
  };
  const calls: FakeInvitationCall[] = [];
  const queued: { [M in Method]: (OnlineResult<Values[M]> | Error)[] } = { createCode: [], checkCode: [], acceptCode: [] };
  const held: { [M in Method]: Promise<void>[] } = { createCode: [], checkCode: [], acceptCode: [] };

  async function answer<M extends Method>(method: M, call: Omit<FakeInvitationCall, 'method'>): Promise<OnlineResult<Values[M]>> {
    calls.push({ method, ...call });
    const gate = held[method].shift();
    if (gate !== undefined) await gate;
    const outcome = queued[method].shift() as OnlineResult<Values[M]> | Error | undefined;
    if (outcome instanceof Error) throw outcome;
    return outcome ?? { type: 'ok', value: defaults[method] };
  }

  return {
    calls,
    defaults,
    respond(method, ...outcomes) {
      (queued[method] as unknown[]).push(...outcomes);
    },
    hold(method) {
      let release = () => {};
      held[method].push(new Promise<void>((resolve) => (release = resolve)));
      return () => release();
    },
    createCode: (requestId) => answer('createCode', { requestId }),
    checkCode: (code) => answer('checkCode', { code }),
    acceptCode: (requestId, code) => answer('acceptCode', { requestId, code }),
  };
}
