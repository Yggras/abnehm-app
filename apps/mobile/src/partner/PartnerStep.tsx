import { StyleSheet, View } from 'react-native';

import { Button, Icon, Notice, space, Text } from '../design';
import type { OnboardingStepProps } from '../shell/onboarding-registry';
import { useInvitationCreated, usePartner, useSharing } from './app-partner';
import { CouplingButtons } from './CouplingParts';
import { SharingLoading, SharingSwitches } from './SharingSwitches';
import { sharingTexts } from './texts';

/**
 * Onboarding-Schritt 11 `partner` (Spezifikation 5, Abschnitt 5; #129) am Steckplatz der Onboarding-Registry. Solo
 * öffnen „Partner einladen“ und „Code eingeben“ die modalen Abläufe `partner.invite` und `partner.redeem`, die aus dem
 * Onboarding hierher zurückkehren. Nach der Kopplung zeigt der Schritt die Freigaben mit ihren Startwerten und
 * denselben Schaltern wie „Partner & Freigaben“; „Weiter“ meldet `partner_coupled`. Entstand nur ein Code, meldet
 * „Weiter“ `partner_invite_created`; die Kopplung kann später entstehen. „Überspringen“ zeichnet Spezifikation 1.
 */
export function PartnerStep({ complete }: OnboardingStepProps<'partner'>) {
  const partner = usePartner();
  const sharing = useSharing(partner);
  const invitationCreated = useInvitationCreated(partner);

  if (partner === null || sharing.type === 'loading') return <SharingLoading />;
  if (sharing.type === 'coupled') {
    return (
      <View style={styles.step}>
        <Text variant="headline">{sharingTexts.stepCoupled(sharing.partnerDisplayName)}</Text>
        <SharingSwitches partner={partner} sharing={sharing} />
        <Button block label={sharingTexts.next} onPress={() => complete({ type: 'partner_coupled' })} />
      </View>
    );
  }
  return (
    <View style={styles.step}>
      <View style={styles.explanation}>
        <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Icon name="people" size="lg" tone="primary" />
        </View>
        <Text variant="headline">{sharingTexts.stepSolo}</Text>
      </View>
      {invitationCreated ? <Notice tone="neutral" icon="invite" text={sharingTexts.stepInviteCreated} /> : null}
      <CouplingButtons invitePrimary={!invitationCreated} />
      {invitationCreated ? <Button block label={sharingTexts.next} onPress={() => complete({ type: 'partner_invite_created' })} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  step: { gap: space[4] },
  explanation: { gap: space[3] },
  badge: { alignSelf: 'flex-start' },
});
