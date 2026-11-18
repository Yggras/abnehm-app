import { Skeleton, Text } from '../design';
import { openTarget, setTargetParams, type RouteScreenProps } from '../navigation';
import { ScreenFrame } from '../shell/ScreenFrame';
import { useTabBarOverlap } from '../shell/tab-bar-overlap';
import { useGameService, useIslandStage } from './app-game-service';
import { HatchedIslandScreen } from './HatchedIslandScreen';
import { LaichkugelScreen } from './LaichkugelScreen';
import { RoleChoiceScreen } from './RoleChoiceScreen';
import { islandTexts } from './texts';

/**
 * Tab „Momo“ (Spezifikation 4, Abschnitt 7). Ohne Kopplung wartet Momo als Laichkugel, vor dem Schlüpfen
 * zeigt der Tab in jeder Ansicht die Rollenwahl (#180). Nach dem Schlüpfen zeigt er die echte Insel aus
 * den lokalen Daten (#184). Die Leiste öffnet ihre Ansichten über die Route `momo` mit `view`, denselben
 * Weg wie Aktionen auf „Wir“; die Ansichten selbst liefern spätere Tickets. „Bauen“ öffnet das Bau-Sheet
 * direkt, auch über die Route mit `view: 'bauen'` (#192).
 */
export function MomoTab({ target }: RouteScreenProps<'momo'>) {
  const game = useGameService();
  const stage = useIslandStage(game);
  const bottomInset = useTabBarOverlap();
  if (game === null || stage === null || stage.type === 'ohne_person') return <Loading />;
  if (stage.type === 'laichkugel') return <LaichkugelScreen energy={stage.energy} />;
  if (stage.type === 'rollenwahl') {
    return (
      <RoleChoiceScreen
        partnerDisplayName={stage.partnerDisplayName}
        proposal={stage.proposal}
        onPropose={(role) => game.proposeRoles(role)}
        onAccept={(proposal) => game.acceptRoles(proposal.actionId)}
        onDecline={(proposal) => game.declineRoles(proposal.actionId)}
        onWithdraw={(proposal) => game.withdrawRoles(proposal.actionId)}
      />
    );
  }
  // Bis alle Teile der geschlüpften Insel per Pull angekommen sind, lädt der Tab.
  if (stage.island === null) return <Loading />;
  return (
    <HatchedIslandScreen
      island={stage.island}
      takeGrowthIntro={game.takeGrowthIntro}
      build={game.build}
      onOpen={(view) => openTarget({ type: 'momo', view })}
      requestedView={target.view}
      onViewHandled={clearView}
      bottomInset={bottomInset}
    />
  );
}

/** Eine erledigte Ansicht verlässt die Route, damit derselbe Link sie erneut öffnen kann. */
function clearView() {
  setTargetParams('momo', { view: undefined });
}

function Loading() {
  return (
    <ScreenFrame title={islandTexts.momo} presentation="tab">
      <Text tone="inkMuted">{islandTexts.loading}</Text>
      <Skeleton width="100%" height={160} />
    </ScreenFrame>
  );
}
