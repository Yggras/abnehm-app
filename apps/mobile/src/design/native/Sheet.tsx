import { BottomSheet, RNHostView } from '@expo/ui';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { color, size, space } from '../tokens';

export type SheetProps = {
  visible: boolean;
  /** Wird aufgerufen, wenn die Person das Sheet wegwischt, die Abdunklung antippt oder zurück geht. */
  onClose: () => void;
  /** Gebrandeter Inhalt; höchstens eine Primär-Aktion, keine Sheets in Sheets. */
  children: ReactNode;
  /** `full` für Formulare mit Tastatur oder langen Inhalten; ohne Angabe passt es sich dem Inhalt an. */
  height?: 'content' | 'full';
};

/**
 * Sheet-Container über `@expo/ui`: Griff, Abdunklung und Wischgeste sind nativ, der Inhalt ist
 * gebrandet (https://docs.expo.dev/versions/v58.0.0/sdk/ui/universal/bottomsheet/).
 *
 * Der Inhalt steht in einem `RNHostView`: Das Sheet liegt in einem eigenen Fenster, in dem sonst
 * niemand Berührungen an React Native weitergibt. Bei `content` nimmt der Host die Breite des
 * Sheets und die Höhe des Inhalts, sodass das Sheet weder zu hoch noch zu schmal wird. Sockelkanten
 * (`boxShadow`) zählen nicht zur gemessenen Höhe; Platz dafür hält der Host unten frei.
 */
export function Sheet({ visible, onClose, children, height = 'content' }: SheetProps) {
  const full = height === 'full';
  return (
    <BottomSheet
      isPresented={visible}
      onDismiss={onClose}
      containerColor={color.surfaceCard}
      scrimColor={color.surfaceOverlay}
      contentPadding={space[5]}
      snapPoints={full ? ['full'] : undefined}
    >
      <RNHostView matchContents={full ? false : { vertical: true }}>
        <View style={full ? styles.fill : styles.content}>{children}</View>
      </RNHostView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingBottom: size.plinthDepth },
});
