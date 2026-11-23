import type { ImportOrigin } from '@abnehm/contracts/trackers';

import { settingsTexts } from '../settings/texts';

// Sichtbare Texte und zugängliche Namen rund um die Verbindung mit Apple Health bzw. Health Connect
// (Spezifikation 3, Abschnitt 6, https://github.com/Yggras/abnehm-app/issues/86): Onboarding-Schritt `health`
// (#189) und, wiederverwendet, die Einstellungsseite Health (#190). Erklärtext, „Verbinden“, „Noch keine
// Trainings oder Gewichte gefunden“, „Fitbit-Daten fehlen?“ und die Menüwege der Anleitungen stehen dort
// wörtlich; die übrigen Sätze sind eigene Formulierungen im Ton des Design-Systems.

/** Name der Zeile in der Einstellungsübersicht je Herkunft. */
const settingsRow: Record<ImportOrigin, string> = { apple_health: settingsTexts.health.ios, health_connect: settingsTexts.health.android };

export const healthTexts = {
  explanation: 'Wir lesen nur Trainings und Gewicht. Wir schreiben nichts zurück.',
  connect: 'Verbinden',
  next: 'Weiter',
  /**
   * Health Connect fehlt unter Android 13 und älter und kommt aus dem Play Store
   * (https://developer.android.com/health-and-fitness/guides/health-connect/develop/get-started).
   */
  installationNeeded: 'Health Connect ist noch nicht installiert. Installiere es aus dem Play Store und tippe dann noch einmal auf „Verbinden“.',
  /**
   * Die Seite `settings` mit `section: "health"` holt die Verbindung nach (#190). In der Übersicht heißt ihre
   * Zeile wie die Plattform (`settingsTexts.health`, `SettingsOverview`).
   */
  connectFailed: (origin: ImportOrigin) =>
    `Das Verbinden hat gerade nicht geklappt. Versuch es noch einmal oder später unter Einstellungen › ${settingsRow[origin]}.`,
  sourceAppsTitle: (days: number) => `Quell-Apps der letzten ${days} Tage`,
  sourceAppsLoading: 'Quell-Apps werden geprüft',
  /** Neutral, weil iOS eine Verweigerung nicht erkennen lässt und es dann aussieht, als gäbe es keine Daten. */
  noData: 'Noch keine Trainings oder Gewichte gefunden',
  checkFailed: 'Die Quell-Apps lassen sich gerade nicht prüfen.',
  guideTitle: 'Fitbit-Daten fehlen?',
  guide: {
    /**
     * Menüweg aus Spezifikation 3, Abschnitt 6 (auf dem Gerät belegt, Spike). Der letzte Satz stammt aus dem
     * Gerätetest zu #193 (https://github.com/Yggras/abnehm-app/pull/334, „Gerätetest“, Punkt 5): Auf einem neuen
     * iPhone kamen Daten erst nach Trennen und neuem Verbinden der Partner-App an.
     */
    apple_health:
      'Die Kopplung von Uhr und Google Health genügt nicht. Richte zusätzlich in Google Health unter Profil › Partner apps › Apple Health die Verbindung ein. Ist Apple Health dort schon verbunden, trenne die Verbindung und verbinde neu.',
    /**
     * Menüweg aus der Google-Health-Hilfe (https://support.google.com/googlehealth/answer/14506680). Die deutschen
     * Menünamen bestätigt erst der Gerätetest des Health-Connect-Adapters (#195); bis dahin englisch wie dort.
     */
    health_connect: 'Schalte in Google Health unter Connections › Partner apps › Sync your favorite health apps die Freigabe nach Health Connect ein.',
  } satisfies Record<ImportOrigin, string>,
  /** Trainings und Gewichte einer Quell-App, etwa „2 Trainings · 1 Gewicht“. */
  sourceAppCounts(workouts: number, weights: number): string {
    const parts = [];
    if (workouts > 0) parts.push(`${workouts} ${workouts === 1 ? 'Training' : 'Trainings'}`);
    if (weights > 0) parts.push(`${weights} ${weights === 1 ? 'Gewicht' : 'Gewichte'}`);
    return parts.join(' · ');
  },
} as const;
