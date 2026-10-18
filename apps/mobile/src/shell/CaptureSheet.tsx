import type { RouteTarget } from '@abnehm/contracts/routes';
import { StyleSheet, View } from 'react-native';

import { ListGroup, ListRow, Sheet, space, Text, type IconName } from '../design';
import { shellTexts, titleOf } from './texts';

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
};

/** Das ＋-Sheet der Tab-Leiste: wählt aus, was erfasst wird, und ist selbst keine Seite. */
export function CaptureSheet({ visible, onClose, onChoose }: CaptureSheetProps) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.content}>
        <Text variant="title" accessibilityRole="header">
          {shellTexts.captureSheetTitle}
        </Text>
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
