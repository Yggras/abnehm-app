import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { Button, color, IconButton, space, Text } from '../design';
import { closeRoute, type Presentation } from '../navigation';
import { shellTexts } from './texts';

export type ScreenFrameProps = {
  title: string;
  presentation: Presentation;
  children: ReactNode;
};

// Tabs enden über der Tab-Leiste, die den unteren sicheren Bereich selbst freihält.
const edges: Record<Presentation, Edge[]> = {
  tab: ['top', 'left', 'right'],
  page: ['top', 'left', 'right', 'bottom'],
  modal: ['top', 'left', 'right', 'bottom'],
};

/**
 * Rahmen eines Bildschirms je Darstellung: Tabs mit großem Titel, Seiten mit „Zurück“, modale
 * Abläufe mit „Fertig“. „Zurück“ und „Fertig“ kehren wie System-Zurück zum Aufrufer zurück.
 */
export function ScreenFrame({ title, presentation, children }: ScreenFrameProps) {
  return (
    <SafeAreaView edges={edges[presentation]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        {presentation === 'tab' ? (
          <Text variant="display" accessibilityRole="header" style={styles.tabTitle}>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.surfaceBase },
  content: { padding: space[4], gap: space[4] },
  tabTitle: { paddingTop: space[4] },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  barTitle: { flex: 1 },
});
