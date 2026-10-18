import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

import type { SessionStore } from './app-auth';

// Sitzungsdaten ausschließlich in SecureStore (Spezifikation 0, Abschnitt 9): auf iOS im Schlüsselbund,
// auf Android in SharedPreferences, verschlüsselt mit dem Android-Keystore
// (https://docs.expo.dev/versions/v58.0.0/sdk/securestore/). `AFTER_FIRST_UNLOCK` hält den Eintrag
// nach dem ersten Entsperren lesbar, damit auch `pushNow` im Health-Hintergrundimport die Sitzung
// findet; ob das auf beiden Geräten gilt, prüft der Gerätetest (#102).

const KEY = 'abnehm.sitzung';
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

const Stored = z.strictObject({ accountId: z.string().min(1), token: z.string().min(1).nullable() });

export const secureSessionStore: SessionStore = {
  async read() {
    const raw = await SecureStore.getItemAsync(KEY, options);
    if (raw === null) return null;
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
    // Unlesbare Einträge gelten als „abgemeldet“; die nächste Anmeldung überschreibt sie.
    return Stored.safeParse(value).data ?? null;
  },
  write: (session) => SecureStore.setItemAsync(KEY, JSON.stringify(session), options),
  clear: () => SecureStore.deleteItemAsync(KEY, options),
};
