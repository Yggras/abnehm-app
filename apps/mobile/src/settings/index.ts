// Einstellungen von Spezifikation 5 (Abschnitt 6): Übersicht hinter dem Zahnrad und „Konto“. Die
// Routendateien unter `app/settings/` liefern die Bildschirme; der Composition Root setzt die Rollen
// von Auth-Modul, Abmeldemodul und eigenem Anzeigenamen zu `AccountPorts` zusammen.
export { AccountProvider, type AccountPorts } from './AccountProvider';
export { AccountScreen } from './AccountScreen';
/** „Abmelden“ samt Bestätigung, auch für den Sperrbildschirm unter 18 im Onboarding (#141). */
export { LogoutArea } from './LogoutArea';
export { NotificationsScreen } from './NotificationsScreen';
export { PartnerSharingScreen } from './PartnerSharingScreen';
export { followOwnDisplayName, type OwnDisplayName, type RenameResult } from './own-display-name';
export { SettingsOverview } from './SettingsOverview';
