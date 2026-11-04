import type { IslandRole } from '@abnehm/contracts/island';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Chip, space, Text } from '../design';
import { EggFrame } from './LaichkugelScreen';
import { otherRole, type RoleProposal } from './role-choice';
import { eggTexts } from './texts';

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
    <EggFrame headline={eggTexts.hatchesAfterRoles}>
      {proposal === null ? (
        <ChooseRole partner={partnerDisplayName} onPropose={onPropose} />
      ) : proposal.by === 'self' ? (
        <View style={styles.block}>
          <Text variant="headline" accessibilityRole="header">{eggTexts.sent}</Text>
          <Split own={proposal.proposerRole} partner={partnerDisplayName} />
          <Text tone="inkMuted">{eggTexts.answerHint(partnerDisplayName)}</Text>
          <Button block variant="secondary" label={eggTexts.withdraw} onPress={() => onWithdraw(proposal)} />
        </View>
      ) : (
        <View style={styles.block}>
          <Text variant="headline" accessibilityRole="header">{eggTexts.proposedBy(partnerDisplayName)}</Text>
          <Split own={otherRole(proposal.proposerRole)} partner={partnerDisplayName} />
          <Button block variant="secondary" label={eggTexts.decline} onPress={() => onDecline(proposal)} />
        </View>
      )}
    </EggFrame>
  );
}

/** Wer welche Rolle bekommt, mit der Bedeutung beider Rollen. */
function Split({ own, partner }: { own: IslandRole; partner: string }) {
  return (
    <View style={styles.split}>
      <Text variant="label">{eggTexts.split(own, partner, otherRole(own))}</Text>
      <Text variant="caption" tone="inkMuted">{eggTexts.meaning(own)}</Text>
      <Text variant="caption" tone="inkMuted">{eggTexts.meaning(otherRole(own))}</Text>
    </View>
  );
}

function ChooseRole({ partner, onPropose }: { partner: string; onPropose(role: IslandRole): void }) {
  const [role, setRole] = useState<IslandRole | null>(null);
  return (
    <View style={styles.block}>
      <Text variant="headline" accessibilityRole="header">{eggTexts.chooseRole}</Text>
      <View style={styles.roles} accessibilityRole="radiogroup" accessibilityLabel={eggTexts.chooseRole}>
        {(['bauen', 'natur'] as const).map((option) => (
          <Chip
            key={option}
            selection="single"
            selected={role === option}
            label={eggTexts.role[option]}
            accessibilityLabel={eggTexts.meaning(option)}
            onPress={() => setRole(option)}
          />
        ))}
      </View>
      {role === null ? <Text tone="inkMuted">{eggTexts.chooseHint}</Text> : <Split own={role} partner={partner} />}
      <Button block label={eggTexts.send(partner)} disabled={role === null} onPress={() => role !== null && onPropose(role)} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space[3] },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  split: { gap: space[1] },
});
