import { router } from 'expo-router';
import { useEffect, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Notice, space } from '../design';
import { hrefFor } from '../navigation';
import type { AppSession } from '../session/app-session';
import type { AppTestClock } from './clock';
import type { TestInbox, TestStatus } from './inbox';
import { runSeed } from './seed/seed-flow';

// Wirt der Testfähigkeiten im Development Build (#112): führt Seeds mit der App-Sitzung aus, öffnet
// danach das Ziel und zeigt kurz, was gerade passiert. Nur über `build-capabilities.ts` erreichbar.

const failureText: Record<Extract<TestStatus, { type: 'seed_fehlgeschlagen' }>['step'], string> = {
  installation: 'Seed fehlgeschlagen: Das Szenario kennt diese Installation nicht.',
  backend: 'Seed fehlgeschlagen: Das Development-Backend ist nicht erreichbar. Läuft `npm run backend`?',
  anmeldung: 'Seed fehlgeschlagen: Das Testkonto ließ sich nicht anmelden.',
  lokal: 'Seed fehlgeschlagen: Die lokale Datenbank ließ sich nicht seeden.',
  unerwartet: 'Seed fehlgeschlagen: unerwarteter Fehler, siehe Metro-Log.',
};

function statusNotice(status: TestStatus) {
  switch (status.type) {
    case 'ruhe':
    case 'seed_fertig':
      return null;
    case 'seed_laeuft':
      return <Notice tone="neutral" text={`Seed „${status.run.scenario}“ wird geladen …`} />;
    case 'seed_fehlgeschlagen':
      return <Notice tone="problem" cause="technik" text={failureText[status.step]} />;
    case 'fehler_gestellt': {
      const active = Object.entries(status.plan).filter(([, value]) => value !== 'ok');
      return <Notice tone="neutral" text={active.length === 0 ? 'Fehler-Adapter: alles normal.' : `Fehler-Adapter: ${active.map(([key, value]) => `${key} ${value}`).join(', ')}.`} />;
    }
    case 'ungueltig':
      return <Notice tone="problem" cause="ungueltige_eingabe" text={`Ungültiger ${status.capability === 'seed' ? 'Seed' : 'Fehler'}-Link. Parameter stehen in docs/entwicklung.md.`} />;
  }
}

export function TestCapabilityHost({ inbox, clock, session }: { inbox: TestInbox; clock: AppTestClock; session: () => AppSession }) {
  const status = useSyncExternalStore(inbox.subscribe, inbox.status);
  const insets = useSafeAreaInsets();

  useEffect(
    () =>
      inbox.handleSeeds(async (run) => {
        const outcome = await runSeed(run, { session: session(), clock });
        if (outcome.type === 'geseedet') router.replace(hrefFor(outcome.target));
        return outcome;
      }),
    [inbox, clock, session],
  );

  const notice = statusNotice(status);
  if (notice === null) return null;
  return (
    <View pointerEvents="box-none" style={[styles.overlay, { top: insets.top + space[2] }]}>
      {notice}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: space[4], right: space[4] },
});
