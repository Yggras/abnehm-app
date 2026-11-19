import type {
  ExpoPushError,
  ExpoPushMessage,
  ExpoPushPort,
  ExpoPushReceipt,
  ExpoPushTicket,
  ReceiptsOutcome,
  SendOutcome,
} from '../../src/notifications/expo-push.ts';

// Fake des Expo-Push-Ports (Spezifikation 5, Abschnitt 9 und Testing Decisions; #142), Testfähigkeit
// `fake-expo-push`: steuerbare Tickets, Quittungen, Verbindungs- und Teilfehler. Er lebt nur in Test- und
// Development-Artefakten; das produktive Backend kennt ausschließlich den HTTP-Adapter.

/** Marker, den das Produktions-Image nicht enthalten darf (`test/release-sperren.test.ts`). */
export const fakeExpoPushMarker = 'fake_expo_push';

/** Eine Sendeanfrage, wie der Fake sie gesehen hat, samt ihrem Ausgang. */
export type FakeSendRequest = Readonly<{ messages: readonly ExpoPushMessage[]; outcome: SendOutcome | 'absturz' }>;

export type FakeExpoPush = {
  port: ExpoPushPort;
  /** Jede Sendeanfrage in Reihenfolge, auch abgelehnte. */
  readonly requests: readonly FakeSendRequest[];
  /** Nachrichten aus Anfragen, die Expo erreicht haben können: mit Tickets, unbekanntem Ausgang oder Absturz. */
  reached(): ExpoPushMessage[];
  /** Jede Quittungsabfrage in Reihenfolge, mit ihren Ticket-IDs. */
  readonly receiptRequests: readonly (readonly string[])[];
  /**
   * Ausgang der nächsten Sendeanfrage statt der Tickets. Bei `absturz` kehrt `send` nie zurück: so, als
   * bräche der Prozess nach dem Absenden ab, bevor er die Antwort verarbeitet. Tests setzen danach mit
   * einem zweiten Backend über derselben Datenbank fort.
   */
  failNextSend(outcome: Exclude<SendOutcome, { type: 'tickets' }> | 'absturz'): void;
  /** Fehler-Ticket für die nächste Nachricht an dieses Token, etwa `DeviceNotRegistered`. */
  ticketErrorFor(token: string, error: string): void;
  /** Quittung zu den Tickets dieses Tokens; Standard ist `ok`, `fehlt` hält sie zurück. */
  receiptFor(token: string, receipt: string | 'ok' | 'fehlt'): void;
  /** Die nächste Quittungsabfrage scheitert. */
  failNextReceipts(code?: string): void;
};

const errorOf = (error: string): ExpoPushError => ({ status: 'error', message: `${fakeExpoPushMarker}: ${error}`, details: { error } });

export function createFakeExpoPush(): FakeExpoPush {
  const requests: FakeSendRequest[] = [];
  const receiptRequests: string[][] = [];
  const sendFailures: (Exclude<SendOutcome, { type: 'tickets' }> | 'absturz')[] = [];
  const receiptFailures: string[] = [];
  const ticketErrors = new Map<string, string[]>();
  const receiptsByToken = new Map<string, string>();
  const tokenOfTicket = new Map<string, string>();
  let nextTicket = 1;

  function ticketFor(message: ExpoPushMessage): ExpoPushTicket {
    const error = ticketErrors.get(message.to)?.shift();
    if (error !== undefined) return errorOf(error);
    const id = `${fakeExpoPushMarker}-ticket-${nextTicket++}`;
    tokenOfTicket.set(id, message.to);
    return { status: 'ok', id };
  }

  const port: ExpoPushPort = {
    async send(messages) {
      const failure = sendFailures.shift();
      if (failure === 'absturz') {
        requests.push({ messages, outcome: 'absturz' });
        return new Promise<never>(() => {});
      }
      const outcome: SendOutcome = failure ?? { type: 'tickets', tickets: messages.map(ticketFor) };
      requests.push({ messages, outcome });
      return outcome;
    },
    async getReceipts(ticketIds) {
      receiptRequests.push([...ticketIds]);
      const failure = receiptFailures.shift();
      if (failure !== undefined) return { type: 'failed', code: failure } satisfies ReceiptsOutcome;
      const receipts: Record<string, ExpoPushReceipt> = {};
      for (const id of ticketIds) {
        const token = tokenOfTicket.get(id);
        if (token === undefined) continue;
        const configured = receiptsByToken.get(token) ?? 'ok';
        if (configured === 'fehlt') continue;
        receipts[id] = configured === 'ok' ? { status: 'ok' } : errorOf(configured);
      }
      return { type: 'receipts', receipts };
    },
  };

  return {
    port,
    requests,
    reached: () => requests.filter(({ outcome }) => outcome === 'absturz' || outcome.type !== 'not_sent').flatMap(({ messages }) => messages),
    receiptRequests,
    failNextSend: (outcome) => void sendFailures.push(outcome),
    ticketErrorFor: (token, error) => void ticketErrors.set(token, [...(ticketErrors.get(token) ?? []), error]),
    receiptFor: (token, receipt) => void receiptsByToken.set(token, receipt),
    failNextReceipts: (code = 'http_503') => void receiptFailures.push(code),
  };
}
