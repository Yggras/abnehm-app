import { AccountSetup, FirstStart } from '../onboarding';
import { useSessionGate } from '../session/use-session-gate';
import { SessionPlaceholder } from '../shell/SessionPlaceholder';

// Bildschirme der Sitzungs-Weiche ohne Fachoberfläche (#110): Den ersten Start mit den
// Onboarding-Schritten 1 und 2 und die Einrichtung des Kontos liefert #138, die erneute Anmeldung nach
// `401` folgt mit #140.
export default function SessionScreen() {
  const gate = useSessionGate();
  if (gate === 'ohne_sitzung') return <FirstStart />;
  if (gate === 'bootstrap_ausstehend') return <AccountSetup />;
  return <SessionPlaceholder />;
}
