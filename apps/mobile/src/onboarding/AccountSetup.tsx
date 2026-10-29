import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { DisplayName } from '@abnehm/contracts/base';

import { Notice, Skeleton, space, Text, TextField } from '../design';
import type { AccountSetupResult } from './onboarding';
import { useOnboarding } from './OnboardingContext';
import { OnboardingFrame } from './OnboardingFrame';
import { onboardingTexts } from './texts';

type SetupState = Readonly<{ type: 'laeuft' }> | AccountSetupResult;

/**
 * Einrichtung des Kontos (Zustand `bootstrap_ausstehend`, Route `sitzung`): nach Registrieren oder
 * Anmelden, bis die Person per Pull auf dem Gerät ist. Ein ausstehender Bootstrap wird dabei wiederholt.
 * Ohne Netz bietet der Bildschirm „Erneut versuchen“; kennt der Server keine Person und ist der
 * Anzeigename nicht mehr bekannt, fragt er danach. Den Wechsel zum Onboarding übernimmt die Weiche.
 */
export function AccountSetup() {
  const onboarding = useOnboarding();
  const [state, setState] = useState<SetupState>({ type: 'laeuft' });
  const [displayName, setDisplayName] = useState('');
  const [nameError, setNameError] = useState<string>();
  const mounted = useRef(true);

  const attempt = useCallback(
    async (input?: { displayName: DisplayName }) => {
      const result = await onboarding.setUpAccount(input);
      if (mounted.current) setState(result);
    },
    [onboarding],
  );

  // Beim Öffnen sofort einrichten; der Bildschirm beginnt im Zustand „läuft“.
  useEffect(() => {
    mounted.current = true;
    void attempt();
    return () => {
      mounted.current = false;
    };
  }, [attempt]);

  function run(input?: { displayName: DisplayName }) {
    setState({ type: 'laeuft' });
    void attempt(input);
  }

  function confirmName() {
    const parsed = DisplayName.safeParse(displayName.trim());
    setNameError(parsed.success ? undefined : onboardingTexts.invalidDisplayName);
    if (parsed.success) run({ displayName: parsed.data });
  }

  const primary =
    state.type === 'offline'
      ? { label: onboardingTexts.retry, onPress: () => run() }
      : state.type === 'name_fehlt'
        ? { label: onboardingTexts.setupConfirm, onPress: confirmName }
        : undefined;

  return (
    <OnboardingFrame step="konto" title={onboardingTexts.setupHeadline} primary={primary}>
      {state.type === 'offline' ? (
        <Notice tone="neutral" icon="offline" text={onboardingTexts.offline} />
      ) : state.type === 'name_fehlt' ? (
        <>
          <Text>{onboardingTexts.setupNameIntro}</Text>
          <TextField
            label={onboardingTexts.displayName}
            value={displayName}
            onChangeText={setDisplayName}
            hint={onboardingTexts.displayNameHint}
            problem={nameError}
            autoComplete="nickname"
            textContentType="nickname"
          />
        </>
      ) : (
        <View style={styles.waiting} accessible accessibilityLabel={onboardingTexts.setupWaiting}>
          <Text>{onboardingTexts.setupWaiting}</Text>
          <Skeleton height={20} />
          <Skeleton height={20} width="60%" />
        </View>
      )}
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  waiting: { gap: space[3] },
});
