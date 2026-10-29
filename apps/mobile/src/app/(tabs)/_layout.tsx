import { useIsFocused } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { color, space } from '../../design';
import { MessageSlot } from '../../shell/MessageHost';
import { TabBar } from '../../shell/TabBar';
import { sceneTabs, TabBarOverlap } from '../../shell/tab-bar-overlap';
import { useMomoTabBadge } from '../../shell/tab-badge';

/**
 * Die fünf Plätze Heute · Protokoll · ＋ · Momo · Wir; das ＋ steuert die eigene Tab-Leiste bei.
 * Die Meldung liegt über der Leiste in derselben Fläche, damit Android Tipps auf „Rückgängig“
 * annimmt; außerhalb des Elternelements kämen sie nicht an. Auf Tabs mit bildschirmfüllender Szene
 * liegt die Leiste über dem Inhalt; ihre Höhe erfährt die Szene über `TabBarOverlap`.
 */
export default function TabsLayout() {
  const momoBadge = useMomoTabBadge();
  // Über Seiten und modalen Abläufen zeigt `ScreenFrame` die Meldung.
  const [barHeight, setBarHeight] = useState(0);
  const focused = useIsFocused();
  return (
    <View style={styles.root}>
      <TabBarOverlap value={barHeight}>
        <Tabs
          tabBar={(props) => (
            <TabBar
              {...props}
              momoBadge={momoBadge}
              overlay={sceneTabs.has(props.state.routes[props.state.index]?.name ?? '')}
              onLayout={(event) => setBarHeight(event.nativeEvent.layout.height)}
            />
          )}
          screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.surfaceBase } }}
        >
          <Tabs.Screen name="index" />
          <Tabs.Screen name="log" />
          <Tabs.Screen name="momo" />
          <Tabs.Screen name="partner" />
        </Tabs>
      </TabBarOverlap>
      {focused ? (
        <View style={[styles.messages, { bottom: barHeight + space[2] }]} pointerEvents="box-none">
          <MessageSlot />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  messages: { position: 'absolute', left: 0, right: 0 },
});
