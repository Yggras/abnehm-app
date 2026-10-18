import { RouteName, routeParams, routeTargetOrToday, type RouteTarget } from '@abnehm/contracts/routes';

import { pathOf } from './route-catalog';

/** Link einer Route für Expo Router: Pfad plus Abfrageparameter als Zeichenfolgen. */
export type RouteHref = { pathname: string; params: Record<string, string> };

/** Abfrageparameter, wie Expo Router sie liefert. */
export type LinkParams = Record<string, string | string[] | undefined>;

const settingsPath = pathOf('settings');

/** Schema eines einzelnen Routenparameters; mehr braucht die Dekodierung nicht. */
type FieldSchema = { safeParse(value: unknown): { success: boolean } };

/**
 * Link zu einem Ziel. Der Pfad folgt dem Routennamen (`capture.food` → `/capture/food`), nur der
 * Einstellungsabschnitt ist eine eigene Seite (`/settings/goals`). Parameter stehen in der Abfrage.
 */
export function hrefFor(target: RouteTarget): RouteHref {
  const { type, ...params } = target;
  if (target.type === 'settings') {
    return { pathname: target.section ? `${settingsPath}/${target.section}` : settingsPath, params: {} };
  }
  return {
    pathname: pathOf(type),
    params: Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
  };
}

const routeByPath = new Map(RouteName.options.map((name) => [pathOf(name), name]));

/**
 * Ziel aus Pfad und Abfrage eines Links (Deep Link, Routendatei). Unbekannte Pfade und ungültige
 * Parameter öffnen `today`; geprüft wird mit den Schemas des Routenkatalogs.
 */
export function targetFromLink(pathname: string, params: LinkParams): RouteTarget {
  const section = pathname.startsWith(`${settingsPath}/`) ? pathname.slice(settingsPath.length + 1) : undefined;
  const name = section === undefined ? routeByPath.get(pathname) : 'settings';
  if (!name) return { type: 'today' };
  if (section !== undefined && 'section' in params) return { type: 'today' };
  const fields = routeParams[name].shape as Record<string, FieldSchema>;
  const decoded = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, decodeParam(fields[key], value)]),
  );
  return routeTargetOrToday({ ...decoded, ...(section === undefined ? {} : { section }), type: name });
}

/** Abfragewerte sind Text; `true` wird zum Wahrheitswert, wo das Schema ihn statt Text verlangt. */
function decodeParam(field: FieldSchema | undefined, value: LinkParams[string]) {
  if (field === undefined || typeof value !== 'string' || field.safeParse(value).success) return value;
  if (value === 'true' && field.safeParse(true).success) return true;
  return value;
}
