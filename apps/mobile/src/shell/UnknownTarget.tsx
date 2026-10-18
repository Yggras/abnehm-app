import { Redirect } from 'expo-router';
import { useEffect } from 'react';

import { pathOf } from '../navigation/route-catalog';
import { useMessageHost } from './MessageHost';

/**
 * Ein unbekanntes Ziel oder ungültige Parameter, etwa aus einem veralteten Link einer
 * Benachrichtigung: „Heute“ öffnet sich, und eine neutrale Meldung sagt, warum.
 */
export function UnknownTarget() {
  const { showMessage } = useMessageHost();
  useEffect(() => {
    showMessage({ messageKey: 'shell.ziel_unbekannt', values: {} });
  }, [showMessage]);
  return <Redirect href={pathOf('today')} />;
}
