import { StyleSheet, View } from 'react-native';

import { Button, Icon, Notice, size, Skeleton, space, Text } from '../design';
import { openTarget } from '../navigation';
import { useInvitationCreated } from '../online';
import type { OnboardingStepProps } from '../shell/onboarding-registry';
import { usePartner, useSharing } from './app-partner';
import { SharingSwitches } from './SharingSwitches';
import { partnerTexts, sharingTexts } from './texts';

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
  const invitationCreated = useInvitationCreated();

  if (partner === null || sharing.type === 'loading') {
    return (
      <View accessible accessibilityLabel={sharingTexts.loading}>
        <Skeleton width="100%" height={size.avatar} />
      </View>
    );
  }
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
      <Button block variant={invitationCreated ? 'secondary' : 'primary'} icon="invite" label={partnerTexts.invite}
        onPress={() => openTarget({ type: 'partner.invite' })} />
      <Button block variant="secondary" label={partnerTexts.redeem} onPress={() => openTarget({ type: 'partner.redeem' })} />
      {invitationCreated ? <Button block label={sharingTexts.next} onPress={() => complete({ type: 'partner_invite_created' })} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  step: { gap: space[4] },
  explanation: { gap: space[3] },
  badge: { alignSelf: 'flex-start' },
});
