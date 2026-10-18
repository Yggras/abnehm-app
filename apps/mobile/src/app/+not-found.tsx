import { Redirect } from 'expo-router';

/** Unbekannte Ziele, etwa aus einem veralteten Deep Link, öffnen „Heute“ (Spezifikation 0, Abschnitt 6). */
export default function NotFound() {
  return <Redirect href="/" />;
}
