import { MenuView } from '@expo/ui/community/menu';
import type { ReactNode } from 'react';

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
 */
export function ContextMenu<Id extends string>({ actions, onAction, children }: ContextMenuProps<Id>) {
  const ids = new Set<string>(actions.map((action) => action.id));
  return (
    <MenuView
      shouldOpenOnLongPress
      actions={actions.map(({ id, title }) => ({ id, title }))}
      onPressAction={({ nativeEvent }) => {
        if (ids.has(nativeEvent.event)) onAction(nativeEvent.event as Id);
      }}
    >
      {children}
    </MenuView>
  );
}
