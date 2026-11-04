import type { IslandRole } from '@abnehm/contracts/island';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Chip, space, Text } from '../design';
import { LaichkugelFrame } from './LaichkugelScreen';
import { otherRole, type RoleProposal } from './role-choice';
import { laichkugelTexts } from './texts';

// Ansicht `rollenwahl` des Tabs „Momo“ (Spezifikation 4, Abschnitt 7; #180): eigene Rolle wählen und
// vorschlagen, den Vorschlag des Partners sehen und ablehnen, den eigenen zurückziehen. Annehmen und
// damit das Schlüpfen liefert #184.

export type RoleChoiceScreenProps = Readonly<{
  partnerDisplayName: string;
  proposal: RoleProposal | null;
  onPropose(role: IslandRole): void;
  onDecline(proposal: RoleProposal): void;
  onWithdraw(proposal: RoleProposal): void;
}>;

export function RoleChoiceScreen({ partnerDisplayName, proposal, onPropose, onDecline, onWithdraw }: RoleChoiceScreenProps) {
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
      ) : (
        <View style={styles.block}>
          <Text variant="headline" accessibilityRole="header">{laichkugelTexts.proposedBy(partnerDisplayName)}</Text>
          <Split own={otherRole(proposal.proposerRole)} partner={partnerDisplayName} />
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
      {role === null ? <Text tone="inkMuted">{laichkugelTexts.chooseHint}</Text> : <Split own={role} partner={partner} />}
      <Button block label={laichkugelTexts.send(partner)} disabled={role === null} onPress={() => role !== null && onPropose(role)} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space[3] },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  split: { gap: space[1] },
});
