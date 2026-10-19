import type { RouteName, RouteTarget } from '@abnehm/contracts/routes';

/**
 * Wie eine Route erscheint: als Tab, als modaler Ablauf über dem Aufrufer, als Seite im Stapel oder
 * als eigenständiger Ablauf ohne Aufrufer (Onboarding und Anmeldung, je nach Sitzungs-Weiche).
 */
export type Presentation = 'tab' | 'modal' | 'page' | 'flow';

/** Lieferant einer Route (Spezifikation 0, Abschnitt 6); der Platzhalter nennt ihn. */
export type Owner = 'fundament' | 'ziele' | 'ernaehrung' | 'tracker' | 'momo' | 'partner';

type CatalogEntry = { presentation: Presentation; owner: Owner };

/**
 * Routenkatalog der App: Darstellung und Lieferant je Route. Pfade bildet `hrefFor`; die
 * Routendatei unter `app/` liegt an genau diesem Pfad.
 */
export const routeCatalog = {
  today: { presentation: 'tab', owner: 'fundament' },
  log: { presentation: 'tab', owner: 'ernaehrung' },
  'capture.food': { presentation: 'modal', owner: 'ernaehrung' },
  'capture.water': { presentation: 'modal', owner: 'tracker' },
  'capture.sport': { presentation: 'modal', owner: 'tracker' },
  'capture.weight': { presentation: 'modal', owner: 'tracker' },
  momo: { presentation: 'tab', owner: 'momo' },
  'challenge.propose': { presentation: 'modal', owner: 'momo' },
  'challenge.detail': { presentation: 'page', owner: 'momo' },
  partner: { presentation: 'tab', owner: 'partner' },
  'partner.invite': { presentation: 'modal', owner: 'partner' },
  'partner.redeem': { presentation: 'modal', owner: 'partner' },
  'partner.encourage': { presentation: 'modal', owner: 'partner' },
  'notifications.permission': { presentation: 'modal', owner: 'partner' },
  settings: { presentation: 'page', owner: 'partner' },
  onboarding: { presentation: 'flow', owner: 'ziele' },
  'plan.budget_suggestion': { presentation: 'modal', owner: 'ziele' },
  'plan.goal_reached': { presentation: 'modal', owner: 'ziele' },
} as const satisfies Record<RouteName, CatalogEntry>;

type SettingsSection = NonNullable<Extract<RouteTarget, { type: 'settings' }>['section']>;

/** Lieferant je Einstellungsseite; die Übersicht liefert Spezifikation 5. */
const settingsOwners: Record<SettingsSection, Owner> = {
  goals: 'ziele',
  weekly_plan: 'ziele',
  partner_sharing: 'partner',
  notifications: 'partner',
  health: 'tracker',
  account: 'partner',
};

/** Bereich, der den Bildschirm zu einem Ziel liefert. */
export function ownerOf(target: RouteTarget): Owner {
  if (target.type === 'settings' && target.section) return settingsOwners[target.section];
  return routeCatalog[target.type].owner;
}

/** Pfad einer Route: `today` ist `/`, sonst der Name mit `/` statt `.` (`capture.food` → `/capture/food`). */
export function pathOf(name: RouteName): string {
  return name === 'today' ? '/' : `/${name.replaceAll('.', '/')}`;
}

/** Name des Screens einer Route im Wurzel-Stack: ihr Pfad ohne führenden `/`. */
export function screenNameOf(name: RouteName): string {
  return pathOf(name).slice(1);
}

/** Namen der Screens der modalen Routen im Wurzel-Stack. */
export const modalScreens = (Object.keys(routeCatalog) as RouteName[])
  .filter((name) => routeCatalog[name].presentation === 'modal')
  .map(screenNameOf);

/** Namen der Seiten im Wurzel-Stack; die Einstellungen sind je Abschnitt eine Datei unter `settings/`. */
export const pageScreens = (Object.keys(routeCatalog) as RouteName[])
  .filter((name) => routeCatalog[name].presentation === 'page')
  .flatMap((name) =>
    name === 'settings'
      ? ['settings/index', ...Object.keys(settingsOwners).map((section) => `settings/${section}`)]
      : [screenNameOf(name)],
  );
