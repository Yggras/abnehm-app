import { render, screen, userEvent } from '@testing-library/react-native';
import { Text as NativeText, Pressable } from 'react-native';

import type { OnboardingStepOutcome } from '@abnehm/contracts/onboarding';

import { hitArea } from '../design/testing/hit-area';
import { OnboardingStep } from './OnboardingStep';
import { createOnboardingRegistry, MissingOnboardingStepError, onboardingSteps, type OnboardingStepProps } from './onboarding-registry';

// Onboarding-Registry (Spezifikation 0, Abschnitt 6): feste Reihenfolge der Steckplätze 9–11,
// Platzhalter für fehlende Beiträge, `complete` und `skipped` am Vertragsrand.

const runtime = globalThis as unknown as { __DEV__: boolean };
const developmentBuild = runtime.__DEV__;
afterEach(() => {
  runtime.__DEV__ = developmentBuild;
});

function HealthStep({ complete }: OnboardingStepProps<'health'>) {
  return (
    <Pressable accessibilityRole="button" onPress={() => complete({ type: 'health_connected' })}>
      <NativeText>Verbinden</NativeText>
    </Pressable>
  );
}

test('die Steckplätze stehen in der Reihenfolge der Schritte 9–11 mit ihrem Bereich', () => {
  expect(onboardingSteps).toEqual([
    { key: 'health', owner: 'tracker' },
    { key: 'notifications', owner: 'partner' },
    { key: 'partner', owner: 'partner' },
  ]);
});

test('ein Beitrag meldet sein Ergebnis über complete', async () => {
  const registry = createOnboardingRegistry();
  registry.register('tracker', 'health', HealthStep);
  const onComplete = jest.fn();
  await render(<OnboardingStep stepKey="health" registry={registry} onComplete={onComplete} />);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Verbinden' }));

  expect(onComplete).toHaveBeenCalledWith({ type: 'health_connected' });
});

test('ein Beitrag erhält ausschließlich complete', async () => {
  const registry = createOnboardingRegistry();
  const received: object[] = [];
  registry.register('partner', 'partner', (props) => {
    received.push(props);
    return null;
  });
  await render(<OnboardingStep stepKey="partner" registry={registry} onComplete={() => {}} />);

  expect(received.map((props) => Object.keys(props))).toEqual([['complete']]);
});

test('ein Ergebnis eines anderen Schritts ist ein Vertragsfehler und erreicht den Ablauf nicht', async () => {
  const registry = createOnboardingRegistry();
  let complete: ((outcome: OnboardingStepOutcome) => void) | undefined;
  registry.register('partner', 'notifications', (props) => {
    complete = props.complete as (outcome: OnboardingStepOutcome) => void;
    return null;
  });
  const onComplete = jest.fn();
  await render(<OnboardingStep stepKey="notifications" registry={registry} onComplete={onComplete} />);

  expect(() => complete!({ type: 'partner_coupled' })).toThrow();
  expect(onComplete).not.toHaveBeenCalled();
});

test.each(onboardingSteps.map((step) => [step.key, step.owner] as const))(
  'ohne Beitrag zeigt „%s“ im Development Build einen überspringbaren deutschen Platzhalter',
  async (key) => {
    const onComplete = jest.fn();
    await render(<OnboardingStep stepKey={key} registry={createOnboardingRegistry()} onComplete={onComplete} />);

    expect(screen.getByText('Dieser Schritt ist noch in Arbeit.')).toBeOnTheScreen();
    const skip = screen.getByRole('button', { name: 'Überspringen' });
    expect(hitArea(skip).height).toBeGreaterThanOrEqual(48);
    await userEvent.setup().press(skip);
    expect(onComplete).toHaveBeenCalledWith({ type: 'skipped' });
  },
);

test('der Platzhalter nennt den liefernden Bereich', async () => {
  await render(<OnboardingStep stepKey="health" registry={createOnboardingRegistry()} onComplete={() => {}} />);

  expect(screen.getByRole('header', { name: 'Gesundheitsdaten verbinden' })).toBeOnTheScreen();
  expect(screen.getByText('Kommt mit: Wasser, Sport, Gewicht & Health')).toBeOnTheScreen();
});

test('im Release ist ein fehlender Beitrag ein Integrationsfehler', async () => {
  runtime.__DEV__ = false;
  jest.spyOn(console, 'error').mockImplementation(() => {});

  await expect(render(<OnboardingStep stepKey="partner" registry={createOnboardingRegistry()} onComplete={() => {}} />)).rejects.toThrow(
    MissingOnboardingStepError,
  );
});

test('je Schritt meldet nur sein Bereich genau einen Beitrag an', () => {
  const registry = createOnboardingRegistry();
  expect(() => registry.register('partner' as never, 'health', HealthStep)).toThrow('gehört nicht');
  const unregister = registry.register('tracker', 'health', HealthStep);
  expect(() => registry.register('tracker', 'health', HealthStep)).toThrow('bereits registriert');
  unregister();
  expect(registry.element('health', { complete: () => {} })).toBeNull();
});
