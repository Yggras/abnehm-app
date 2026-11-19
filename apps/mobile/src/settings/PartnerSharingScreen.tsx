import { StyleSheet, View } from 'react-native';

import { readingOf } from '@abnehm/clock';

import { useClock } from '../clock/clock-context';
import { space, Text } from '../design';
import type { RouteScreenProps } from '../navigation';
import { useSharing, usePartner } from '../partner/app-partner';
import type { SharingView } from '../partner/partner';
import { PartnerAvatar } from '../partner/PartnerAvatar';
import { CouplingButtons } from '../partner/CouplingParts';
import { SharingLoading, SharingSwitches } from '../partner/SharingSwitches';
import { sharingTexts } from '../partner/texts';
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
        <SharingLoading />
      ) : sharing.type === 'solo' ? (
        <NotCoupled />
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
function NotCoupled() {
  return (
    <View style={styles.group}>
      <Text variant="title">{sharingTexts.notCoupled}</Text>
      <Text tone="inkMuted">{sharingTexts.soloBody}</Text>
      <CouplingButtons />
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
