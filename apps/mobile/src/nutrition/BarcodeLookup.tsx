import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Notice, Skeleton, space, Text } from '../design';
import { useOnlineRead } from '../online';
import type { BarcodeResolution } from './barcode';
import type { FoodChoice } from './current-foods';
import type { OffProduct } from './food-product-source';
import type { Nutrition } from './nutrition';
import { nutritionTexts } from './texts';

// Auflösung eines gescannten Barcodes als flüchtiger Online-Ablauf über das Modul aus #103 (Spezifikation 2,
// Abschnitt 5; #160) und ihre Folgen: `found` führt in die Mengenprüfung, `incomplete` und `not_found` in
// „Eigenes Lebensmittel anlegen“ mit Barcode und allen bekannten Werten. `offline_unknown` und `unavailable`
// bleiben hier stehen, mit dem manuellen Weg und bei `unavailable` mit „Erneut versuchen“.

const texts = nutritionTexts.barcode;

/**
 * Warum „Eigenes Lebensmittel anlegen“ öffnet: Werte fehlen, sie verletzen die Regeln des Snapshots (etwa Makros
 * über der Bezugsmenge), OFF kennt das Produkt nicht, oder die Person legt es ohne Antwort von OFF selbst an.
 */
export type CreateReason = 'incomplete' | 'invalid' | 'not_found' | 'manual';

/** Eine Angabe, die einem Produkt fehlen kann; die Schlüssel sind die Felder des Formulars. */
export type MissingValue = 'name' | 'kcal' | 'protein' | 'carbs' | 'fat';

/** Was der Hinzufügen-Bildschirm aus einer Auflösung macht, die nicht hier stehen bleibt. */
export type BarcodeOutcome =
  | Readonly<{ type: 'found'; food: FoodChoice }>
  | Readonly<{
      type: 'create';
      barcode: string;
      product: OffProduct | null;
      reason: CreateReason;
      /** Bei `incomplete` die fehlenden Angaben in Formularreihenfolge, sonst leer. */
      missing: readonly MissingValue[];
    }>;

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
  const resolution = state.type === 'ok' ? state.value : null;

  useEffect(() => {
    const outcome = resolution === null ? null : outcomeOf(resolution);
    if (outcome !== null) onOutcome(outcome);
    // Nur je neuem Ergebnis; der Aufrufer verlässt diesen Schritt danach.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolution]);

  const manual = <Button variant="secondary" icon="pencil" label={texts.createManually} block onPress={() => onOutcome({ type: 'create', barcode, product: null, reason: 'manual', missing: [] })} />;
  const later = <Button variant="text" label={texts.scanLater} block onPress={onCancel} />;
  // Alles außer „sucht noch“ und einer Auflösung, die gleich weiterführt, bleibt hier stehen.
  const unanswered = resolution?.type === 'unavailable' || (state.type !== 'pending' && state.type !== 'ok');

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
          {manual}
          {later}
        </>
      ) : unanswered ? (
        <>
          <Notice tone="neutral" text={texts.unavailable} />
          <Button label={texts.retry} block onPress={() => setAttempt((count) => count + 1)} />
          {manual}
          {later}
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

/** Die Folge einer Auflösung, die nicht hier stehen bleibt; sonst `null`. */
function outcomeOf(resolution: BarcodeResolution): BarcodeOutcome | null {
  switch (resolution.type) {
    case 'found':
      return { type: 'found', food: resolution.food };
    case 'incomplete': {
      const { product } = resolution;
      const values: readonly (readonly [MissingValue, unknown])[] = [
        ['name', product.name],
        ['kcal', product.milliKcalPer100],
        ['protein', product.proteinMgPer100],
        ['carbs', product.carbsMgPer100],
        ['fat', product.fatMgPer100],
      ];
      const missing = values.filter(([, value]) => value === null).map(([field]) => field);
      // Fehlt nichts, verletzen die Werte nur die Regeln des Snapshots.
      return { type: 'create', barcode: resolution.barcode, product, reason: missing.length === 0 ? 'invalid' : 'incomplete', missing };
    }
    case 'not_found':
      return { type: 'create', barcode: resolution.barcode, product: null, reason: 'not_found', missing: [] };
    case 'offline_unknown':
    case 'unavailable':
      return null;
  }
}

const styles = StyleSheet.create({
  lookup: { gap: space[4] },
  head: { gap: space[1] },
  pending: { gap: space[3] },
});
