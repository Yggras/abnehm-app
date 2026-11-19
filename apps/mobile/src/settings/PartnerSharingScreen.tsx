import { StyleSheet, View } from 'react-native';

import { readingOf } from '@abnehm/clock';

import { useClock } from '../clock/clock-context';
import { Button, size, Skeleton, space, Text } from '../design';
import { openTarget, type RouteScreenProps } from '../navigation';
import { useSharing, usePartner } from '../partner/app-partner';
import type { SharingView } from '../partner/partner';
import { PartnerAvatar } from '../partner/PartnerAvatar';
import { SharingSwitches } from '../partner/SharingSwitches';
import { partnerTexts, sharingTexts } from '../partner/texts';
import { ScreenFrame } from '../shell/ScreenFrame';
import { titleOf } from '../shell/texts';

/**
 * Seite „Partner & Freigaben“ (Spezifikation 5, Abschnitt 6; #129). Solo: „Nicht gekoppelt“ mit den Wegen zum
 * Koppeln. Gekoppelt: Kopf mit Avatar, Partner und Beginn der Kopplung, darunter die Schalter der eigenen Freigaben.
 * „Kopplung beenden“ kommt mit dem Entkoppeln (#130).
 */
export function PartnerSharingScreen({ target }: RouteScreenProps<'settings'>) {
  const partner = usePartner();
  const sharing = useSharing(partner);
  return (
    <ScreenFrame title={titleOf(target)} presentation="page">
      {partner === null || sharing.type === 'loading' ? (
        <View accessible accessibilityLabel={sharingTexts.loading}>
          <Skeleton width="100%" height={size.avatar} />
        </View>
      ) : sharing.type === 'solo' ? (
        <Solo />
      ) : (
        <>
          <CoupledHeader sharing={sharing} />
          <SharingSwitches partner={partner} sharing={sharing} />
        </>
      )}
    </ScreenFrame>
  );
}

/** Ohne Kopplung: dieselben Wege wie „Wir“ solo, als modale Abläufe, die hierher zurückkehren. */
export function Solo() {
  return (
    <View style={styles.group}>
      <Text variant="title">{sharingTexts.notCoupled}</Text>
      <Text tone="inkMuted">{sharingTexts.soloBody}</Text>
      <Button block icon="invite" label={partnerTexts.invite} onPress={() => openTarget({ type: 'partner.invite' })} />
      <Button block variant="secondary" label={partnerTexts.redeem} onPress={() => openTarget({ type: 'partner.redeem' })} />
    </View>
  );
}

function CoupledHeader({ sharing }: { sharing: Extract<SharingView, { type: 'coupled' }> }) {
  const clock = useClock();
  const since = sharingTexts.since(readingOf(sharing.since, clock.read().timeZone).localDate);
  const coupledWith = sharingTexts.coupledWith(sharing.partnerDisplayName);
  return (
    <View style={styles.header} accessible accessibilityLabel={`${coupledWith}. ${since}`}>
      <PartnerAvatar displayName={sharing.partnerDisplayName} />
      <View style={styles.identity}>
        <Text variant="title">{coupledWith}</Text>
        <Text variant="label" tone="inkMuted">
          {since}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space[4] },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  identity: { flex: 1, gap: space[1] },
});
