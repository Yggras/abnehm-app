import { Tabs } from 'expo-router/js-tabs';

import { color } from '../../design';
import { TabBar } from '../../shell/TabBar';
import { useMomoTabBadge } from '../../shell/tab-badge';

/** Die fünf Plätze Heute · Protokoll · ＋ · Momo · Wir; das ＋ steuert die eigene Tab-Leiste bei. */
export default function TabsLayout() {
  const momoBadge = useMomoTabBadge();
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} badges={{ momo: momoBadge }} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.surfaceBase } }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="log" />
      <Tabs.Screen name="momo" />
      <Tabs.Screen name="partner" />
    </Tabs>
  );
}
