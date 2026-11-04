import sharp from 'sharp';

/**
 * Höchstzahl der Bildpunkte, die der Server dekodiert (Designwert, nicht belegt): weit über den
 * 1.280 px langer Kante, auf die die App verkleinert, und deutlich unter dem Standard von sharp
 * (https://sharp.pixelplumbing.com/api-constructor). Schützt vor Dekompressionsbomben.
 */
const MAX_INPUT_PIXELS = 40_000_000;

/** JPEG-Qualität der Neukodierung; entspricht `compress` 0,8 der App (Designwert, nicht belegt). */
const JPEG_QUALITY = 80;

/**
 * Dekodiert ein hochgeladenes Foto, richtet es nach EXIF aus und kodiert es als JPEG neu (Spezifikation 2,
 * Abschnitt 8; #22). sharp übernimmt Metadaten nur auf ausdrücklichen Wunsch (`keepMetadata` bzw.
 * `withMetadata`), die Ausgabe hat also weder EXIF noch GPS (https://sharp.pixelplumbing.com/api-output).
 * `null`, wenn sich die Datei nicht als JPEG, PNG oder WebP dekodieren lässt.
 */
export async function sanitizedJpeg(upload: Uint8Array): Promise<Uint8Array | null> {
  try {
    const image = sharp(upload, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
    const { format } = await image.metadata();
    if (format !== 'jpeg' && format !== 'png' && format !== 'webp') return null;
    return new Uint8Array(await image.autoOrient().jpeg({ quality: JPEG_QUALITY }).toBuffer());
  } catch {
    // Kaputte, abgeschnittene oder zu große Bilder: Den Grund verrät die Antwort nicht.
    return null;
  }
}

/**
 * Lange Kante der Fassungen eines Mahlzeitenfotos (Designwerte, nicht belegt): die Vorschau für Protokoll
 * und „Wir“, die vergrößerte Fassung wie das Bild der App (1.280 px, Spezifikation 2, Abschnitt 8).
 */
const LONG_EDGE = { vorschau: 400, gross: 1_280 } as const;

/**
 * Vorschau und vergrößerte Fassung eines bestätigten Fotos (Spezifikation 2, Abschnitt 8) aus dem schon
 * bereinigten Bild des Entwurfs: höchstens so groß wie die lange Kante, nie vergrößert, als JPEG ohne
 * Metadaten (https://sharp.pixelplumbing.com/api-resize, https://sharp.pixelplumbing.com/api-output).
 */
export async function mealPhotoVariants(jpeg: Uint8Array): Promise<Record<keyof typeof LONG_EDGE, Uint8Array>> {
  const resized = async (edge: number) =>
    new Uint8Array(
      await sharp(jpeg, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
        .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer(),
    );
  return { vorschau: await resized(LONG_EDGE.vorschau), gross: await resized(LONG_EDGE.gross) };
}
