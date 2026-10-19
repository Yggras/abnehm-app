import type {
  AcceptInvitationResult,
  CheckInvitationResult,
  CreateInvitationResult,
  InvitationErrorCode,
  InviteCode,
} from '@abnehm/contracts/coupling';

import { requiredBackendBaseUrl } from '../backend/client';
import { createInvitationFlows, type InvitationFlows, type SyncTrigger } from './invitation-flows';
import { useOnlineFlows } from './OnlineFlowsProvider';
import { useOnlineFlow, type FlowState } from './use-online-flow';

// Modul für Online-Abläufe der App (Spezifikation 0, Abschnitt 9; #103): kurzlebige Abläufe, die nicht
// zum Fach-Sync gehören, zuerst Einladung, Code prüfen und Annahme; Fotoanalyse und Partnerfoto-Abruf
// kommen hier hinzu. Bildschirme kennen nur diese Hooks. TanStack Query bleibt im Modul (Lint-Regel
// `abnehm/bibliotheksgrenzen`); Fachdaten landen per Pull in SQLite und werden dort beobachtet.
export type { FlowState } from './use-online-flow';
export type { InvitationFlows, InvitationResult, SyncTrigger } from './invitation-flows';
export type { OnlineResult } from './online-result';
export { OnlineFlowsProvider } from './OnlineFlowsProvider';

/** Die Abläufe des Geräts: `fetch` des Auth-Moduls (Sitzung, Sperre bei `401`) und der Sync des Kontos. */
export function createDeviceInvitationFlows({ fetch, sync }: { fetch: typeof globalThis.fetch; sync: SyncTrigger }): InvitationFlows {
  return createInvitationFlows({ baseUrl: requiredBackendBaseUrl(), fetch, sync });
}

const sameIntent = () => 'einladung';
const byCode = (code: InviteCode) => code;

/** „Code erzeugen“ für `partner.invite`; ein erneutes `create` nach dem Erfolg erzeugt einen neuen Code. */
export function useCreateInvitationCode(): { state: FlowState<CreateInvitationResult, InvitationErrorCode>; create(): void; reset(): void } {
  const { invitations } = useOnlineFlows();
  const { state, start, reset } = useOnlineFlow((_: void, requestId) => invitations.createCode(requestId), sameIntent);
  return { state, create: () => start(undefined), reset };
}

/** „Code prüfen“ für die Bestätigungsansicht von `partner.redeem`; verbraucht den Code nicht. */
export function useCheckInvitationCode(): { state: FlowState<CheckInvitationResult, InvitationErrorCode>; check(code: InviteCode): void; reset(): void } {
  const { invitations } = useOnlineFlows();
  const { state, start, reset } = useOnlineFlow((code: InviteCode) => invitations.checkCode(code), byCode);
  return { state, check: start, reset };
}

/**
 * „Koppeln“: nimmt an und holt die Kopplung per Pull. Ob die Kopplung steht, liest der Bildschirm aus
 * SQLite; das Ergebnis hier nennt nur, ob reaktiviert wurde.
 */
export function useAcceptInvitation(): { state: FlowState<AcceptInvitationResult, InvitationErrorCode>; accept(code: InviteCode): void; reset(): void } {
  const { invitations } = useOnlineFlows();
  const { state, start, reset } = useOnlineFlow((code: InviteCode, requestId) => invitations.acceptCode(requestId, code), byCode);
  return { state, accept: start, reset };
}
