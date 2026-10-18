import type { RouteName, RouteTarget } from '@abnehm/contracts/routes';

import { routeCatalog, type Owner } from '../navigation/route-catalog';

// Sichtbare Texte und zugängliche Namen der App-Shell. Sie entstehen hier in der App aus
// Routennamen und typisierten Werten, nie im Transport (Spezifikation 0, Abschnitt 2).

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

/** Lieferant je Einstellungsseite; die Übersicht liefert Spezifikation 5. */
const settingsOwners: Record<SettingsSection, Owner> = {
  goals: 'ziele',
  weekly_plan: 'ziele',
  partner_sharing: 'partner',
  notifications: 'partner',
  health: 'tracker',
  account: 'partner',
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
  const owner = target.type === 'settings' && target.section ? settingsOwners[target.section] : routeCatalog[target.type].owner;
  return ownerNames[owner];
}

export const shellTexts = {
  placeholder: 'Dieser Bereich ist noch in Arbeit.',
  placeholderOwner: (owner: string) => `Kommt mit: ${owner}`,
  done: 'Fertig',
  back: 'Zurück',
  capture: 'Erfassen',
  captureSheetTitle: 'Was möchtest du erfassen?',
  /** Zugänglicher Name eines Tabs; mit Punkt kommt der Hinweis dazu. */
  tab: (title: string, badge: boolean) => (badge ? `${title}, Neues auf der Insel` : title),
  developer: 'Entwicklung',
  componentCatalog: 'Komponentenkatalog',
  technicalCheck: 'Verbindung und Uhr prüfen',
} as const;
