import { ServerClockRequest, serverClockRoutePath } from '@abnehm/contracts/seeds';

import type { AppTestClock } from './clock';

// Serveruhr folgt der Testuhr (#271): Nach jedem Stellen der Testuhr (Seed, Uhr-Link, Laufzeitprofil)
// stellt die App die steuerbare Serveruhr des Development-Backends auf ihren Zeitpunkt
// (`POST /dev/uhr`). Sie versucht es sofort; scheitert das, etwa im Flugmodus, holt die nächste
// Anfrage an das Backend es nach, bevor sie selbst gesendet wird. So rechnet der Server bei jedem
// Sync mit derselben Zeit wie die App. Ohne Stellen der Testuhr bleibt die Serveruhr unberührt.
//
// Die Hülle liegt unter den Fehler-Adaptern: Gestellte Fehler (`fehler?transport=offline`) gelten der
// App, nicht der Testinfrastruktur, deshalb erreicht das sofortige Stellen den Server auch dann. Nur ein
// echter Netzausfall verschiebt es auf die nächste Anfrage.

/** `fetch` der App-Sitzung, vor dem die Serveruhr der Testuhr folgt. Einmal je Sitzung anlegen. */
export function fetchFollowingServerClock(inner: typeof fetch, { clock, baseUrl }: { clock: AppTestClock; baseUrl: string }): typeof fetch {
  /** Zähler der Stellungen der Testuhr und der letzten, die der Server übernommen hat. */
  let changes = 0;
  let followed = 0;
  let sending: Promise<boolean> | null = null;

  async function send(): Promise<boolean> {
    const change = changes;
    try {
      const response = await inner(`${baseUrl}${serverClockRoutePath}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ServerClockRequest.parse({ instant: clock.read().instant })),
      });
      if (response.status !== 204) return false;
      followed = Math.max(followed, change);
      return true;
    } catch {
      return false;
    }
  }

  /** Stellt die Serveruhr, bis sie der letzten Stellung folgt; ein Fehlschlag wartet auf die nächste Anfrage. */
  async function follow(): Promise<void> {
    while (followed < changes) {
      sending ??= send().finally(() => {
        sending = null;
      });
      if (!(await sending)) return;
    }
  }

  clock.subscribe(() => {
    changes += 1;
    void follow();
  });

  return async (input, init) => {
    await follow();
    return inner(input, init);
  };
}
