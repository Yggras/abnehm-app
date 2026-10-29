import type { RouteTarget } from '@abnehm/contracts/routes';
import { router } from 'expo-router';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Notice, space } from '../design';
import { hrefFor } from '../navigation';
import type { AppSession } from '../session/app-session';
import { useSessionGate } from '../session/use-session-gate';
import { isSessionScreenGate } from '../shell/session-routes';
import type { AppTestClock } from './clock';
import type { DeviceSuitePhase } from './device-suite/suite';
import type { TestInbox, TestStatus } from './inbox';
import { transportFaultModeName } from './network';
import { runSeed } from './seed/seed-flow';

// Wirt der Testfähigkeiten in Test-Artefakten (#112, #114): führt Seeds mit der App-Sitzung aus, öffnet
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
      const network = status.plan.transport === 'offline' ? ` ${transportFaultModeName}: kein Netz.` : '';
      return <Notice tone="neutral" text={active.length === 0 ? 'Fehler-Adapter: alles normal.' : `Fehler-Adapter: ${active.map(([key, value]) => `${key} ${value}`).join(', ')}.${network}`} />;
    }
    case 'uhr_gestellt':
      return <Notice tone="neutral" text={`Testuhr: ${status.reading.instant}, ${status.reading.timeZone}.`} />;
    case 'geraetetest_laeuft':
      return <Notice tone="neutral" text={`Gerätetest ${phaseText[status.phase]} läuft …`} />;
    case 'geraetetest_fertig': {
      const { phase, results } = status.report;
      const failed = results.filter((result) => result.error !== null);
      return failed.length === 0
        ? <Notice tone="neutral" text={`Gerätetest ${phaseText[phase]}: ${results.length} von ${results.length} bestanden.`} />
        : <Notice tone="problem" cause="technik" text={`Gerätetest ${phaseText[phase]}: ${failed.length} von ${results.length} fehlgeschlagen. ${failed.map((result) => `${result.title}: ${result.error}`).join(' · ')}`} />;
    }
    case 'ungueltig':
      return <Notice tone="problem" cause="ungueltige_eingabe" text={`Ungültiger Link „${status.capability}“ der Testfähigkeiten. Parameter stehen in docs/entwicklung.md.`} />;
  }
}

const phaseText: Record<DeviceSuitePhase, string> = { vor_neustart: 'vor Neustart', nach_neustart: 'nach Neustart' };

export function TestCapabilityHost({ inbox, clock, session }: { inbox: TestInbox; clock: AppTestClock; session: () => AppSession }) {
  const status = useSyncExternalStore(inbox.subscribe, inbox.status);
  const insets = useSafeAreaInsets();
  const gate = useSessionGate();
  // Je Seed ein eigenes Objekt; `opened` hält fest, welches Ziel schon geöffnet ist.
  const [seeded, setSeeded] = useState<{ target: RouteTarget } | null>(null);
  const opened = useRef<{ target: RouteTarget } | null>(null);

  useEffect(
    () =>
      inbox.handleSeeds(async (run) => {
        const outcome = await runSeed(run, { session: session(), clock });
        if (outcome.type === 'geseedet') setSeeded({ target: outcome.target });
        return outcome;
      }),
    [inbox, clock, session],
  );

  // Das Ziel erst öffnen, wenn die Weiche die Fachoberfläche freigibt. Nach der ersten Anmeldung steht sie
  // kurz noch auf der Anmeldung; `Stack.Protected` leitete das Ziel sonst um, und es ginge verloren (#155).
  useEffect(() => {
    if (seeded === null || opened.current === seeded || gate === null || isSessionScreenGate(gate)) return;
    opened.current = seeded;
    router.replace(hrefFor(seeded.target));
  }, [seeded, gate]);

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
