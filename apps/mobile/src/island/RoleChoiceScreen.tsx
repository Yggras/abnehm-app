import type { IslandRole } from '@abnehm/contracts/island';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { otherRole } from '@abnehm/game-rules/hatching';

import { Button, Chip, space, Text } from '../design';
import { LaichkugelFrame } from './LaichkugelScreen';
import type { RoleProposal } from './role-choice';
import { laichkugelTexts } from './texts';

// Ansicht `rollenwahl` des Tabs „Momo“ (Spezifikation 4, Abschnitt 7; #180, #184): eigene Rolle wählen
// und vorschlagen, den Vorschlag des Partners sehen, annehmen oder ablehnen, den eigenen zurückziehen.
// Die Annahme ist das Schlüpfen; bis der Sync sie sichert, steht dort „Angenommen“.

export type RoleChoiceScreenProps = Readonly<{
  partnerDisplayName: string;
  proposal: RoleProposal | null;
  onPropose(role: IslandRole): void;
  onAccept(proposal: RoleProposal): void;
  onDecline(proposal: RoleProposal): void;
  onWithdraw(proposal: RoleProposal): void;
}>;

export function RoleChoiceScreen({ partnerDisplayName, proposal, onPropose, onAccept, onDecline, onWithdraw }: RoleChoiceScreenProps) {
  return (
    <LaichkugelFrame headline={laichkugelTexts.hatchesAfterRoles}>
      {proposal === null ? (
        <ChooseRole partner={partnerDisplayName} onPropose={onPropose} />
      ) : proposal.by === 'self' ? (
        <View style={styles.block}>
          <Text variant="headline" accessibilityRole="header">{laichkugelTexts.sent}</Text>
          <Split own={proposal.proposerRole} partner={partnerDisplayName} />
          <Text tone="inkMuted">{laichkugelTexts.answerHint(partnerDisplayName)}</Text>
          <Button block variant="secondary" label={laichkugelTexts.withdraw} onPress={() => onWithdraw(proposal)} />
        </View>
      ) : proposal.accepted ? (
        <View style={styles.block}>
          <Text variant="headline" accessibilityRole="header">{laichkugelTexts.accepted}</Text>
          <Split own={otherRole(proposal.proposerRole)} partner={partnerDisplayName} />
          <Text tone="inkMuted">{laichkugelTexts.acceptedHint}</Text>
        </View>
      ) : (
        <View style={styles.block}>
          <Text variant="headline" accessibilityRole="header">{laichkugelTexts.proposedBy(partnerDisplayName)}</Text>
          <Split own={otherRole(proposal.proposerRole)} partner={partnerDisplayName} />
          <Button block label={laichkugelTexts.accept} onPress={() => onAccept(proposal)} />
          <Button block variant="secondary" label={laichkugelTexts.decline} onPress={() => onDecline(proposal)} />
        </View>
      )}
    </LaichkugelFrame>
  );
}

/** Wer welche Rolle bekommt, mit der Bedeutung beider Rollen. */
function Split({ own, partner }: { own: IslandRole; partner: string }) {
  return (
    <View style={styles.split}>
      <Text variant="label">{laichkugelTexts.split(own, partner, otherRole(own))}</Text>
      <Text variant="caption" tone="inkMuted">{laichkugelTexts.meaning(own)}</Text>
      <Text variant="caption" tone="inkMuted">{laichkugelTexts.meaning(otherRole(own))}</Text>
    </View>
  );
}

function ChooseRole({ partner, onPropose }: { partner: string; onPropose(role: IslandRole): void }) {
  const [role, setRole] = useState<IslandRole | null>(null);
  return (
    <View style={styles.block}>
      <Text variant="headline" accessibilityRole="header">{laichkugelTexts.chooseRole}</Text>
      <View style={styles.roles} accessibilityRole="radiogroup" accessibilityLabel={laichkugelTexts.chooseRole}>
        {(['bauen', 'natur'] as const).map((option) => (
          <Chip
            key={option}
            selection="single"
            selected={role === option}
            label={laichkugelTexts.role[option]}
            accessibilityLabel={laichkugelTexts.meaning(option)}
            onPress={() => setRole(option)}
          />
        ))}
      </View>
      {role === null ? (
        <View style={styles.split}>
          <Text tone="inkMuted">{laichkugelTexts.chooseHint}</Text>
          <Text variant="caption" tone="inkMuted">{laichkugelTexts.meaning('bauen')}</Text>
          <Text variant="caption" tone="inkMuted">{laichkugelTexts.meaning('natur')}</Text>
        </View>
      ) : (
        <Split own={role} partner={partner} />
      )}
      <Button block label={laichkugelTexts.send(partner)} disabled={role === null} onPress={() => role !== null && onPropose(role)} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space[3] },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  split: { gap: space[1] },
});
