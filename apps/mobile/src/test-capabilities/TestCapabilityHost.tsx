import type { RouteTarget } from '@abnehm/contracts/routes';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Notice, space } from '../design';
import { hrefFor } from '../navigation';
import type { AppSession } from '../session/app-session';
import type { SessionGate } from '../session/session-gate';
import { isSessionScreenGate, sessionScreenPath } from '../shell/session-routes';
import type { AppTestClock } from './clock';
import type { DeviceSuitePhase } from './device-suite/suite';
import type { TestInbox, TestStatus } from './inbox';
import { MomoGallery } from './momo-gallery/MomoGallery';
import { permissionNames, type NotificationTestControl, type NotificationTestMode } from './notifications';
import { transportFaultModeName } from './network';
import { runtimeProfiles } from './profiles';
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
    case 'profil_gestellt':
      return <Notice tone="neutral" text={`Laufzeitprofil „${status.profile}“: ${runtimeProfiles[status.profile].description}`} />;
    case 'geraetetest_laeuft':
      return <Notice tone="neutral" text={`Gerätetest ${phaseText[status.phase]} läuft …`} />;
    case 'geraetetest_fertig': {
      const { phase, results } = status.report;
      const failed = results.filter((result) => result.error !== null);
      return failed.length === 0
        ? <Notice tone="neutral" text={`Gerätetest ${phaseText[phase]}: ${results.length} von ${results.length} bestanden.`} />
        : <Notice tone="problem" cause="technik" text={`Gerätetest ${phaseText[phase]}: ${failed.length} von ${results.length} fehlgeschlagen. ${failed.map((result) => `${result.title}: ${result.error}`).join(' · ')}`} />;
    }
    case 'health_gestellt':
      return <Notice tone="neutral" text={`${status.scenario === 'geraet' ? 'Health des Geräts' : `Health-Attrappe „${status.scenario}“`}: ${healthOutcomeText[status.outcome]}`} />;
    case 'mitteilungen_gestellt':
      return <Notice tone="neutral" text={notificationModeText(status.mode)} />;
    case 'momo_galerie':
    // Ohne Hinweis, damit Bildschirmfotos des Scanners und seiner Folgezustände nichts verdeckt (#160).
    case 'produkt_gestellt':
      return null;
    case 'ungueltig':
      return <Notice tone="problem" cause="ungueltige_eingabe" text={`Ungültiger Link „${status.capability}“ der Testfähigkeiten. Parameter stehen in docs/entwicklung.md.`} />;
  }
}

function notificationModeText(mode: NotificationTestMode): string {
  return mode.type === 'system'
    ? 'Mitteilungen: echter Port des Systems.'
    : `Mitteilungen simuliert: ${permissionNames[mode.permission]}, Systemdialog antwortet „${permissionNames[mode.answer]}“.`;
}

/** So lange steht der Stand des Mitteilungs-Ports nach dem Link `mitteilungen`. */
export const notificationNoticeMs = 5000;

const phaseText: Record<DeviceSuitePhase, string> = { vor_neustart: 'vor Neustart', nach_neustart: 'nach Neustart' };

const healthOutcomeText: Record<Extract<TestStatus, { type: 'health_gestellt' }>['outcome'], string> = {
  verbunden: 'verbunden, Import läuft.',
  nicht_verfuegbar: 'Health nicht verfügbar.',
  installation_noetig: 'Installation nötig.',
  ohne_konto: 'gestellt; ohne geöffnetes Konto nicht verbunden.',
  fehlgeschlagen: 'fehlgeschlagen, siehe Metro-Log.',
};

export function TestCapabilityHost({
  inbox,
  clock,
  notifications,
  session,
  gate,
}: {
  inbox: TestInbox;
  clock: AppTestClock;
  notifications: NotificationTestControl;
  session: () => AppSession;
  /** Die Sitzungs-Weiche aus dem Wurzel-Layout; ein eigener Import ergäbe einen Zyklus über `device-session`. */
  gate: SessionGate | null;
}) {
  const status = useSyncExternalStore(inbox.subscribe, inbox.status);
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  // Je Seed ein eigenes Objekt; `opened` hält fest, welches Ziel schon geöffnet ist.
  const [seeded, setSeeded] = useState<{ target: RouteTarget } | null>(null);
  const opened = useRef<{ target: RouteTarget } | null>(null);

  useEffect(
    () =>
      inbox.handleSeeds(async (run) => {
        const outcome = await runSeed(run, { session: session(), clock, notifications });
        if (outcome.type === 'geseedet') setSeeded({ target: outcome.target });
        return outcome;
      }),
    [inbox, clock, notifications, session],
  );

  // Das Ziel erst öffnen, wenn die Weiche die Fachoberfläche freigibt und der Router die Sitzungsseite
  // verlassen hat. Nach der ersten Anmeldung leitet `Stack.Protected` von dort nach „Heute“ um; ein
  // früheres Ziel ginge dabei verloren (#155).
  useEffect(() => {
    if (seeded === null || opened.current === seeded || gate === null || isSessionScreenGate(gate)) return;
    if (pathname === sessionScreenPath) return;
    opened.current = seeded;
    router.replace(hrefFor(seeded.target));
  }, [seeded, gate, pathname]);

  // Der Stand des Mitteilungs-Ports verdeckt sonst dauerhaft den Kopf der Seite, etwa auf Bildern für
  // Impeccable; Maestro liest ihn sofort nach dem Link ab (#125).
  const [expiredStatus, setExpiredStatus] = useState<TestStatus | null>(null);
  useEffect(() => {
    if (status.type !== 'mitteilungen_gestellt') return;
    const timer = setTimeout(() => setExpiredStatus(status), notificationNoticeMs);
    return () => clearTimeout(timer);
  }, [status]);

  // Die Momo-Galerie (#187) liegt über der ganzen App, bis „Schließen“ sie für diesen Link schließt.
  const [closedGallery, setClosedGallery] = useState<TestStatus | null>(null);
  if (status.type === 'momo_galerie' && closedGallery !== status) {
    return <MomoGallery view={status.view} onClose={() => setClosedGallery(status)} />;
  }

  const notice = expiredStatus === status ? null : statusNotice(status);
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
