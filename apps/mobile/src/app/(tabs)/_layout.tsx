import { Tabs } from 'expo-router/js-tabs';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { color, space } from '../../design';
import { MessageSlot } from '../../shell/MessageHost';
import { TabBar } from '../../shell/TabBar';
import { useMomoTabBadge } from '../../shell/tab-badge';

/**
 * Die fünf Plätze Heute · Protokoll · ＋ · Momo · Wir; das ＋ steuert die eigene Tab-Leiste bei.
 * Die Meldung liegt über der Leiste in derselben Fläche, damit Android Tipps auf „Rückgängig“
 * annimmt; außerhalb des Elternelements kämen sie nicht an.
 */
export default function TabsLayout() {
  const momoBadge = useMomoTabBadge();
  const [barHeight, setBarHeight] = useState(0);
  return (
    <View style={styles.root}>
      <Tabs
        tabBar={(props) => (
          <TabBar {...props} momoBadge={momoBadge} onLayout={(event) => setBarHeight(event.nativeEvent.layout.height)} />
        )}
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.surfaceBase } }}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="log" />
        <Tabs.Screen name="momo" />
        <Tabs.Screen name="partner" />
      </Tabs>
      <View style={[styles.messages, { bottom: barHeight + space[2] }]} pointerEvents="box-none">
        <MessageSlot />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  messages: { position: 'absolute', left: 0, right: 0 },
});
