import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import type { EntityId } from '@abnehm/contracts/base';
import { gameCatalog } from '@abnehm/game-rules/content';

import { Button, Card, Notice, Skeleton, space, Text } from '../design';
import { closeRoute, openTarget, type RouteScreenProps } from '../navigation';
import { useMessageHost } from '../shell/MessageHost';
import { ScreenFrame } from '../shell/ScreenFrame';
import { titleOf } from '../shell/texts';
import { useChallengeShares, useChallengeStage, useGameService } from './app-game-service';
import type { ChallengeStage, OwnChallengeShare } from './challenges';
import type { GameService } from './game-service';
import { challengeTexts } from './texts';

// Modal `challenge.propose` (Spezifikation 4, Abschnitt 10; #210): vier Vorlagenkarten mit Erklärung und dem
// eigenen Anteil als Vorschau aus dem eigenen Wochenplan. Eine Vorlage, die an keinem der sieben Tage
// geplant ist, steht ohne „Vorschlagen“ und mit Grund da. Den Plan des Partners kennt die App nicht; passt
// die Vorlage dort nicht, lehnt der Server ab. Ein Tipp schlägt sofort vor, ohne Rückfrage; danach schließt
// das Modal, und der Meldungs-Host bestätigt. Ist schon ein Vorschlag offen oder läuft eine Challenge,
// führt der Bildschirm dorthin.

export function ChallengeProposeScreen({ target }: RouteScreenProps<'challenge.propose'>) {
  const game = useGameService();
  const stage = useChallengeStage(game);
  const shares = useChallengeShares(game);
  return (
    <ScreenFrame title={titleOf(target)} presentation="modal">
      <Content game={game} stage={stage} shares={shares} />
    </ScreenFrame>
  );
}

function Content({ game, stage, shares }: { game: GameService | null; stage: ChallengeStage | null; shares: Readonly<Record<string, OwnChallengeShare>> | null }) {
  if (game === null || stage === null || stage.type === 'ohne_person') return <Loading />;
  switch (stage.type) {
    case 'ohne_kopplung':
      return <Notice tone="neutral" text={challengeTexts.solo} />;
    case 'vorschlag':
      return <Elsewhere text={challengeTexts.alreadyProposed} challengeId={stage.proposal.challengeId} />;
    case 'aktiv':
      return <Elsewhere text={challengeTexts.alreadyActive} challengeId={stage.challengeId} />;
    case 'frei':
      return shares === null ? <Loading /> : <Templates game={game} partner={stage.partnerDisplayName} shares={shares} />;
  }
}

function Loading() {
  return (
    <View style={styles.list}>
      {gameCatalog.challengeTemplates.map(({ key }) => (
        <Skeleton key={key} width="100%" height={128} />
      ))}
    </View>
  );
}

function Elsewhere({ text, challengeId }: { text: string; challengeId: EntityId }) {
  return (
    <View style={styles.list}>
      <Notice tone="neutral" text={text} />
      <Button
        variant="secondary"
        label={challengeTexts.show}
        onPress={() => {
          closeRoute();
          openTarget({ type: 'challenge.detail', challengeId });
        }}
      />
    </View>
  );
}

function Templates({ game, partner, shares }: { game: GameService; partner: string; shares: Readonly<Record<string, OwnChallengeShare>> }) {
  const { showMessage } = useMessageHost();
  // Ein zweiter Tipp, bevor das Modal geschlossen ist, schlägt nicht noch einmal vor.
  const sent = useRef(false);
  const propose = (templateKey: string) => {
    if (sent.current) return;
    sent.current = true;
    if (game.proposeChallenge(templateKey) === 'vorgemerkt') showMessage({ messageKey: 'challenge.vorgeschlagen', values: { partnerDisplayName: partner } });
    closeRoute();
  };
  return (
    <View style={styles.list}>
      <Text>{challengeTexts.intro(partner)}</Text>
      {gameCatalog.challengeTemplates.map((template) => {
        const share = shares[template.key] ?? { type: 'passt_nicht' };
        const fits = share.type === 'passt';
        return (
          <Card key={template.key}>
            <View testID={`challenge-vorlage-${template.key}`} style={styles.card}>
              <Text variant="headline" accessibilityRole="header" tone={fits ? 'ink' : 'inkMuted'}>
                {template.name}
              </Text>
              <Text tone={fits ? 'ink' : 'inkMuted'}>{template.description}</Text>
              <Text variant="label" tone={fits ? 'ink' : 'inkMuted'}>
                {challengeTexts.share(share, template.measure)}
              </Text>
              {fits ? (
                <Button
                  variant="secondary"
                  label={challengeTexts.propose}
                  accessibilityLabel={challengeTexts.proposeTemplate(template.name)}
                  onPress={() => propose(template.key)}
                />
              ) : null}
            </View>
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space[4] },
  card: { gap: space[2] },
});
