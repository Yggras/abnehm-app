import { StyleSheet, View } from 'react-native';

import { minutesOfDay, readingOf } from '@abnehm/clock';
import { weekdayOf, type Instant } from '@abnehm/contracts/base';
import { wallClockTimeOf } from '@abnehm/contracts/notifications';
import type { ChallengeShare } from '@abnehm/game-rules/challenges';

import { useClock } from '../clock/clock-context';
import { Button, Card, Notice, Skeleton, space, Text } from '../design';
import type { RouteScreenProps } from '../navigation';
import { ScreenFrame } from '../shell/ScreenFrame';
import { titleOf, weekdayNames } from '../shell/texts';
import { useChallengeShares, useChallengeStage, useGameService } from './app-game-service';
import { challengeTemplate, type ChallengeProposal, type ChallengeStage } from './challenges';
import type { GameService } from './game-service';
import { challengeTexts } from './texts';

// Seite `challenge.detail` (Spezifikation 4, Abschnitt 10), hier der Teil für einen offenen Vorschlag
// (#210): Vorlage mit Erklärung und eigenem Anteil als Vorschau, dazu für den Partner „Annehmen“ und
// „Ablehnen“, für die vorschlagende Person neutral „Vorschlag gesendet“ und „Zurückziehen“. Auf diese
// Seite führt der Beitrag `challenge` auf „Wir“. Stand, Stufe, Restlaufzeit, „Challenge beenden“,
// Ergebnis und Verlauf einer gestarteten Challenge ergänzt #211.

export function ChallengeDetailScreen({ target }: RouteScreenProps<'challenge.detail'>) {
  const game = useGameService();
  const stage = useChallengeStage(game);
  const shares = useChallengeShares(game);
  return (
    <ScreenFrame title={titleOf(target)} presentation="page">
      {game === null || stage === null || shares === null ? (
        <Skeleton width="100%" height={160} />
      ) : (
        <Content game={game} stage={stage} shares={shares} challengeId={target.challengeId} />
      )}
    </ScreenFrame>
  );
}

function Content({
  game,
  stage,
  shares,
  challengeId,
}: {
  game: GameService;
  stage: ChallengeStage;
  shares: Readonly<Record<string, ChallengeShare>>;
  challengeId: string;
}) {
  if (stage.type === 'vorschlag' && stage.proposal.challengeId === challengeId) {
    return <Proposal game={game} proposal={stage.proposal} partner={stage.partnerDisplayName} share={shares[stage.proposal.templateKey]} />;
  }
  if (stage.type === 'aktiv' && stage.challengeId === challengeId) {
    const template = challengeTemplate(stage.templateKey);
    return (
      <Card>
        <View style={styles.card}>
          <Text variant="headline" accessibilityRole="header">{template.name}</Text>
          <Text>{challengeTexts.running}</Text>
        </View>
      </Card>
    );
  }
  return <Notice tone="neutral" text={challengeTexts.gone} />;
}

function Proposal({ game, proposal, partner, share }: { game: GameService; proposal: ChallengeProposal; partner: string; share: ChallengeShare | undefined }) {
  const template = challengeTemplate(proposal.templateKey);
  const fromPartner = proposal.by === 'partner';
  return (
    <View style={styles.list}>
      <Card variant={fromPartner && !proposal.accepted ? 'response' : 'standard'}>
        <View testID="challenge-vorschlag" style={styles.card}>
          <Text variant="label" tone="inkMuted">
            {fromPartner ? challengeTexts.proposedBy(partner) : challengeTexts.sent}
          </Text>
          <Text variant="headline" accessibilityRole="header">{template.name}</Text>
          <Text>{template.description}</Text>
          {share === undefined ? null : <Text variant="label">{challengeTexts.share(share, template.measure)}</Text>}
          <Status proposal={proposal} partner={partner} />
        </View>
      </Card>
      {fromPartner && !proposal.accepted ? (
        <View style={styles.actions}>
          {share?.type === 'passt' ? <Button block label={challengeTexts.accept} onPress={() => game.acceptChallenge(proposal.challengeId)} /> : null}
          <Button block variant="secondary" label={challengeTexts.decline} onPress={() => game.declineChallenge(proposal.challengeId)} />
        </View>
      ) : null}
      {!fromPartner && proposal.proposedAt !== null ? (
        <Button block variant="secondary" label={challengeTexts.withdraw} onPress={() => game.withdrawChallenge(proposal.challengeId)} />
      ) : null}
    </View>
  );
}

function Status({ proposal, partner }: { proposal: ChallengeProposal; partner: string }) {
  const clock = useClock();
  if (proposal.accepted) return <Text tone="inkMuted">{challengeTexts.accepted}</Text>;
  if (proposal.expiresAt === null) return <Text tone="inkMuted">{challengeTexts.pending}</Text>;
  const until = validUntil(proposal.expiresAt, clock.read().timeZone);
  return <Text tone="inkMuted">{proposal.by === 'self' ? `${challengeTexts.waitingFor(partner)} ${until}.` : `${until}.`}</Text>;
}

/** „Gilt bis Freitag, 14:00 Uhr“ in der Zone des Geräts. */
function validUntil(expiresAt: Instant, timeZone: Parameters<typeof readingOf>[1]): string {
  const reading = readingOf(expiresAt, timeZone);
  return challengeTexts.validUntil(weekdayNames[weekdayOf(reading.localDate)], wallClockTimeOf(minutesOfDay(reading)));
}

const styles = StyleSheet.create({
  list: { gap: space[4] },
  card: { gap: space[2] },
  actions: { gap: space[3] },
});
