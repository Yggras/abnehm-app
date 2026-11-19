import { useEffect, useRef } from 'react';
import { Share, StyleSheet, View } from 'react-native';

import type { CreateInvitationResult } from '@abnehm/contracts/coupling';

import { useClock } from '../clock/clock-context';
import { Button, Card, space, Text } from '../design';
import type { RouteScreenProps } from '../navigation';
import { useCreateInvitationCode } from '../online';
import { ScreenFrame } from '../shell/ScreenFrame';
import { titleOf } from '../shell/texts';
import { useCouplingState, usePartner } from './app-partner';
import { couplingProblemOf, validUntilWhen } from './coupling-view';
import { CoupledView, CouplingPending, CouplingProblemNotice, usePullWhile } from './CouplingParts';
import { couplingTexts, groupedCode } from './texts';

// Modaler Ablauf `partner.invite` (Spezifikation 5, Abschnitt 5; #120): erzeugt beim Öffnen einen Code,
// zeigt ihn in zwei Dreiergruppen samt „gültig bis …“ und teilt ihn über das System-Teilen-Menü
// (https://reactnative.dev/docs/share). Solange der Code offen ist, zieht die App alle 10 Sekunden; steht die
// Kopplung danach in SQLite, wechselt die Ansicht zu „Ihr seid gekoppelt“. Nur online.

export function InviteScreen({ target }: RouteScreenProps<'partner.invite'>) {
  const { state, create } = useCreateInvitationCode();
  const coupling = useCouplingState(usePartner());
  // Einmal beim Öffnen; ein zweiter Lauf (React StrictMode) trägt dieselbe `requestId` und erhält denselben Code.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    create();
  }, [create]);
  const coupled = state.type === 'ok' && coupling.type === 'coupled' ? coupling : null;
  usePullWhile(state.type === 'ok' && coupled === null);

  const problem = couplingProblemOf(state);
  return (
    <ScreenFrame title={titleOf(target)} presentation="modal">
      {coupled !== null ? (
        <CoupledView coupled={coupled} />
      ) : state.type === 'ok' ? (
        <InviteCode invitation={state.value} />
      ) : problem !== null ? (
        <CouplingProblemNotice problem={problem} onRetry={create} />
      ) : (
        <CouplingPending label={couplingTexts.creating} />
      )}
    </ScreenFrame>
  );
}

function InviteCode({ invitation: { code, expiresAt } }: { invitation: CreateInvitationResult }) {
  const now = useClock().read();
  const share = () => {
    // Ob geteilt oder abgebrochen, die Ansicht bleibt; ein Fehler des Menüs ändert nichts am Code.
    Share.share({ message: couplingTexts.shareMessage(code) }).catch(() => undefined);
  };
  return (
    <View style={styles.group}>
      <Text>{couplingTexts.inviteIntro}</Text>
      <Card>
        <View style={styles.code}>
          <Text variant="numberXl" accessibilityLabel={couplingTexts.codeSpoken(code)} testID="einladungscode">
            {groupedCode(code)}
          </Text>
          <Text variant="label" tone="inkMuted">
            {couplingTexts.validUntil(validUntilWhen(expiresAt, now))}
          </Text>
        </View>
      </Card>
      <Button block icon="share" label={couplingTexts.share} onPress={share} />
      <Text tone="inkMuted">{couplingTexts.waiting}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space[4] },
  code: { alignItems: 'center', gap: space[1], paddingVertical: space[3] },
});
