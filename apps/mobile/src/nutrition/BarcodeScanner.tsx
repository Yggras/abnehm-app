import { CameraView, useCameraPermissions, type BarcodeScanningResult, type BarcodeType } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Barcode } from '@abnehm/contracts/nutrition';

import { testCapabilities } from '../build-capabilities';
import { Button, color, Notice, radius, Skeleton, space, Text } from '../design';
import { useNotifications } from '../notifications';
import { nutritionTexts } from './texts';

// Scanner des Hinzufügen-Bildschirms (Spezifikation 2, Abschnitt 5; #160): `CameraView` aus expo-camera mit den
// Barcode-Typen für Lebensmittel und `onBarcodeScanned`. Nach dem ersten Treffer pausiert er, damit nichts
// mehrfach auslöst. Die Kamerafreigabe erfragt er erst beim ersten Scannen über `useCameraPermissions`; ist sie
// abgelehnt und nicht mehr erfragbar, führt er zu den Systemeinstellungen der App
// (https://docs.expo.dev/versions/v58.0.0/sdk/camera/). Die öffnet in der App nur der Mitteilungs-Port (#125,
// Lint-Regel in `eslint.config.js`); es ist dieselbe Einstellungsseite der App, auf der auch die Kamera steht.
//
// In Test-Artefakten übernimmt er einen per Link `produkt?scan=…` hinterlegten Barcode wie einen Kameratreffer:
// Der iOS-Simulator hat keine Kamera.

const texts = nutritionTexts.barcode;

/** EAN-13, EAN-8, UPC-A und UPC-E: die Barcodes verpackter Lebensmittel (Spezifikation 2, Abschnitt 5). */
export const foodBarcodeTypes: BarcodeType[] = ['ean13', 'ean8', 'upc_a', 'upc_e'];


export function BarcodeScanner({ onScanned, onCancel }: { onScanned: (barcode: string) => void; onCancel: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const notifications = useNotifications();
  const [failed, setFailed] = useState(false);
  // Pausiert nach dem ersten Treffer: State für die Kamera, Ref gegen Treffer im selben Frame.
  const [paused, setPaused] = useState(false);
  const scanned = useRef(false);
  const asked = useRef(false);

  const accept = (barcode: string) => {
    // Nur Barcodes, die die Lebensmittelreferenz nimmt; andere Treffer übergeht der Scanner.
    if (scanned.current || !Barcode.safeParse(barcode).success) return;
    scanned.current = true;
    setPaused(true);
    onScanned(barcode);
  };

  useEffect(() => {
    // Ein hinterlegter Test-Barcode ersetzt Kamera und Freigabe. Gelesen wird er im Effekt, nicht beim Rendern,
    // weil das Lesen ihn verbraucht; ein zweiter Lauf findet keinen mehr.
    const testScan = testCapabilities?.takeTestScan() ?? null;
    if (testScan !== null) accept(testScan);
    // Nur beim Öffnen: Ein hinterlegter Barcode gilt für genau diesen Scanner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Erst beim ersten Scannen fragen, und nur einmal je Öffnen; danach entscheidet die Person über den Knopf.
    if (scanned.current || asked.current || permission === null || permission.granted || permission.status !== 'undetermined') return;
    asked.current = true;
    void requestPermission();
  }, [permission, requestPermission]);

  return (
    <View style={styles.scanner} testID="barcode-scanner">
      <Text variant="title" accessibilityRole="header">
        {texts.title}
      </Text>
      {failed ? (
        <Notice tone="problem" cause="technik" text={texts.cameraFailed} />
      ) : permission === null || permission.status === 'undetermined' ? (
        <Skeleton height={240} radius="lg" />
      ) : permission.granted ? (
        <>
          <View style={styles.viewport}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: foodBarcodeTypes }}
              onBarcodeScanned={paused ? undefined : (result: BarcodeScanningResult) => accept(result.data)}
              onMountError={() => setFailed(true)}
              accessible
              accessibilityLabel={texts.camera}
            />
            <View style={styles.frame} pointerEvents="none" />
          </View>
          <Text variant="label" tone="inkMuted">
            {texts.hint}
          </Text>
        </>
      ) : (
        <View style={styles.denied}>
          <Text>{permission.canAskAgain ? texts.permissionHint : texts.denied}</Text>
          {permission.canAskAgain ? <Button label={texts.allowCamera} block onPress={() => void requestPermission()} /> : null}
          {/* Bei jeder Ablehnung führt ein Weg zu den Systemeinstellungen, auch wenn das System noch einmal fragen dürfte. */}
          <Button
            variant={permission.canAskAgain ? 'text' : 'primary'}
            label={texts.openSettings}
            icon="gear"
            block
            onPress={() => void notifications.openSettings()}
          />
        </View>
      )}
      <Button variant="secondary" label={texts.cancel} block onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  scanner: { gap: space[4] },
  viewport: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: color.surfaceInverse,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Rahmen für den Barcode: breit und flach wie ein EAN-Code.
  frame: { width: '78%', height: '38%', borderRadius: radius.md, borderWidth: 3, borderColor: color.onInverse },
  denied: { gap: space[3] },
});
