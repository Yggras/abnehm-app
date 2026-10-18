import type { RouteName, RouteTarget } from '@abnehm/contracts/routes';
import { router, useLocalSearchParams } from 'expo-router';
import type { ComponentType } from 'react';

import { UnknownTarget } from '../shell/UnknownTarget';
import { hrefFor, targetFromLink } from './href';
import { pathOf, routeCatalog } from './route-catalog';

/** Ziel einer bestimmten Route mit ihren geprüften Parametern. */
export type TargetOf<N extends RouteName> = Extract<RouteTarget, { type: N }>;

export type RouteScreenProps<N extends RouteName> = { target: TargetOf<N> };

/**
 * Inhalt einer Routendatei unter `app/`: prüft die Parameter des Links mit dem Schema der Route
 * und zeigt bei ungültigen Parametern „Heute“ samt Meldung. Ein Bereich ersetzt seinen Platzhalter, indem er
 * hier seinen Bildschirm übergibt: `export default routeScreen('capture.food', FoodCapture)`.
 * `fixed` sind die Parameter, die der Pfad selbst festlegt, etwa der Einstellungsabschnitt.
 */
export function routeScreen<N extends RouteName>(
  name: N,
  Screen: ComponentType<RouteScreenProps<N>>,
  fixed?: Omit<TargetOf<N>, 'type'>,
) {
  const { pathname } = hrefFor({ ...fixed, type: name } as RouteTarget);
  function RouteScreen() {
    const target = targetFromLink(pathname, useLocalSearchParams());
    if (target.type !== name) return <UnknownTarget />;
    return <Screen target={target as TargetOf<N>} />;
  }
  RouteScreen.displayName = `RouteScreen(${pathname})`;
  return RouteScreen;
}

/** Öffnet ein Ziel: Tabs werden gewechselt, Seiten und modale Abläufe kommen über den Aufrufer. */
export function openTarget(target: RouteTarget) {
  const href = hrefFor(target);
  if (routeCatalog[target.type].presentation === 'tab') router.navigate(href);
  else router.push(href);
}

/** Schließt einen modalen Ablauf oder eine Seite und kehrt zum Aufrufer zurück, sonst zu „Heute“. */
export function closeRoute() {
  if (router.canGoBack()) router.back();
  else router.replace(pathOf('today'));
}
