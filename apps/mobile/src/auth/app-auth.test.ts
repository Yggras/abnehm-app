import { createAppAuth, type StoredSession } from './app-auth';

// Die Sitzung reist nur als Bearer-Token: Kein Aufruf des Auth-Moduls lässt React Native Cookies
// speichern oder senden (`credentials: 'omit'`; sonst ist `withCredentials` in React Native an).

test('alle Aufrufe des Auth-Moduls verzichten auf Cookies', async () => {
  const calls: RequestInit[] = [];
  let stored: StoredSession | null = null;
  const auth = createAppAuth({
    baseUrl: 'https://backend.test',
    sessionStore: {
      read: async () => stored,
      write: async (session) => {
        stored = session;
      },
      clear: async () => {
        stored = null;
      },
    },
    accountData: { open: async () => undefined, lock: () => undefined },
    onError: (error) => {
      throw error;
    },
    fetch: async (_input, init) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({ token: 't', user: { id: 'konto' } }), { status: 200 });
    },
  });
  await auth.signIn({ email: 'philipp@example.test', password: 'egal-genug-lang' });
  await auth.checkSession();
  await auth.fetch('https://backend.test/v1/sync/pull', { method: 'POST' });
  expect(calls.map(({ credentials }) => credentials)).toEqual(['omit', 'omit', 'omit']);
});
