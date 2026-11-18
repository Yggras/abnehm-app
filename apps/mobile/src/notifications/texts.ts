// Sichtbare Texte und zugängliche Namen rund um die Erlaubnis für Mitteilungen und die Seite
// „Benachrichtigungen“ (Spezifikation 5, Abschnitte 6 und 8). Erklärtext, „Erlauben“, „Später“,
// „Mitteilungen sind erlaubt“, „In den Systemeinstellungen erlauben“, „Aus“, „Mittags“, „Abends“, „In
// Check-ins berücksichtigen“, „Partner-Pushes“ samt Untertitel, der Hinweis zur Reihenfolge und der
// Infotext stehen dort wörtlich; die übrigen Sätze sind eigene Formulierungen im Ton des Design-Systems.

export const notificationTexts = {
  explanation: 'Momo meldet sich höchstens zweimal am Tag – und nur, wenn noch etwas offen ist. Dein Partner kann dich anfeuern.',
  allow: 'Erlauben',
  later: 'Später',
  next: 'Weiter',
  granted: 'Mitteilungen sind erlaubt',
  denied: 'Mitteilungen sind aus. Erlauben kannst du sie jederzeit in den Systemeinstellungen.',
  undetermined: 'Mitteilungen sind noch nicht erlaubt.',
  openSystemSettings: 'In den Systemeinstellungen erlauben',
  loading: 'Erlaubnis für Mitteilungen wird geprüft',
  /** Untertitel der Zeile „Benachrichtigungen“ in der Übersicht, wenn Mitteilungen nicht erlaubt sind. */
  overviewOff: 'Aus',
  systemStatusTitle: 'Mitteilungen',

  /** Seite „Benachrichtigungen“ (#132). */
  settings: {
    checkInsTitle: 'Tages-Check-ins',
    midday: 'Mittags',
    evening: 'Abends',
    middayTime: 'Uhrzeit mittags',
    eveningTime: 'Uhrzeit abends',
    order: 'Der Abend-Check-in muss nach dem Mittag-Check-in liegen',
    trackersTitle: 'In Check-ins berücksichtigen',
    trackers: { ernaehrung: 'Ernährung', wasser: 'Wasser', sport: 'Sport', gewicht: 'Gewicht' },
    partnerTitle: 'Partner',
    partnerPushes: 'Partner-Pushes',
    partnerPushesSubtitle: 'Anfeuern, Challenge-Vorschläge, Insel-Meilensteine und gemeinsame Vorgänge',
    info: 'Keine Ruhezeiten und keine besonderen Wochenendzeiten.',
    save: 'Speichern',
    loading: 'Benachrichtigungen werden geladen',
    /** Rückfrage beim Verlassen mit ungesicherten Änderungen (Impeccable-Prüfung, #132). */
    leave: {
      title: 'Änderungen speichern?',
      text: 'Deine Änderungen an den Benachrichtigungen sind noch nicht gespeichert.',
      stay: 'Weiter bearbeiten',
      discard: 'Verwerfen',
    },
  },
} as const;
