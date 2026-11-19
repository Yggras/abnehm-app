import { momoCharacterOf, wirContributionsOf, type GameService } from '../game-service';
import type { MomoReaction } from '../momo-reactions';
import type { IslandStage } from '../role-choice';

/**
 * Spieldienst mit fester Stufe für Tests anderer Bereiche, etwa der App-Shell. Er meldet nur die Stufe,
 * die daraus abgeleiteten Beiträge und beim Anmelden einmal die gegebenen Reaktionen; Befehle sind dort
 * kein Thema und scheitern.
 */
export function fakeGameService(stage: IslandStage, reactions: readonly MomoReaction[] = []): GameService {
  const refuse = () => {
    throw new Error('Der Spieldienst-Fake nimmt keine Befehle an');
  };
  return {
    observeStage(listener) {
      listener(stage);
      return () => {};
    },
    observeReactions(listener) {
      for (const reaction of reactions) listener(reaction);
      return () => {};
    },
    proposeRoles: refuse,
    acceptRoles: refuse,
    takeGrowthIntro: () => false,
    declineRoles: refuse,
    withdrawRoles: refuse,
    build: refuse,
    upgrade: refuse,
    place: refuse,
    markEventsSeen: refuse,
    claimEventReward: refuse,
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
