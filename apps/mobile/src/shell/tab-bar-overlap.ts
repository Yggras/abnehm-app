import { createContext, use } from 'react';

/**
 * Tabs mit bildschirmfüllender Szene: Dort liegt die Tab-Leiste über dem Inhalt, und der Streifen
 * neben dem ＋ ist durchsichtig (Impeccable-Prüfung von #101, Hinweis in #182). Sonst stünde über der
 * Insel ein beiger Balken.
 */
export const sceneTabs: ReadonlySet<string> = new Set(['momo']);

/** Höhe der Tab-Leiste samt Überstand des ＋, die über einer bildschirmfüllenden Szene liegt. */
export const TabBarOverlap = createContext(0);

export function useTabBarOverlap(): number {
  return use(TabBarOverlap);
}
