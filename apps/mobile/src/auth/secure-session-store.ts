import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

import type { LogoutStore } from '../logout/logout';
import type { SessionStore } from './app-auth';

// Sitzungsdaten ausschließlich in SecureStore (Spezifikation 0, Abschnitt 9): auf iOS im Schlüsselbund,
// auf Android in SharedPreferences, verschlüsselt mit dem Android-Keystore
// (https://docs.expo.dev/versions/v58.0.0/sdk/securestore/). Daneben liegt der Stand einer begonnenen
// Abmeldung, denn er trägt das Sitzungstoken. `AFTER_FIRST_UNLOCK` hält den Eintrag
// nach dem ersten Entsperren lesbar, damit auch `pushNow` im Health-Hintergrundimport die Sitzung
// findet; ob das auf beiden Geräten gilt, prüft der Gerätetest (#102).

const KEY = 'abnehm.sitzung';
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

const Stored = z.strictObject({ accountId: z.string().min(1), token: z.string().min(1).nullable() });

/** Liest einen JSON-Eintrag; fehlende und unlesbare Einträge ergeben `null`. */
async function readJson<T>(key: string, schema: z.ZodType<T>): Promise<T | null> {
  const raw = await SecureStore.getItemAsync(key, options);
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  return schema.safeParse(value).data ?? null;
}

export const secureSessionStore: SessionStore = {
  // Unlesbare Einträge gelten als „abgemeldet“; die nächste Anmeldung überschreibt sie.
  read: () => readJson(KEY, Stored),
  write: (session) => SecureStore.setItemAsync(KEY, JSON.stringify(session), options),
  clear: () => SecureStore.deleteItemAsync(KEY, options),
};

// Stand einer begonnenen Abmeldung neben der Sitzung: Er trägt den Ausweis mit dem Sitzungstoken, das ein
// Retry nach dem Widerruf vorlegt (Abmeldemodul, `src/logout/`).
const LOGOUT_KEY = 'abnehm.abmeldung';

const StoredLogout = z.strictObject({
  phase: z.enum(['logout_pending', 'cleanup_pending']),
  revocation: z.strictObject({ accountId: z.string().min(1), requestId: z.string().min(1), token: z.string().min(1) }),
});

export const secureLogoutStore: LogoutStore = {
  // Ein unlesbarer Eintrag gilt als keine Abmeldung; die Sitzung selbst bleibt unberührt.
  read: () => readJson(LOGOUT_KEY, StoredLogout),
  write: (record) => SecureStore.setItemAsync(LOGOUT_KEY, JSON.stringify(record), options),
  clear: () => SecureStore.deleteItemAsync(LOGOUT_KEY, options),
};
