import type { GameServiceDependencies } from '../game-service';

/**
 * Haptik und Takt des Spieldienstes für Tests, die weder Haptik noch Stimmung im Takt prüfen: Die Haptik
 * schweigt, der Takt stößt nie an. Reaktionen und Stimmung prüft `momo-reactions.test.ts` mit eigenen.
 */
export const quietGameDependencies: Pick<GameServiceDependencies, 'haptics' | 'refresh'> = {
  haptics: { feedback() {} },
  refresh: () => () => {},
};
