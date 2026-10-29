import type { RouteName } from '@abnehm/contracts/routes';
import { createContext, use } from 'react';

/**
 * Tabs mit bildschirmfüllender Szene: Dort liegt die Tab-Leiste über dem Inhalt, und der Streifen
 * neben dem ＋ ist durchsichtig (Impeccable-Prüfung von #101, Hinweis in #182). Sonst stünde über der
 * Insel ein beiger Balken.
 */
const sceneTabs: readonly RouteName[] = ['momo'];

export function isSceneTab(routeName: string): boolean {
  return (sceneTabs as readonly string[]).includes(routeName);
}

/** Höhe der Tab-Leiste samt Überstand des ＋, die über einer bildschirmfüllenden Szene liegt. */
export const TabBarOverlap = createContext(0);

export function useTabBarOverlap(): number {
  return use(TabBarOverlap);
}
