import { StyleSheet, View } from 'react-native';

import { color, radius, size, Text } from '../design';

/**
 * Avatar des Partners (44 dp, `research/design-system.md`) in der Partnerfarbe mit der Initiale des
 * Anzeigenamens, auf „Wir“ und der Partner-Karte von „Heute“. Den Namen trägt der umgebende Text.
 */
export function PartnerAvatar({ displayName }: { displayName: string }) {
  return (
    <View style={styles.avatar}>
      {/* Weiß auf `partner` nur als großer, fetter Text (research/design-system.md, Kontrasttabelle). */}
      <Text variant="title" tone="onPrimary">
        {[...displayName][0]!.toLocaleUpperCase('de-DE')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: size.avatar,
    height: size.avatar,
    borderRadius: radius.pill,
    backgroundColor: color.partner,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
