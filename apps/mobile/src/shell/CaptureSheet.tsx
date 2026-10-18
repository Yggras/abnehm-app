import type { RouteTarget } from '@abnehm/contracts/routes';
import { StyleSheet, View } from 'react-native';

import { Button, ListGroup, ListRow, Sheet, space, Text, type IconName } from '../design';
import type { QuickCommand } from './quick-commands';
import { shellTexts, titleOf } from './texts';

/** Direktaktion ganz oben: derselbe Quick-Command wie der Wasser-Mini-Tracker auf „Heute“. */
const waterQuickAdd: QuickCommand = { type: 'command', commandKey: 'water.quick_add', params: { ml: 250 } };

/** Auswahl des ＋-Sheets (Spezifikation 0, Abschnitt 6); Sport und Gewicht öffnen direkt das Formular. */
const captureOptions: { target: RouteTarget; icon: IconName }[] = [
  { target: { type: 'capture.food' }, icon: 'plate' },
  { target: { type: 'capture.water' }, icon: 'drop' },
  { target: { type: 'capture.sport', newEntry: true }, icon: 'sport' },
  { target: { type: 'capture.weight', newEntry: true }, icon: 'scale' },
];

export type CaptureSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Eine Erfassung gewählt; der Aufrufer schließt das Sheet und öffnet das Ziel. */
  onChoose: (target: RouteTarget) => void;
  /** Direktaktion gewählt; der Aufrufer schließt das Sheet und führt den Quick-Command ohne Navigation aus. */
  onQuickCommand: (command: QuickCommand) => void;
};

/**
 * Das ＋-Sheet der Tab-Leiste: wählt aus, was erfasst wird, und ist selbst keine Seite. Ganz oben
 * bucht „+250 ml Wasser“ sofort (Nutzerentscheidung vom 16.10.2026 in
 * [#91](https://github.com/Yggras/abnehm-app/issues/91)).
 */
export function CaptureSheet({ visible, onClose, onChoose, onQuickCommand }: CaptureSheetProps) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.content}>
        <Text variant="title" accessibilityRole="header">
          {shellTexts.captureSheetTitle}
        </Text>
        <Button
          variant="secondary"
          icon="drop"
          block
          label={shellTexts.quickAddWater(waterQuickAdd.params.ml)}
          onPress={() => onQuickCommand(waterQuickAdd)}
        />
        <ListGroup>
          {captureOptions.map(({ target, icon }) => (
            <ListRow key={target.type} title={titleOf(target)} icon={icon} onPress={() => onChoose(target)} />
          ))}
        </ListGroup>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: space[4] },
});
