import { momoCharacterOf, wirContributionsOf, type GameService } from '../game-service';
import type { IslandStage } from '../role-choice';

/**
 * Spieldienst mit fester Stufe für Tests anderer Bereiche, etwa der App-Shell. Er meldet nur die Stufe
 * und die daraus abgeleiteten Beiträge; Befehle sind dort kein Thema und scheitern.
 */
export function fakeGameService(stage: IslandStage): GameService {
  const refuse = () => {
    throw new Error('Der Spieldienst-Fake nimmt keine Befehle an');
  };
  return {
    observeStage(listener) {
      listener(stage);
      return () => {};
    },
    proposeRoles: refuse,
    acceptRoles: refuse,
    takeGrowthIntro: () => false,
    declineRoles: refuse,
    withdrawRoles: refuse,
    build: refuse,
    momoCharacter: {
      subscribe(listener) {
        listener(momoCharacterOf(stage));
        return () => {};
      },
    },
    wirContributions: {
      subscribe(listener) {
        listener(wirContributionsOf(stage));
        return () => {};
      },
    },
  };
}
