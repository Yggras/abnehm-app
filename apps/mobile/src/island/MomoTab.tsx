import { Skeleton, Text } from '../design';
import { openTarget, setTargetParams, type RouteScreenProps } from '../navigation';
import { ScreenFrame } from '../shell/ScreenFrame';
import { useTabBarOverlap } from '../shell/tab-bar-overlap';
import { useChallengeStage, useGameService, useIslandStage } from './app-game-service';
import { openChallengeIdOf, type ChallengeStage } from './challenges';
import { HatchedIslandScreen } from './HatchedIslandScreen';
import { LaichkugelScreen } from './LaichkugelScreen';
import { RoleChoiceScreen } from './RoleChoiceScreen';
import { challengeTexts, islandTexts } from './texts';

/**
 * Tab „Momo“ (Spezifikation 4, Abschnitt 7). Ohne Kopplung wartet Momo als Laichkugel, vor dem Schlüpfen
 * zeigt der Tab in jeder Ansicht die Rollenwahl (#180). Nach dem Schlüpfen zeigt er die echte Insel aus
 * den lokalen Daten (#184). Die Leiste öffnet ihre Ansichten über die Route `momo` mit `view`, denselben
 * Weg wie Aktionen auf „Wir“; die Ansichten selbst liefern spätere Tickets. „Bauen“ öffnet das Bau-Sheet
 * direkt, auch über die Route mit `view: 'bauen'` (#192), ebenso „Lager“ das Lager-Sheet (#194) und
 * „Ereignisse“ das Sheet „Ereignisse“ (#202).
 */
export function MomoTab({ target }: RouteScreenProps<'momo'>) {
  const game = useGameService();
  const stage = useIslandStage(game);
  const challenge = useChallengeStage(game);
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
      upgrade={game.upgrade}
      place={game.place}
      markEventsSeen={game.markEventsSeen}
      claimEventReward={game.claimEventReward}
      onOpen={(view) => openTarget({ type: 'momo', view })}
      challengeEntry={challengeEntryOf(challenge)}
      requestedView={target.view}
      onViewHandled={clearView}
      bottomInset={bottomInset}
    />
  );
}

/**
 * Einstieg zu den gemeinsamen Challenges im Momo-Sheet (#210): ohne offenen Vorschlag und ohne laufende
 * Challenge „Challenge vorschlagen“, sonst „Zur Challenge“.
 */
function challengeEntryOf(stage: ChallengeStage | null) {
  if (stage === null || stage.type === 'ohne_person' || stage.type === 'ohne_kopplung') return null;
  const challengeId = openChallengeIdOf(stage);
  return challengeId === null
    ? ({ label: challengeTexts.sheetPropose, target: { type: 'challenge.propose' } } as const)
    : ({ label: challengeTexts.sheetOpen, target: { type: 'challenge.detail', challengeId } } as const);
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
