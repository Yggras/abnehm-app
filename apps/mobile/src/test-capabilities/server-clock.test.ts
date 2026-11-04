import { Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';

import { createAppTestClock } from './clock';
import { createFaultController, faultyFetch } from './faults';
import { applyRuntimeProfile } from './profiles';
import { fetchFollowingServerClock } from './server-clock';

// Nachweis für #271: Die Serveruhr des Development-Backends folgt jeder Stellung der Testuhr, sofort
// oder vor der nächsten Anfrage, wenn das Netz fehlte. Das Backend steht hier als aufzeichnendes `fetch`.

const baseUrl = 'https://backend.test';
const manifestClock = { instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') };
/** Geräteuhr vor dem Seed: ein anderer Tag als die Uhr des Manifests. */
const deviceClock = { read: () => ({ instant: Instant.parse('2026-11-04T10:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin'), localDate: LocalDate.parse('2026-11-04'), utcOffsetMinutes: 60 }) };

/** Ein Backend, das jede Anfrage aufzeichnet; `online = false` ist ein echter Netzausfall. */
function backend() {
  const state = { online: true, requests: [] as string[], serverClock: null as string | null, clockStatus: 204 };
  const fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!state.online) throw new TypeError('Network request failed');
    const path = String(input).slice(baseUrl.length);
    if (path === '/dev/uhr') {
      state.requests.push(`uhr ${(JSON.parse(String(init?.body)) as { instant: string }).instant}`);
      if (state.clockStatus === 204) state.serverClock = (JSON.parse(String(init?.body)) as { instant: string }).instant;
      return new Response(null, { status: state.clockStatus });
    }
    state.requests.push(path);
    return new Response('{}', { status: 200 });
  });
  return { state, fetch };
}

/** Wartet, bis angestoßene Anfragen durch sind. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Serveruhr folgt der Testuhr', () => {
  it('ohne Stellen der Testuhr bleibt die Serveruhr unberührt', async () => {
    const server = backend();
    const clock = createAppTestClock(deviceClock);
    const fetch = fetchFollowingServerClock(server.fetch, { clock, baseUrl });

    await fetch(`${baseUrl}/v1/status`);

    expect(server.state.requests).toEqual(['/v1/status']);
  });

  it('stellt die Serveruhr sofort, wenn die Testuhr steht oder vorgestellt wird', async () => {
    const server = backend();
    const clock = createAppTestClock(deviceClock);
    fetchFollowingServerClock(server.fetch, { clock, baseUrl });

    clock.fix(manifestClock);
    await settled();
    clock.adjust({ advanceHours: 25 });
    await settled();

    expect(server.state.requests).toEqual(['uhr 2026-10-14T12:00:00.000Z', 'uhr 2026-10-15T13:00:00.000Z']);
  });

  it('folgt auch Laufzeitprofilen und Reisen; eine neue Zone schickt denselben Zeitpunkt', async () => {
    const server = backend();
    const clock = createAppTestClock(deviceClock);
    fetchFollowingServerClock(server.fetch, { clock, baseUrl });
    clock.fix(manifestClock);
    await settled();

    applyRuntimeProfile('uhr-ungesichert-24h', { faults: createFaultController(), clock });
    await settled();
    clock.adjust({ timeZone: TimeZone.parse('Pacific/Kiritimati') });
    await settled();

    expect(server.state.requests.slice(1)).toEqual(['uhr 2026-10-15T13:00:00.000Z', 'uhr 2026-10-15T13:00:00.000Z']);
  });

  it('gestellte Fehler gelten der App, nicht der Serveruhr: Sie folgt auch im Transport-Fehlermodus', async () => {
    const server = backend();
    const clock = createAppTestClock(deviceClock);
    const faults = createFaultController({ transport: 'offline' });
    const fetch = faultyFetch(fetchFollowingServerClock(server.fetch, { clock, baseUrl }), faults);

    clock.fix(manifestClock);
    await settled();

    await expect(fetch(`${baseUrl}/v1/sync/push`)).rejects.toThrow('Network request failed');
    expect(server.state.serverClock).toBe('2026-10-14T12:00:00.000Z');
    expect(server.state.requests).toEqual(['uhr 2026-10-14T12:00:00.000Z']);
  });

  it('ohne Netz holt die nächste Anfrage das Stellen nach, bevor sie selbst gesendet wird', async () => {
    const server = backend();
    const clock = createAppTestClock(deviceClock);
    const fetch = fetchFollowingServerClock(server.fetch, { clock, baseUrl });
    clock.fix(manifestClock);
    await settled();
    server.state.online = false;

    clock.adjust({ advanceHours: 25 });
    await settled();
    await expect(fetch(`${baseUrl}/v1/sync/push`)).rejects.toThrow('Network request failed');

    server.state.online = true;
    await fetch(`${baseUrl}/v1/sync/push`);
    await fetch(`${baseUrl}/v1/sync/pull`);

    expect(server.state.requests).toEqual(['uhr 2026-10-14T12:00:00.000Z', 'uhr 2026-10-15T13:00:00.000Z', '/v1/sync/push', '/v1/sync/pull']);
  });

  it('gleichzeitige Anfragen warten auf genau ein Stellen', async () => {
    const server = backend();
    const clock = createAppTestClock(deviceClock);
    const fetch = fetchFollowingServerClock(server.fetch, { clock, baseUrl });
    server.state.online = false;
    clock.fix(manifestClock);
    await settled();
    server.state.online = true;

    await Promise.all([fetch(`${baseUrl}/v1/sync/push`), fetch(`${baseUrl}/v1/status`)]);

    expect(server.state.requests).toEqual(['uhr 2026-10-14T12:00:00.000Z', '/v1/sync/push', '/v1/status']);
  });

  it('eine Stellung während des Sendens schickt die Anfrage erst nach dem neuen Zeitpunkt los', async () => {
    const server = backend();
    const clock = createAppTestClock(deviceClock);
    const fetch = fetchFollowingServerClock(server.fetch, { clock, baseUrl });

    clock.fix(manifestClock);
    clock.adjust({ advanceHours: 1 });
    await fetch(`${baseUrl}/v1/status`);

    expect(server.state.requests.at(-2)).toBe('uhr 2026-10-14T13:00:00.000Z');
    expect(server.state.requests.at(-1)).toBe('/v1/status');
  });

  it('lehnt das Backend das Stellen ab, geht die Anfrage trotzdem durch; die nächste versucht es erneut', async () => {
    const server = backend();
    const clock = createAppTestClock(deviceClock);
    const fetch = fetchFollowingServerClock(server.fetch, { clock, baseUrl });
    server.state.clockStatus = 404;
    clock.fix(manifestClock);
    await settled();

    expect((await fetch(`${baseUrl}/v1/status`)).status).toBe(200);
    server.state.clockStatus = 204;
    await fetch(`${baseUrl}/v1/status`);

    expect(server.state.requests).toEqual(['uhr 2026-10-14T12:00:00.000Z', 'uhr 2026-10-14T12:00:00.000Z', '/v1/status', 'uhr 2026-10-14T12:00:00.000Z', '/v1/status']);
    expect(server.state.serverClock).toBe('2026-10-14T12:00:00.000Z');
  });
});
