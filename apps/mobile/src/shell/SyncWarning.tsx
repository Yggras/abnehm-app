import { useSyncExternalStore } from 'react';
import { View } from 'react-native';

import { Notice } from '../design';
import { syncStatusSource } from '../session/sync-status-source';

export function SyncWarning() {
  const status = useSyncExternalStore(syncStatusSource.subscribe, syncStatusSource.getSnapshot);
  if (status.type !== 'not_secured_since' && status.type !== 'migration_failed') return null;
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite">
      {status.type === 'migration_failed'
        ? <Notice tone="problem" cause="technik" text="Änderungen konnten nicht gesichert werden. Versuche es nach einem App-Update erneut." />
        : <Notice tone="neutral" icon="offline" text="Noch nicht gesichert – verbinde dich mit dem Internet" />}
    </View>
  );
}
