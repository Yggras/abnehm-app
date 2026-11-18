import type { BausteinKey } from '@abnehm/contracts/base';
import type { OnboardingStepKey } from '@abnehm/contracts/onboarding';
import type { ActivityType } from '@abnehm/contracts/trackers';
import type { RouteName, RouteTarget } from '@abnehm/contracts/routes';
import type { QuickCommandKey } from '@abnehm/contracts/today';

import { ownerOf, type Owner } from '../navigation/route-catalog';

// Sichtbare Texte und zugängliche Namen der App-Shell. Sie entstehen hier in der App aus
// Routennamen und typisierten Werten, nie im Transport (Spezifikation 0, Abschnitt 2).

/**
 * Namen der Aktivitätsarten (#38). „Yoga & Dehnen“ statt „Yoga/Dehnen“ aus #38, weil Screenreader den
 * Schrägstrich mitlesen.
 */
export const activityNames: Readonly<Record<ActivityType, string>> = {
  gehen: 'Gehen',
  laufen: 'Laufen',
  radfahren: 'Radfahren',
  schwimmen: 'Schwimmen',
  krafttraining: 'Krafttraining',
  yoga_dehnen: 'Yoga & Dehnen',
  mannschaftssport: 'Mannschaftssport',
  sonstiges: 'Sonstiges',
};

/** Namen der Tagesziel-Bausteine, auf „Heute“ und in „‹Baustein› erfüllt · +1 Energie“. */
export const bausteinNames: Readonly<Record<BausteinKey, string>> = {
  ernaehrung_erfasst: 'Ernährung erfasst',
  im_kalorienbudget: 'Im Kalorienbudget',
  wasserziel: 'Wasserziel',
  sporteinheit: 'Sporteinheit',
  gewogen: 'Gewogen',
};

/**
 * „Deine Hälfte ist voll – Momo wartet auf ‹Name›“ (Spezifikation 4, Abschnitt 7): neutral auf „Heute“
 * und auf der Insel, ohne Angabe, was dem Partner fehlt.
 */
export const waitingForPartnerText = (partnerDisplayName: string) => `Deine Hälfte ist voll – Momo wartet auf ${partnerDisplayName}`;

type SettingsSection = NonNullable<Extract<RouteTarget, { type: 'settings' }>['section']>;

const routeTitles: Record<RouteName, string> = {
  today: 'Heute',
  log: 'Protokoll',
  'capture.food': 'Essen',
  'capture.water': 'Wasser',
  'capture.sport': 'Sport',
  'capture.weight': 'Gewicht',
  momo: 'Momo',
  'challenge.propose': 'Challenge vorschlagen',
  'challenge.detail': 'Challenge',
  partner: 'Wir',
  'partner.invite': 'Partner einladen',
  'partner.redeem': 'Code eingeben',
  'partner.encourage': 'Anfeuern',
  'notifications.permission': 'Benachrichtigungen',
  settings: 'Einstellungen',
  onboarding: 'Einrichtung',
  'plan.budget_suggestion': 'Budgetvorschlag',
  'plan.goal_reached': 'Zielgewicht erreicht',
};

const settingsTitles: Record<SettingsSection, string> = {
  goals: 'Ziele',
  weekly_plan: 'Wochenplan',
  partner_sharing: 'Partner & Freigaben',
  notifications: 'Benachrichtigungen',
  health: 'Gesundheitsdaten',
  account: 'Konto',
};

const ownerNames: Record<Owner, string> = {
  fundament: 'Fundament',
  ziele: 'Ziele & Onboarding',
  ernaehrung: 'Ernährung',
  tracker: 'Wasser, Sport, Gewicht & Health',
  momo: 'Momo, Insel & Challenges',
  partner: 'Partner & Benachrichtigungen',
};

/** Titel des Bildschirms zu einem Ziel, etwa „Wochenplan“ für `settings` mit `section: "weekly_plan"`. */
export function titleOf(target: RouteTarget): string {
  if (target.type === 'settings' && target.section) return settingsTitles[target.section];
  return routeTitles[target.type];
}

/** Name des Bereichs, der den Bildschirm zu einem Ziel liefert. */
export function ownerNameOf(target: RouteTarget): string {
  return ownerNames[ownerOf(target)];
}

/** Name eines liefernden Bereichs, etwa für Steckplätze außerhalb des Routenkatalogs. */
export function ownerName(owner: Owner): string {
  return ownerNames[owner];
}

/** Titel der Onboarding-Steckplätze (Spezifikation 0, Abschnitt 6). */
export const onboardingStepTitles: Record<OnboardingStepKey, string> = {
  health: 'Gesundheitsdaten verbinden',
  notifications: 'Benachrichtigungen',
  partner: 'Partner einladen',
};

/** Bereich, der den Handler eines Quick-Commands liefert. */
const quickCommandOwners: Record<QuickCommandKey, Owner> = {
  'water.quick_add': 'tracker',
};

/** Name des Bereichs, der den Handler eines Quick-Commands liefert. */
export function quickCommandOwnerName(commandKey: QuickCommandKey): string {
  return ownerNames[quickCommandOwners[commandKey]];
}

/**
 * Tausendstel als ganze Einheit mit einer Nachkommastelle, etwa g als kg („91,8“) oder ml als l;
 * umgerechnet nur an der Oberfläche (Spezifikation 3, Abschnitt 1). Gerundet wird hier kaufmännisch:
 * Hermes zeigte für 250 ml im iOS-Simulator „0,2 l“, Node „0,3 l“ (beobachtet am 28.10.2026, #171).
 */
export function thousandthsWithOneDecimal(value: number): string {
  return (Math.round(value / 100) / 10).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export const shellTexts = {
  placeholder: 'Dieser Bereich ist noch in Arbeit.',
  placeholderOwner: (owner: string) => `Kommt mit: ${owner}`,
  onboardingStepPlaceholder: 'Dieser Schritt ist noch in Arbeit.',
  skip: 'Überspringen',
  done: 'Fertig',
  back: 'Zurück',
  capture: 'Erfassen',
  captureSheetTitle: 'Was möchtest du erfassen?',
  /** Direktaktion ganz oben im ＋-Sheet (Quick-Command `water.quick_add`). */
  quickAddWater: (ml: number) => `+${ml} ml Wasser`,
  /** Development Build: Hinweis statt Text, wenn ein Bereich seine Meldung noch nicht eingetragen hat. */
  missingMessageText: (messageKey: string) => `Text fehlt: ${messageKey}`,
  /** Zugänglicher Name eines Tabs; mit Punkt kommt der Hinweis dazu. */
  tab: (title: string, badge: boolean) => (badge ? `${title}, Neues auf der Insel` : title),
  developer: 'Entwicklung',
  componentCatalog: 'Komponentenkatalog',
  technicalCheck: 'Verbindung und Uhr prüfen',
} as const;
