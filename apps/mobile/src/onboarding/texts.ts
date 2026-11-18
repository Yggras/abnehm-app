import { passwordPolicy } from '@abnehm/contracts/auth';
import { bodyInputLimits, type SafetyTrigger } from '@abnehm/contracts/goal-calculator';

import type { PasswordRejection } from '../auth';
import { thousandthsWithOneDecimal as kg } from '../shell/texts';
import type { BodyDataProblem } from './body-data';

// Sichtbare Texte und zugängliche Namen des Onboardings. Der Hinweis aus Schritt 1 und der
// Offline-Hinweis aus Schritt 2 stehen wörtlich so in Spezifikation 1, Abschnitt 9. Passwortgrenzen
// kommen aus `passwordPolicy`; die 1–30 Zeichen des Anzeigenamens prüft `DisplayName` im Vertragsmodul,
// das sie nicht als Wert exportiert.

export const onboardingTexts = {
  progress: (step: number, total: number) => `Schritt ${step} von ${total}`,
  progressLabel: 'Fortschritt der Einrichtung',
  next: 'Weiter',

  welcomeHeadline: 'Willkommen bei Gemeinsam leichter',
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
  passwordHint: `Mindestens ${passwordPolicy.minLength} Zeichen`,
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
   * Derselbe Satz für eine vergebene und eine vom Server abgelehnte Adresse; er nennt keine
   * Registrierung. Weil die App das Format schon vorher prüft, deutet er bei gültigen Adressen trotzdem
   * auf ein bestehendes Konto. Ganz verbergen ließe sich das nur mit E-Mail-Verifikation, die es in V1
   * nicht gibt (Spezifikation 0, Abschnitt 9).
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

const { heightCm, weightG, minimumAgeYears } = bodyInputLimits;
const heightInvalid = `Bitte gib deine Größe in ganzen Zentimetern von ${heightCm.min} bis ${heightCm.max} ein.`;
const weightInvalid = `Bitte gib dein Gewicht von ${kg(weightG.min)} bis ${kg(weightG.max)} kg mit höchstens einer Nachkommastelle ein.`;

/**
 * Schritt 3 „Körperdaten“ (Spezifikation 1, Abschnitte 3 und 9). Die Grenzen kommen aus dem
 * Zielrechner; die Erklärung zum Geschlecht folgt Abschnitt 2: Mifflin-St Jeor kennt nur zwei Werte.
 * Dass Partner Körperdaten nicht sehen, legt Abschnitt 2 der Spezifikation fest.
 */
export const bodyDataTexts = {
  intro: 'Daraus berechnet die App deinen Bedarf. Dein Partner sieht diese Angaben nicht.',
  sex: 'Geschlecht für die Berechnung',
  sexExplanation: 'Die Formel für deinen Grundumsatz kennt nur zwei Werte: weiblich und männlich. Wähle den, mit dem gerechnet werden soll.',
  sexValues: { weiblich: 'weiblich', maennlich: 'männlich' },
  birthDate: 'Geburtsdatum',
  /** Der Picker zeigt eine Vorauswahl, die nicht als Eingabe zählt; der Satz nennt deshalb die Handlung (Impeccable-critique). */
  birthDateUnset: 'Tippe auf das Datum und wähle dein Geburtsdatum.',
  height: 'Größe',
  heightHint: `${heightCm.min} bis ${heightCm.max} cm`,
  weight: 'Aktuelles Gewicht',
  weightHint: `${kg(weightG.min)} bis ${kg(weightG.max)} kg, höchstens eine Nachkommastelle`,
  /** Eine Eingabe, die keine Zahl im erlaubten Format ist, zeigt denselben Satz wie eine außerhalb der Grenzen. */
  heightInvalid,
  weightInvalid,
  problems: {
    calculation_sex_missing: 'Bitte wähle einen Wert für die Berechnung.',
    birth_date_missing: 'Tippe auf das Datum und wähle dein Geburtsdatum.',
    height_missing: 'Bitte gib deine Größe ein.',
    weight_missing: 'Bitte gib dein aktuelles Gewicht ein.',
    height_out_of_range: heightInvalid,
    height_not_on_step: heightInvalid,
    weight_out_of_range: weightInvalid,
    weight_not_on_step: weightInvalid,
  } satisfies Record<BodyDataProblem, string>,
} as const;

/** Anlässe des erzwungenen Haltemodus im Genitiv, für „Wegen …“. */
const safetyReasons: Record<SafetyTrigger, string> = {
  schwanger_oder_stillend: 'Schwangerschaft oder Stillzeit',
  essstoerung: 'einer bekannten Essstörung',
  untergewicht: 'eines BMI unter 18,5',
};

/** „A“, „A und B“, „A, B und C“. */
function germanList(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} und ${items.at(-1)}`;
}

/**
 * Schritt 4 „Sicherheits-Check“ (Spezifikation 1, Abschnitte 3 und 9; User Stories 9–13). Der
 * erzwungene Haltemodus rechnet ohne Defizit, das Budget ist dann der Gesamtumsatz (Abschnitt 3); der Text
 * sagt „geschätzter Tagesbedarf“, weil die App „Gesamtumsatz“ erst in Schritt 7 erklärt.
 * Hinweise sind neutral und nie in `problem`-Farbe (Abschnitt 6).
 */
export const safetyCheckTexts = {
  intro: 'Bitte beantworte die Fragen ehrlich. Sie schützen dich vor einem Kaloriendefizit, das dir schaden könnte. Dein Partner sieht diese Angaben nicht.',
  pregnant: { question: 'Bist du schwanger oder stillst du?', name: 'Schwanger oder stillend' },
  eatingDisorder: { question: 'Hast du eine bekannte Essstörung?', name: 'Bekannte Essstörung' },
  yes: 'Ja',
  no: 'Nein',
  bmi: 'Dein BMI',
  bmiSource: 'Aus deiner Größe und deinem aktuellen Gewicht',
  maintenanceForced: (triggers: readonly SafetyTrigger[]) =>
    `Wegen ${germanList(triggers.map((trigger) => safetyReasons[trigger]))} rechnet die App für dich ohne Kaloriendefizit: Dein Kalorienbudget deckt deinen geschätzten Tagesbedarf (Haltemodus). Wenn du abnehmen möchtest, lass dich bitte ärztlich begleiten.`,
  chronicIllness: 'Hast du eine chronische Erkrankung? Dann sprich vor dem Abnehmen mit deiner Ärztin oder deinem Arzt.',
  answerRequired: 'Beantworte beide Fragen, um weiterzumachen.',
} as const;

/** BMI mit einer Nachkommastelle, abgeschnitten statt gerundet: So zeigt ein BMI knapp unter 18,5 nie „18,5“ (Designwert). */
export function bmiText(bmi: number): string {
  return (Math.floor(bmi * 10) / 10).toFixed(1).replace('.', ',');
}

/** Sperrbildschirm unter 18 Jahren (Spezifikation 1, Abschnitt 9, User Story 8): freundlich, ohne Wertung. */
export const underageTexts = {
  headline: 'Diese App ist für Erwachsene',
  text: `Gemeinsam leichter ist für Menschen ab ${minimumAgeYears} Jahren gedacht. Ein Kalorienbudget berechnet die App für dich deshalb nicht.`,
  typo: 'Hast du dich beim Geburtsdatum vertippt? Dann korrigiere es einfach.',
  correctDate: 'Datum korrigieren',
} as const;

export const passwordRejectionTexts: Record<PasswordRejection, string> = {
  password_too_short: `Dein Passwort braucht mindestens ${passwordPolicy.minLength} Zeichen.`,
  password_too_long: `Dein Passwort darf höchstens ${passwordPolicy.maxLength} Zeichen haben.`,
  password_compromised: 'Dieses Passwort ist zu bekannt und leicht zu erraten. Bitte wähle ein anderes.',
};
