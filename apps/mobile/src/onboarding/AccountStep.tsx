import { useRef, useState } from 'react';
import { z } from 'zod';

import { Password, passwordPolicy } from '@abnehm/contracts/auth';
import { DisplayName, type Instant } from '@abnehm/contracts/base';

import type { RegisterResult, SignInResult } from '../auth';
import { Notice, Text, TextField, type TextFieldHandle } from '../design';
import { useOnboarding } from './OnboardingContext';
import { OnboardingFrame } from './OnboardingFrame';
import { onboardingTexts, passwordRejectionTexts } from './texts';

export type AccountMode = 'registrieren' | 'anmelden';

export type AccountStepProps = {
  mode: AccountMode;
  onModeChange: (mode: AccountMode) => void;
  /** Zurück zu Schritt 1. */
  onBack: () => void;
  /** Zeitpunkt der Bestätigung aus Schritt 1; das Onboarding setzt ihn an der Person des Kontos. */
  disclaimerAcceptedAt: Instant;
};

type Errors = Partial<Record<'email' | 'password' | 'displayName', string>>;
/** Hinweis über dem Formular, wenn der Auth-Ablauf scheitert, ohne dass ein Feld schuld ist. */
type Problem = 'offline' | 'invalid_credentials' | 'rate_limited';

const Email = z.email();

/** Prüft die Eingaben mit denselben Regeln wie der Server, bevor etwas gesendet wird. */
function check(mode: AccountMode, email: string, password: string, displayName: string): Errors {
  const errors: Errors = {};
  if (!Email.safeParse(email).success) errors.email = onboardingTexts.invalidEmail;
  if (mode === 'anmelden') {
    if (password === '') errors.password = onboardingTexts.missingPassword;
    return errors;
  }
  if (!Password.safeParse(password).success) {
    errors.password = passwordRejectionTexts[password.length > passwordPolicy.maxLength ? 'password_too_long' : 'password_too_short'];
  }
  if (!DisplayName.safeParse(displayName).success) errors.displayName = onboardingTexts.invalidDisplayName;
  return errors;
}

/** Was die Antwort des Auth-Moduls sichtbar macht; Erfolg übernimmt die Sitzungs-Weiche. */
function outcome(result: RegisterResult | SignInResult): { errors: Errors; problem: Problem | null } | null {
  switch (result.type) {
    case 'registered':
    case 'person_pending':
    case 'signed_in':
      return null;
    case 'rejected':
      return result.reason === 'email_invalid' || result.reason === 'email_taken'
        ? { errors: { email: onboardingTexts.emailNotPossible }, problem: null }
        : { errors: { password: passwordRejectionTexts[result.reason] }, problem: null };
    case 'invalid_credentials':
      return { errors: {}, problem: 'invalid_credentials' };
    case 'rate_limited':
      return { errors: {}, problem: 'rate_limited' };
    case 'unreachable':
      return { errors: {}, problem: 'offline' };
  }
}

/**
 * Schritt 2 „Konto“: Registrieren mit E-Mail, Passwort und Anzeigename oder, über „Ich habe schon ein
 * Konto“, Anmelden. Sichtbare Fehler kommen aus dem Auth-Modul und verraten nicht, ob eine E-Mail
 * registriert ist. Ohne Netz erscheint „Für dein Konto brauchst du kurz Internet“. Nach dem Erfolg führt
 * die Sitzungs-Weiche weiter zur Einrichtung des Kontos.
 */
export function AccountStep({ mode, onModeChange, onBack, disclaimerAcceptedAt }: AccountStepProps) {
  const onboarding = useOnboarding();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);
  const passwordField = useRef<TextFieldHandle>(null);
  const displayNameField = useRef<TextFieldHandle>(null);
  const registering = mode === 'registrieren';

  async function submit() {
    const input = { email: email.trim(), password, displayName: displayName.trim() };
    const invalid = check(mode, input.email, input.password, input.displayName);
    setErrors(invalid);
    setProblem(null);
    if (Object.keys(invalid).length > 0) return;
    setPending(true);
    const result = registering
      ? await onboarding.register({ ...input, displayName: DisplayName.parse(input.displayName), disclaimerAcceptedAt })
      : await onboarding.signIn({ email: input.email, password: input.password, disclaimerAcceptedAt });
    const shown = outcome(result);
    // Nach dem Erfolg bleibt der Button beschäftigt, bis die Weiche den nächsten Bildschirm zeigt.
    if (shown === null) return;
    setErrors(shown.errors);
    setProblem(shown.problem);
    setPending(false);
  }

  function switchMode() {
    setErrors({});
    setProblem(null);
    onModeChange(registering ? 'anmelden' : 'registrieren');
  }

  return (
    <OnboardingFrame
      step="konto"
      title={registering ? onboardingTexts.registerHeadline : onboardingTexts.signInHeadline}
      onBack={pending ? undefined : onBack}
      primary={{ label: registering ? onboardingTexts.register : onboardingTexts.signIn, onPress: () => void submit(), loading: pending }}
      secondary={{ label: registering ? onboardingTexts.haveAccount : onboardingTexts.newAccount, onPress: switchMode, disabled: pending }}
    >
      <Text>{registering ? onboardingTexts.registerIntro : onboardingTexts.signInIntro}</Text>
      {problem === 'offline' ? (
        <Notice tone="neutral" icon="offline" text={onboardingTexts.offline} />
      ) : problem === 'invalid_credentials' ? (
        <Notice tone="problem" cause="ungueltige_eingabe" text={onboardingTexts.invalidCredentials} />
      ) : problem === 'rate_limited' ? (
        <Notice tone="problem" cause="technik" text={onboardingTexts.rateLimited} />
      ) : null}
      <TextField
        label={onboardingTexts.email}
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        disabled={pending}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType={registering ? 'emailAddress' : 'username'}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordField.current?.focus()}
      />
      <TextField
        ref={passwordField}
        label={onboardingTexts.password}
        value={password}
        onChangeText={setPassword}
        hint={registering ? onboardingTexts.passwordHint : undefined}
        error={errors.password}
        disabled={pending}
        secure
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={registering ? 'new-password' : 'current-password'}
        textContentType={registering ? 'newPassword' : 'password'}
        // Beim Registrieren weiter zum Anzeigenamen, beim Anmelden sendet das letzte Feld ab.
        returnKeyType={registering ? 'next' : 'go'}
        submitBehavior={registering ? 'submit' : 'blurAndSubmit'}
        onSubmitEditing={() => (registering ? displayNameField.current?.focus() : void submit())}
      />
      {registering ? (
        <TextField
          ref={displayNameField}
          label={onboardingTexts.displayName}
          value={displayName}
          onChangeText={setDisplayName}
          hint={onboardingTexts.displayNameHint}
          error={errors.displayName}
          disabled={pending}
          autoComplete="nickname"
          textContentType="nickname"
          returnKeyType="go"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={() => void submit()}
        />
      ) : null}
    </OnboardingFrame>
  );
}
