// Einstellungen von Spezifikation 5 (Abschnitt 6): Übersicht hinter dem Zahnrad und „Konto“. Die
// Routendateien unter `app/settings/` liefern die Bildschirme; der Composition Root setzt die Rollen
// von Auth-Modul, Abmeldemodul und eigenem Anzeigenamen zu `AccountPorts` zusammen.
export { AccountProvider, type AccountPorts } from './AccountProvider';
export { AccountScreen } from './AccountScreen';
export { followOwnProfile, type OwnProfile, type RenameResult } from './own-profile';
export { SettingsOverview } from './SettingsOverview';
