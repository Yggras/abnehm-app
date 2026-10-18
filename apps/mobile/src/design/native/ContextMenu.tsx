import { MenuView } from '@expo/ui/community/menu';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

export type ContextMenuAction<Id extends string> = { id: Id; title: string };

export type ContextMenuProps<Id extends string> = {
  /** Aktionen wie „Bearbeiten“ oder „Ausblenden“. Löschen ist nie rot: Es läuft mit „Rückgängig“. */
  actions: readonly ContextMenuAction<Id>[];
  onAction: (id: Id) => void;
  /** Das Element, auf dem langes Drücken das Menü öffnet, etwa eine Listenzeile. */
  children: ReactNode;
};

/**
 * Natives Kontextmenü über `@expo/ui` (SwiftUI `ContextMenu`, Compose `DropdownMenu`), geöffnet durch
 * langes Drücken (https://docs.expo.dev/versions/v58.0.0/sdk/ui/drop-in-replacements/menu/).
 * Auf Android übernimmt das Menü die Gesten seines Inhalts: Ein `onPress` darin löst dort nicht aus.
 *
 * Beide Plattformen betten den Auslöser in einen nativen Host ein, der sich nach dem Inhalt bemisst.
 * Ohne Vorgabe wüchse er bei großer Schrift über den Bildschirmrand; deshalb bekommt der Inhalt die
 * gemessene verfügbare Breite.
 */
export function ContextMenu<Id extends string>({ actions, onAction, children }: ContextMenuProps<Id>) {
  const [width, setWidth] = useState<number>();
  const ids = new Set<string>(actions.map((action) => action.id));
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width === undefined ? null : (
        <MenuView
          shouldOpenOnLongPress
          actions={actions.map(({ id, title }) => ({ id, title }))}
          onPressAction={({ nativeEvent }) => {
            if (ids.has(nativeEvent.event)) onAction(nativeEvent.event as Id);
          }}
        >
          <View style={{ width }}>{children}</View>
        </MenuView>
      )}
    </View>
  );
}
