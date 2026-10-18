import type { RouteName } from '@abnehm/contracts/routes';

/** Wie eine Route erscheint: als Tab, als modaler Ablauf über dem Aufrufer oder als Seite im Stapel. */
export type Presentation = 'tab' | 'modal' | 'page';

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
  onboarding: { presentation: 'modal', owner: 'ziele' },
  'plan.budget_suggestion': { presentation: 'modal', owner: 'ziele' },
  'plan.goal_reached': { presentation: 'modal', owner: 'ziele' },
} as const satisfies Record<RouteName, CatalogEntry>;

/** Pfad einer Route: `today` ist `/`, sonst der Name mit `/` statt `.` (`capture.food` → `/capture/food`). */
export function pathOf(name: RouteName): string {
  return name === 'today' ? '/' : `/${name.replaceAll('.', '/')}`;
}

/** Pfade der modalen Routen ohne führenden `/`, als Namen der Screens im Wurzel-Stack. */
export const modalScreens = (Object.keys(routeCatalog) as RouteName[])
  .filter((name) => routeCatalog[name].presentation === 'modal')
  .map((name) => pathOf(name).slice(1));
