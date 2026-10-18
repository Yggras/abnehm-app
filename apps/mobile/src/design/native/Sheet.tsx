import { BottomSheet } from '@expo/ui';
import type { ReactNode } from 'react';

import { color, space } from '../tokens';

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
 */
export function Sheet({ visible, onClose, children, height = 'content' }: SheetProps) {
  return (
    <BottomSheet
      isPresented={visible}
      onDismiss={onClose}
      containerColor={color.surfaceCard}
      scrimColor={color.surfaceOverlay}
      contentPadding={space[5]}
      snapPoints={height === 'full' ? ['full'] : undefined}
    >
      {children}
    </BottomSheet>
  );
}
