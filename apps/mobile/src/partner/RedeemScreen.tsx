import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { InviteCode, type CheckInvitationResult } from '@abnehm/contracts/coupling';

import { Button, Notice, space, Text, TextField } from '../design';
import type { RouteScreenProps } from '../navigation';
import { useAcceptInvitation, useCheckInvitationCode } from '../online';
import { ScreenFrame } from '../shell/ScreenFrame';
import { titleOf } from '../shell/texts';
import { useCouplingState, usePartner } from './app-partner';
import { couplingProblemOf } from './coupling-view';
import { CoupledView, CouplingPending, CouplingProblemNotice, usePullWhile } from './CouplingParts';
import { couplingTexts } from './texts';

// Modaler Ablauf `partner.redeem` (Spezifikation 5, Abschnitt 5; #120): sechs Ziffern eingeben, lokal nur
// Länge und Ziffern prüfen, „Weiter“ prüft den Code beim Server, ohne ihn zu verbrauchen, die Bestätigung
// nennt die einladende Person und bei einer Reaktivierung, was zurückkommt, „Koppeln“ nimmt an. Die
// Annahme holt die Kopplung per Pull in SQLite (#103); erst wenn sie dort steht, zeigt die Ansicht „Ihr seid
// gekoppelt“, bis dahin zieht sie im 10-Sekunden-Takt nach. Nur online.

export function RedeemScreen({ target }: RouteScreenProps<'partner.redeem'>) {
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState(false);
  const check = useCheckInvitationCode();
  const accept = useAcceptInvitation();
  const coupling = useCouplingState(usePartner());
  const accepted = check.state.type === 'ok' && accept.state.type === 'ok';
  usePullWhile(accepted && coupling.type !== 'coupled');

  const otherCode = () => {
    accept.reset();
    check.reset();
  };

  let content;
  if (accepted) {
    content = coupling.type === 'coupled'
      ? <CoupledView coupled={coupling} />
      : <CouplingPending label={couplingTexts.loadingCoupling} />;
  } else if (check.state.type === 'ok') {
    const checkedCode = code;
    content = (
      <Confirmation
        invitation={check.state.value}
        pending={accept.state.type === 'pending'}
        problem={couplingProblemOf(accept.state)}
        onCouple={() => accept.accept(checkedCode)}
        onOtherCode={otherCode}
      />
    );
  } else {
    const next = () => {
      const parsed = InviteCode.safeParse(code);
      setInvalid(!parsed.success);
      if (parsed.success) check.check(parsed.data);
    };
    const problem = couplingProblemOf(check.state);
    content = (
      <View style={styles.group}>
        <TextField
          label={couplingTexts.codeLabel}
          hint={couplingTexts.codeHint}
          problem={invalid ? couplingTexts.codeInvalid : undefined}
          value={code}
          onChangeText={(text) => {
            setCode(text);
            setInvalid(false);
            if (check.state.type !== 'idle') check.reset();
          }}
          keyboardType="number-pad"
          autoComplete="off"
          autoCorrect={false}
          maxLength={6}
          returnKeyType="next"
          onSubmitEditing={next}
        />
        {problem !== null ? <CouplingProblemNotice problem={problem} onRetry={next} /> : null}
        <Button block label={couplingTexts.next} loading={check.state.type === 'pending'} onPress={next} />
      </View>
    );
  }
  return (
    <ScreenFrame title={titleOf(target)} presentation="modal">
      {content}
    </ScreenFrame>
  );
}

function Confirmation({
  invitation,
  pending,
  problem,
  onCouple,
  onOtherCode,
}: {
  invitation: CheckInvitationResult;
  pending: boolean;
  problem: ReturnType<typeof couplingProblemOf>;
  onCouple: () => void;
  onOtherCode: () => void;
}) {
  return (
    <View style={styles.group}>
      <Text variant="title" accessibilityRole="header">
        {couplingTexts.confirmTitle(invitation.inviterDisplayName)}
      </Text>
      {invitation.reactivates ? <Notice tone="partner" icon="island" text={couplingTexts.reactivates} /> : null}
      {problem !== null ? <CouplingProblemNotice problem={problem} onRetry={onCouple} /> : null}
      <Button block label={couplingTexts.couple} loading={pending} onPress={onCouple} />
      <Button block variant="text" label={couplingTexts.otherCode} onPress={onOtherCode} />
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space[4] },
});
