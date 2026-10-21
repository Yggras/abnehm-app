// Abmeldemodul der App (Spezifikation 0, Abschnitt 9). Die Oberfläche unter „Konto“ (Spezifikation 5)
// kennt nur `Logout`; Bereiche melden lokale Bereinigungshaken über `onCleanup` an.
export {
  createLogout,
  syncBeforeLogout,
  type Logout,
  type LogoutCleanupHook,
  type LogoutRecord,
  type LogoutOutcome,
  type LogoutStore,
  type SyncBeforeLogout,
} from './logout';
