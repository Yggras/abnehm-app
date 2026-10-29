import { StyleSheet } from 'react-native';

import { space, Text } from '../design';

/** Überschrift einer Gruppe in den Einstellungen; Screenreader springen von Gruppe zu Gruppe. */
export function SectionTitle({ children }: { children: string }) {
  return (
    <Text variant="label" tone="inkMuted" accessibilityRole="header" style={styles.title}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  title: { paddingHorizontal: space[1], paddingTop: space[2] },
});
