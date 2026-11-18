// Sichtbare Texte und zugängliche Namen rund um die Erlaubnis für Mitteilungen (Spezifikation 5,
// Abschnitte 6 und 8). Erklärtext, „Erlauben“, „Später“, „Mitteilungen sind erlaubt“, „In den
// Systemeinstellungen erlauben“ und „Aus“ stehen dort wörtlich; die übrigen Sätze sind eigene
// Formulierungen im Ton des Design-Systems.

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
} as const;
