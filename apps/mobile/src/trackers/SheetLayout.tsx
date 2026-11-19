import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { space, Text } from '../design';

/**
 * Inhalt eines Sheets des Tracker-Bereichs: Titel und Inhalt scrollen, die Aktionen stehen als Fuß darunter.
 * So erreichen Tipps sie auch bei offener Tastatur und bei Schriftfaktor 2,0.
 */
export function SheetLayout({ title, actions, children }: { title: string; actions: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.sheet}>
      <ScrollView testID="sheet-scroll" style={styles.sheetScroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
        {children}
      </ScrollView>
      <View style={styles.footer}>{actions}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  sheetScroll: { flex: 1 },
  content: { gap: space[4] },
  footer: { gap: space[2], paddingTop: space[3] },
});
