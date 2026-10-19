import { useIsFocused } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

import { Button, color, IconButton, space, Text } from '../design';
import { closeRoute, type Presentation } from '../navigation';
import { MessageSlot } from './MessageHost';
import { shellTexts } from './texts';

export type ScreenFrameProps = {
  title: string;
  presentation: Presentation;
  children: ReactNode;
  /** Auf Heute trägt der Personen-Kopf die große Überschrift; der Tabtitel bleibt klein zugänglich. */
  compactTabTitle?: boolean;
};

// Tabs enden über der Tab-Leiste, die den unteren sicheren Bereich selbst freihält.
const edges: Record<Presentation, Edge[]> = {
  tab: ['top', 'left', 'right'],
  page: ['top', 'left', 'right', 'bottom'],
  modal: ['top', 'left', 'right', 'bottom'],
  flow: ['top', 'left', 'right', 'bottom'],
};

/**
 * Rahmen eines Bildschirms je Darstellung: Tabs mit großem Titel, Seiten mit „Zurück“, modale
 * Abläufe mit „Fertig“, eigenständige Abläufe ohne beides. „Zurück“ und „Fertig“ kehren wie
 * System-Zurück zum Aufrufer zurück.
 * Seiten und modale Abläufe verdecken die Tab-Leiste; solange sie im Fokus sind, steht die
 * Meldung des Meldungs-Hosts deshalb an ihrem unteren Rand.
 */
export function ScreenFrame({ title, presentation, children, compactTabTitle = false }: ScreenFrameProps) {
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView edges={edges[presentation]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        {presentation === 'tab' ? (
          <Text variant={compactTabTitle ? 'label' : 'display'} accessibilityRole="header" style={compactTabTitle ? styles.compactTabTitle : styles.tabTitle}>
            {title}
          </Text>
        ) : (
          <View style={styles.bar}>
            {presentation === 'page' ? (
              <IconButton icon="back" accessibilityLabel={shellTexts.back} onPress={closeRoute} />
            ) : null}
            <Text variant="title" accessibilityRole="header" style={styles.barTitle}>
              {title}
            </Text>
            {presentation === 'modal' ? <Button label={shellTexts.done} variant="text" onPress={closeRoute} /> : null}
          </View>
        )}
        {children}
      </ScrollView>
      {presentation !== 'tab' && focused ? (
        <View style={[styles.messages, { bottom: insets.bottom + space[4] }]} pointerEvents="box-none">
          <MessageSlot />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.surfaceBase },
  content: { padding: space[4], gap: space[4] },
  tabTitle: { paddingTop: space[4] },
  compactTabTitle: { paddingTop: space[2] },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  barTitle: { flex: 1 },
  messages: { position: 'absolute', left: 0, right: 0 },
});
