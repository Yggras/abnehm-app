import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Notice, Skeleton, space, Text } from '../design';
import { useOnlineRead } from '../online';
import type { BarcodeResolution } from './barcode';
import type { FoodChoice } from './current-foods';
import type { Nutrition } from './nutrition';
import { nutritionTexts } from './texts';

// Auflösung eines gescannten Barcodes als flüchtiger Online-Ablauf über das Modul aus #103 (Spezifikation 2,
// Abschnitt 5; #160) und ihre Folgen: `found` führt in die Mengenprüfung, `incomplete` und `not_found` in
// „Eigenes Lebensmittel anlegen“ mit Barcode und allen bekannten Werten. `offline_unknown` und `unavailable`
// bleiben hier stehen, mit dem manuellen Weg und bei `unavailable` mit „Erneut versuchen“.

const texts = nutritionTexts.barcode;

/** Was der Hinzufügen-Bildschirm aus einer Auflösung macht, die nicht hier stehen bleibt. */
export type BarcodeOutcome =
  | Readonly<{ type: 'found'; food: FoodChoice }>
  | Readonly<{ type: 'create'; resolution: Extract<BarcodeResolution, { type: 'incomplete' | 'not_found' | 'offline_unknown' | 'unavailable' }> }>;

export function BarcodeLookup({
  nutrition,
  barcode,
  onOutcome,
  onCancel,
}: {
  nutrition: Nutrition;
  barcode: string;
  onOutcome: (outcome: BarcodeOutcome) => void;
  /** „Später scannen“: zurück zum Hinzufügen-Bildschirm. */
  onCancel: () => void;
}) {
  // Jeder Versuch hat einen eigenen Schlüssel, damit „Erneut versuchen“ wieder „Produkt wird gesucht …“ zeigt.
  const [attempt, setAttempt] = useState(0);
  const { state } = useOnlineRead(['barcode', barcode, String(attempt)], async () => ({ type: 'ok', value: await nutrition.resolveBarcode(barcode) }) as const);
  const retry = () => setAttempt((count) => count + 1);
  const resolution = state.type === 'ok' ? state.value : null;

  useEffect(() => {
    if (resolution === null) return;
    if (resolution.type === 'found') onOutcome({ type: 'found', food: resolution.food });
    else if (resolution.type === 'incomplete' || resolution.type === 'not_found') onOutcome({ type: 'create', resolution });
    // Nur je neuem Ergebnis; der Aufrufer verlässt diesen Schritt danach.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolution]);

  const manual = (from: Extract<BarcodeOutcome, { type: 'create' }>['resolution']) => (
    <Button variant="secondary" icon="pencil" label={texts.createManually} block onPress={() => onOutcome({ type: 'create', resolution: from })} />
  );

  return (
    <View style={styles.lookup} testID="barcode-ergebnis">
      <View style={styles.head}>
        <Text variant="title" accessibilityRole="header">
          {texts.title}
        </Text>
        <Text variant="label" tone="inkMuted">
          {texts.barcode(barcode)}
        </Text>
      </View>
      {resolution?.type === 'offline_unknown' ? (
        <>
          <Notice tone="neutral" icon="offline" text={texts.offline} />
          {manual(resolution)}
          <Button variant="text" label={texts.scanLater} block onPress={onCancel} />
        </>
      ) : resolution?.type === 'unavailable' || (state.type !== 'pending' && state.type !== 'ok') ? (
        <>
          <Notice tone="neutral" text={resolution?.type === 'unavailable' && resolution.retryable ? texts.unavailable : texts.unavailableFinal} />
          {resolution?.type !== 'unavailable' || resolution.retryable ? <Button label={texts.retry} block onPress={retry} /> : null}
          {manual(resolution?.type === 'unavailable' ? resolution : { type: 'unavailable', barcode, retryable: false })}
          <Button variant="text" label={texts.scanLater} block onPress={onCancel} />
        </>
      ) : (
        <View style={styles.pending} accessible accessibilityLabel={texts.resolving}>
          <Text tone="inkMuted">{texts.resolving}</Text>
          <Skeleton height={120} radius="lg" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  lookup: { gap: space[4] },
  head: { gap: space[1] },
  pending: { gap: space[3] },
});
