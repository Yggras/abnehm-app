import { useEffect, useRef } from 'react';
import { Share, StyleSheet, View } from 'react-native';

import type { CreateInvitationResult } from '@abnehm/contracts/coupling';

import { useClock } from '../clock/clock-context';
import { Button, Card, Skeleton, space, Text } from '../design';
import type { RouteScreenProps } from '../navigation';
import { useCreateInvitationCode } from '../online';
import { ScreenFrame } from '../shell/ScreenFrame';
import { useSyncRefresh } from '../shell/SyncRefresh';
import { titleOf } from '../shell/texts';
import { usePartner, useWirPartner } from './app-partner';
import { couplingProblemOf, validUntilWhen } from './coupling-view';
import { CoupledView, CouplingProblemNotice } from './CouplingParts';
import { couplingTexts, groupedCode } from './texts';

// Modaler Ablauf `partner.invite` (Spezifikation 5, Abschnitt 5; #120): erzeugt beim Öffnen einen Code,
// zeigt ihn in zwei Dreiergruppen samt „gültig bis …“ und teilt ihn über das System-Teilen-Menü
// (https://reactnative.dev/docs/share). Solange der Code offen ist, zieht die App alle 10 Sekunden; steht die
// Kopplung danach in SQLite, wechselt die Ansicht zu „Ihr seid gekoppelt“. Nur online.

/** Takt des Pulls, solange die Einladung offen ist (Spezifikation 5, Abschnitt 5). */
export const invitePullIntervalMs = 10_000;

export function InviteScreen({ target }: RouteScreenProps<'partner.invite'>) {
  const { state, create } = useCreateInvitationCode();
  const coupled = useWirPartner(usePartner());
  // Einmal beim Öffnen; ein zweiter Lauf (React StrictMode) trägt dieselbe `requestId` und erhält denselben Code.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    create();
  }, [create]);
  const partnerDisplayName = state.type === 'ok' && coupled.type === 'coupled' ? coupled.displayName : null;
  usePullWhile(state.type === 'ok' && partnerDisplayName === null);

  const problem = couplingProblemOf(state);
  return (
    <ScreenFrame title={titleOf(target)} presentation="modal">
      {partnerDisplayName !== null ? (
        // Ob die Annahme reaktiviert hat, erfährt nur die annehmende Person; hier gilt der Weg zum Schlüpfen, und
        // der Tab „Momo“ zeigt nach einer Reaktivierung ohnehin die Insel.
        <CoupledView partnerDisplayName={partnerDisplayName} reactivated={false} />
      ) : state.type === 'ok' ? (
        <InviteCode invitation={state.value} />
      ) : problem !== null ? (
        <CouplingProblemNotice problem={problem} onRetry={create} />
      ) : (
        <View accessible accessibilityLabel={couplingTexts.creating} style={styles.group}>
          <Skeleton width="100%" height={136} />
        </View>
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

/** Startet im Takt `invitePullIntervalMs` einen Sync, solange `active` gilt und die Ansicht offen ist. */
function usePullWhile(active: boolean) {
  // Der Auslöser des App-Roots ist je Render eine neue Funktion; der Takt beginnt deshalb nicht neu mit ihm.
  const latest = useSyncRefresh();
  const refresh = useRef(latest);
  useEffect(() => {
    refresh.current = latest;
  }, [latest]);
  useEffect(() => {
    if (!active) return undefined;
    const interval = setInterval(() => {
      void refresh.current?.().catch(() => undefined);
    }, invitePullIntervalMs);
    return () => clearInterval(interval);
  }, [active]);
}

const styles = StyleSheet.create({
  group: { gap: space[4] },
  code: { alignItems: 'center', gap: space[1], paddingVertical: space[3] },
});
