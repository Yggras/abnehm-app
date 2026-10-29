import type { PasswordRejection } from '../auth';

// Sichtbare Texte und zugängliche Namen des Onboardings. Der Hinweis aus Schritt 1 und der
// Offline-Hinweis aus Schritt 2 stehen wörtlich so in Spezifikation 1, Abschnitt 9.

export const onboardingTexts = {
  progress: (step: number, total: number) => `Schritt ${step} von ${total}`,
  progressLabel: 'Fortschritt der Einrichtung',
  next: 'Weiter',

  welcomeHeadline: 'Schön, dass du da bist',
  welcomeIntro:
    'Momo wartet noch im Ei. Zusammen mit deinem Partner bringst du Momo zum Schlüpfen und lässt es mit euren Tageszielen wachsen.',
  disclaimer: 'Die App gibt keine medizinische Beratung; alle Werte sind Schätzungen.',
  disclaimerConfirm: 'Verstanden',
  disclaimerRequired: 'Bestätige den Hinweis, um weiterzumachen.',

  registerHeadline: 'Konto anlegen',
  registerIntro: 'Mit deinem Konto gehören deine Daten dir und sind auf jedem deiner Geräte da.',
  signInHeadline: 'Anmelden',
  signInIntro: 'Melde dich mit deinem bestehenden Konto an.',
  email: 'E-Mail-Adresse',
  password: 'Passwort',
  passwordHint: 'Mindestens 10 Zeichen',
  displayName: 'Anzeigename',
  displayNameHint: 'So sieht dich dein Partner, 1 bis 30 Zeichen',
  register: 'Konto anlegen',
  signIn: 'Anmelden',
  haveAccount: 'Ich habe schon ein Konto',
  newAccount: 'Neues Konto anlegen',

  offline: 'Für dein Konto brauchst du kurz Internet',
  retry: 'Erneut versuchen',

  invalidEmail: 'Bitte gib eine gültige E-Mail-Adresse ein.',
  missingPassword: 'Bitte gib dein Passwort ein.',
  invalidDisplayName: 'Dein Anzeigename braucht 1 bis 30 Zeichen.',
  /**
   * Für eine vergebene und eine vom Server abgelehnte Adresse derselbe Satz: So verrät die App nicht, ob
   * eine E-Mail schon registriert ist.
   */
  emailNotPossible: 'Mit dieser E-Mail-Adresse geht es so nicht. Prüfe sie oder melde dich an, falls du schon ein Konto hast.',
  /** Falsche E-Mail und falsches Passwort meldet das Auth-Modul bewusst gleich. */
  invalidCredentials: 'E-Mail-Adresse oder Passwort stimmen nicht.',
  rateLimited: 'Zu viele Versuche. Warte ein paar Minuten und versuche es dann noch einmal.',

  setupHeadline: 'Konto wird eingerichtet',
  setupWaiting: 'Einen Moment, wir holen deine Daten.',
  setupNameIntro: 'Fast geschafft: Wie sollen wir dich nennen?',
  setupConfirm: 'Konto einrichten',

} as const;

export const passwordRejectionTexts: Record<PasswordRejection, string> = {
  password_too_short: 'Dein Passwort braucht mindestens 10 Zeichen.',
  password_too_long: 'Dein Passwort darf höchstens 128 Zeichen haben.',
  password_compromised: 'Dieses Passwort ist zu bekannt und leicht zu erraten. Bitte wähle ein anderes.',
};
