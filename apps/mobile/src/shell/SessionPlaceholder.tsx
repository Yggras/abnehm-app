import { router } from 'expo-router';

import { Button, Notice, Text } from '../design';
import type { SessionScreenGate } from '../session/session-gate';
import { useSessionGate } from '../session/use-session-gate';
import { ScreenFrame } from './ScreenFrame';
import { isSessionScreenGate } from './session-routes';
import { ownerName, shellTexts } from './texts';

// Bildschirm der Sitzungs-Weiche ohne Fachoberfläche (Route `sitzung`): Anmeldung, Einrichtung des
// Kontos und erneute Anmeldung nach `401`. Die Bildschirme liefert Spezifikation 1 (#138, #140), indem
// sie `src/app/sitzung.tsx` ersetzt; bis dahin zeigt der Development Build je Zustand einen Platzhalter.

const titles: Record<SessionScreenGate, string> = {
  ohne_sitzung: 'Anmelden',
  bootstrap_ausstehend: 'Konto wird eingerichtet',
  gesperrt: 'Bitte melde dich erneut an',
};

export class MissingSessionScreenError extends Error {
  constructor(gate: SessionScreenGate) {
    super(`Integrationsfehler: Für die Sitzungs-Weiche fehlt der Bildschirm „${titles[gate]}“.`);
    this.name = 'MissingSessionScreenError';
  }
}

export function SessionPlaceholder() {
  const gate = useSessionGate();
  // Zwischen zwei Zuständen der Weiche gibt es hier nichts zu zeigen; der Router führt gleich weiter.
  if (gate === null || !isSessionScreenGate(gate)) return null;
  if (!__DEV__) throw new MissingSessionScreenError(gate);
  return (
    <ScreenFrame title={titles[gate]} presentation="flow">
      <Notice tone="neutral" icon="hammer" text={shellTexts.placeholder} />
      <Text variant="caption" tone="inkMuted">
        {shellTexts.placeholderOwner(ownerName('ziele'))}
      </Text>
      <Text variant="caption" tone="inkMuted">
        {shellTexts.developer}
      </Text>
      <Button label={shellTexts.componentCatalog} variant="text" icon="layers" onPress={() => router.push('/katalog')} />
      <Button label={shellTexts.technicalCheck} variant="text" icon="pulse" onPress={() => router.push('/technik')} />
    </ScreenFrame>
  );
}
