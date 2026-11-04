import { testCapabilities } from '../build-capabilities';
import { Skeleton, Text } from '../design';
import { openTarget, type RouteScreenProps } from '../navigation';
import { Placeholder } from '../shell/Placeholder';
import { ScreenFrame } from '../shell/ScreenFrame';
import { useTabBarOverlap } from '../shell/tab-bar-overlap';
import { useGameService, useIslandStage } from './app-game-service';
import { IslandView } from './IslandView';
import { LaichkugelScreen } from './LaichkugelScreen';
import { RoleChoiceScreen } from './RoleChoiceScreen';
import { islandTexts } from './texts';

/**
 * Tab „Momo“ (Spezifikation 4, Abschnitt 7). Ohne Kopplung wartet Momo als Laichkugel, vor dem Schlüpfen
 * zeigt der Tab in jeder Ansicht die Rollenwahl (#180). Die geschlüpfte Insel schließt „Schlüpfen“ an
 * (#184); bis dahin zeigen Test-Artefakte dort die Fixture-Insel aus #182 und der Produktionsbuild den
 * Platzhalter. Die Leiste öffnet ihre Ansichten über die Route `momo` mit `view`, denselben Weg wie
 * Aktionen auf „Wir“; die Ansichten selbst liefern spätere Tickets.
 */
export function MomoTab({ target }: RouteScreenProps<'momo'>) {
  const game = useGameService();
  const stage = useIslandStage(game);
  const bottomInset = useTabBarOverlap();
  if (game === null || stage === null || stage.type === 'ohne_person') {
    return (
      <ScreenFrame title={islandTexts.momo} presentation="tab">
        <Text tone="inkMuted">{islandTexts.loading}</Text>
        <Skeleton width="100%" height={160} />
      </ScreenFrame>
    );
  }
  if (stage.type === 'laichkugel') return <LaichkugelScreen energy={stage.energy} />;
  if (stage.type === 'rollenwahl') {
    return (
      <RoleChoiceScreen
        partnerDisplayName={stage.partnerDisplayName}
        proposal={stage.proposal}
        onPropose={(role) => game.proposeRoles(role)}
        onDecline={(proposal) => game.declineRoles(proposal.actionId)}
        onWithdraw={(proposal) => game.withdrawRoles(proposal.actionId)}
      />
    );
  }
  const fixture = testCapabilities?.fixtureIsland ?? null;
  if (fixture === null) return <Placeholder target={target} />;
  return <IslandView {...fixture} bottomInset={bottomInset} onOpen={(view) => openTarget({ type: 'momo', view })} />;
}
