import { Redirect } from 'expo-router';

import { pathOf } from '../navigation';

/** Unbekannte Ziele, etwa aus einem veralteten Deep Link, öffnen „Heute“ (Spezifikation 0, Abschnitt 6). */
export default function NotFound() {
  return <Redirect href={pathOf('today')} />;
}
