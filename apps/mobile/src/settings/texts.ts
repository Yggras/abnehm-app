import type { PasswordRejection } from '../auth';

// Sichtbare Texte und zugängliche Namen der Einstellungen (Spezifikation 5, Abschnitt 6). Fehlertexte
// verraten nichts über Konten oder Prüfregeln des Servers und nennen immer den Lösungsweg.

export const settingsTexts = {
  groups: { plan: 'Dein Plan', together: 'Gemeinsam', dataAndAccount: 'Daten & Konto' },
  health: { ios: 'Apple Health', android: 'Health Connect' },
  emailUnknown: 'E-Mail ohne Verbindung nicht verfügbar',
  emailLoading: 'E-Mail wird geladen',
  /** Zugänglicher Name des Kopfs der Übersicht. */
  header: (name: string, email: string | null) => (email === null ? name : `${name}, ${email}`),

  account: {
    signInTitle: 'Anmeldung',
    emailRow: (email: string) => `E-Mail: ${email}`,
    emailSubtitle: 'Damit meldest du dich an.',
    nameLabel: 'Anzeigename',
    nameHint: 'Den Namen sieht auch dein Partner.',
    nameInvalid: 'Dein Name braucht 1 bis 30 Zeichen.',
    saveName: 'Namen speichern',
    changePassword: 'Passwort ändern',
    logout: 'Abmelden',
    logoutUnreachable: 'Abmelden braucht Internet. Versuch es mit Verbindung noch einmal; bis dahin bleibt alles auf diesem Gerät.',
    logoutPending: 'Deine Abmeldung ist noch nicht abgeschlossen. Mit Internet kannst du sie beenden.',
    logoutFinish: 'Abschließen',
    logoutCleanupPending: 'Du bist abgemeldet. Die App räumt beim nächsten Start fertig auf.',
  },

  logoutConfirm: {
    title: 'Noch nicht gesichert',
    text: (operations: number) =>
      operations === 1
        ? 'Eine Änderung ist noch nicht auf dem Server. Wenn du dich jetzt abmeldest, geht sie verloren.'
        : `${operations} Änderungen sind noch nicht auf dem Server. Wenn du dich jetzt abmeldest, gehen sie verloren.`,
    stay: 'Angemeldet bleiben',
    discard: 'Trotzdem abmelden',
  },

  password: {
    title: 'Passwort ändern',
    current: 'Aktuelles Passwort',
    next: 'Neues Passwort',
    rules: 'Mindestens 10 Zeichen. Sehr häufige Passwörter nimmt die App nicht an.',
    submit: 'Passwort ändern',
    cancel: 'Abbrechen',
    currentMissing: 'Gib dein aktuelles Passwort ein.',
    currentWrong: 'Das aktuelle Passwort stimmt nicht. Versuch es noch einmal.',
    rejected: {
      password_too_short: 'Das neue Passwort braucht mindestens 10 Zeichen.',
      password_too_long: 'Das neue Passwort darf höchstens 128 Zeichen haben.',
      password_compromised: 'Dieses Passwort ist zu verbreitet. Wähle ein anderes.',
    } satisfies Record<PasswordRejection, string>,
    rateLimited: 'Zu viele Versuche. Warte ein paar Minuten und versuch es dann noch einmal.',
    offline: 'Passwort ändern braucht Internet. Versuch es mit Verbindung noch einmal.',
    failed: 'Das hat nicht geklappt. Versuch es bitte noch einmal.',
  },
} as const;
