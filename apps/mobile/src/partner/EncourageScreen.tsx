import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { encouragementMessages } from '@abnehm/contracts/notification-texts';
import { EncouragementKey } from '@abnehm/contracts/partner';

import { Button, Notice, Skeleton, size, space, Text } from '../design';
import { closeRoute, type RouteScreenProps } from '../navigation';
import { useMessageHost } from '../shell/MessageHost';
import { ScreenFrame } from '../shell/ScreenFrame';
import { titleOf } from '../shell/texts';
import { useEncourageView, usePartner } from './app-partner';
import type { EncourageView, Partner } from './partner';
import { partnerTexts } from './texts';

// Sheet `partner.encourage` (Spezifikation 5, Abschnitt 4; #123): fünf feste Botschaften, ein Tipp sendet
// sofort, ohne Rückfrage („Ein Tipp genügt“). Danach schließt das Sheet, und der Meldungs-Host bestätigt.
// Keine Haptik: Sie bleibt den Erfolgen vorbehalten (Abschnitt 12). Die Meldung erscheint mit der Bewegung
// des Meldungs-Hosts, unter „Bewegung reduzieren“ als kurze Überblendung.

export function EncourageScreen({ target }: RouteScreenProps<'partner.encourage'>) {
  const partner = usePartner();
  const view = useEncourageView(partner);
  return (
    <ScreenFrame title={view.type === 'coupled' ? partnerTexts.encourageTitle(view.partnerDisplayName) : titleOf(target)} presentation="modal">
      {partner === null || view.type === 'loading' ? (
        <Skeleton width="100%" height={size.fieldHeight} />
      ) : view.type === 'solo' ? (
        <Notice tone="neutral" text={partnerTexts.encourageSolo} />
      ) : (
        <Messages partner={partner} view={view} />
      )}
    </ScreenFrame>
  );
}

function Messages({ partner, view }: { partner: Partner; view: Extract<EncourageView, { type: 'coupled' }> }) {
  const { showMessage } = useMessageHost();
  // Ein zweiter Tipp, bevor das Sheet geschlossen ist, sendet nicht noch einmal.
  const sent = useRef(false);
  const send = (messageKey: EncouragementKey) => {
    if (sent.current) return;
    sent.current = true;
    const outcome = partner.encourage(messageKey);
    if (outcome.type === 'gesendet') {
      showMessage(view.online
        ? { messageKey: 'anfeuern.gesendet', values: { partnerDisplayName: view.partnerDisplayName } }
        : { messageKey: 'anfeuern.vorgemerkt', values: {} });
    }
    closeRoute();
  };
  return (
    <>
      <View testID="anfeuern-botschaften" style={styles.messages}>
        {EncouragementKey.options.map((messageKey) => (
          <Button key={messageKey} block variant="secondary" label={encouragementMessages[messageKey]} onPress={() => send(messageKey)} />
        ))}
      </View>
      <Text testID="anfeuern-zaehler" tone="inkMuted">
        {view.remainingPushes > 0
          ? partnerTexts.remainingPushes(view.remainingPushes)
          : partnerTexts.withoutPush(view.partnerDisplayName)}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  messages: { gap: space[3] },
});
