import type { EntityId, MealKey } from '@abnehm/contracts/base';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { boxShadow, Button, color, IconButton, ListGroup, ListRow, Notice, pressedEdge, radius, Skeleton, space, Switch, Text } from '../design';
import { useOnlineRead } from '../online';
import type { MealPhotoDetail } from './meal-photos';
import type { Nutrition } from './nutrition';
import { mealNames, nutritionTexts } from './texts';

// Eigene Mahlzeitenfotos (Spezifikation 2, Abschnitt 9; #164). Online zeigt jede Mahlzeit im Protokoll die
// Vorschauen ihrer Fotos; Antippen öffnet die Fotoansicht mit dem vergrößerten Foto, dem Schalter „Mit Partner
// teilen“ (nur bei aktiver Kopplung) und „Foto löschen“. Offline erscheint keine Vorschau, im Protokoll bleibt
// das Foto-/KI-Symbol der Einträge. Bilder kommen nur über das Ernährungsmodul und bleiben nur im Speicher.

const texts = nutritionTexts.photo;

/** Kantenlänge einer Vorschau im Protokoll (Designwert, nicht belegt): zwei Avatare breit. */
const THUMB = 88;
/** Höhe des Platzhalters, solange das vergrößerte Foto lädt (Designwert, nicht belegt; 4:3 auf dem iPhone SE). */
const LARGE_PLACEHOLDER = 240;

/** Die Vorschauen einer Mahlzeit; ohne Bild (offline, verweigert) bleibt die Stelle leer. */
export function MealPhotoStrip({
  nutrition,
  meal,
  photoIds,
  onOpen,
}: {
  nutrition: Nutrition;
  meal: MealKey;
  photoIds: readonly EntityId[];
  onOpen: (photoId: EntityId) => void;
}) {
  if (photoIds.length === 0) return null;
  return (
    <View style={styles.strip}>
      {photoIds.map((photoId, index) => (
        <PhotoThumb
          key={photoId}
          nutrition={nutrition}
          name={texts.name(meal, photoIds.length > 1 ? { position: index + 1, count: photoIds.length } : undefined)}
          photoId={photoId}
          onOpen={() => onOpen(photoId)}
        />
      ))}
    </View>
  );
}

function PhotoThumb({ nutrition, name, photoId, onOpen }: { nutrition: Nutrition; name: string; photoId: EntityId; onOpen: () => void }) {
  const { state } = useOnlineRead(['mahlzeitenfoto', photoId, 'vorschau'], () => nutrition.mealPhotoImage(photoId, 'vorschau'));
  if (state.type === 'pending') {
    return (
      <View accessible accessibilityLabel={texts.loading} style={styles.thumb}>
        <Skeleton height={THUMB} width={THUMB} radius="md" />
      </View>
    );
  }
  if (state.type !== 'ok') return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      onPress={onOpen}
      style={({ pressed }) => [styles.thumb, pressed && pressedEdge('card', 'cardPressed')]}
    >
      <Image testID="mahlzeitenfoto-vorschau" source={{ uri: state.value.uri }} style={styles.thumbImage} accessibilityIgnoresInvertColors />
    </Pressable>
  );
}

/** Beobachtet die Fotoansicht; `undefined`, bis die erste Abfrage da ist. */
function useMealPhotoDetail(nutrition: Nutrition, photoId: EntityId): MealPhotoDetail | null | undefined {
  const [detail, setDetail] = useState<{ photoId: EntityId; value: MealPhotoDetail | null } | null>(null);
  useEffect(() => nutrition.observeMealPhoto(photoId, (value) => setDetail({ photoId, value })), [nutrition, photoId]);
  return detail?.photoId === photoId ? detail.value : undefined;
}

/**
 * Fotoansicht im Sheet: vergrößertes Foto, „Mit Partner teilen“ nur bei aktiver Kopplung und „Foto löschen“.
 * Löschen ist endgültig (Tombstone, kein „Rückgängig“); deshalb fragt die Ansicht vorher inline nach, wie beim
 * Löschen eines eigenen Lebensmittels.
 */
export function MealPhotoView({
  nutrition,
  photoId,
  meal,
  onClose,
  onDeleted,
  onFailed,
}: {
  nutrition: Nutrition;
  photoId: EntityId;
  meal: MealKey;
  onClose: () => void;
  onDeleted: () => void;
  onFailed: (error: unknown) => void;
}) {
  const detail = useMealPhotoDetail(nutrition, photoId);
  const { state, retry } = useOnlineRead(['mahlzeitenfoto', photoId, 'gross'], () => nutrition.mealPhotoImage(photoId, 'gross'));
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Gelöscht, etwa auf dem anderen Gerät: Die Ansicht schließt sich.
  useEffect(() => {
    if (detail === null) onClose();
  }, [detail, onClose]);

  const attempt = (command: () => void) => {
    try {
      command();
    } catch (error) {
      onFailed(error);
    }
  };

  return (
    <View style={styles.sheet}>
      <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
        <View style={styles.head}>
          <View style={styles.grow}>
            <Text variant="title" accessibilityRole="header">
              {texts.title}
            </Text>
            <Text variant="caption" tone="inkMuted">
              {mealNames[meal]}
            </Text>
          </View>
          <IconButton icon="close" accessibilityLabel={nutritionTexts.close} onPress={onClose} />
        </View>
        {state.type === 'ok' ? (
          <Image
            source={{ uri: state.value.uri }}
            accessible
            accessibilityRole="image"
            accessibilityLabel={texts.name(meal)}
            accessibilityIgnoresInvertColors
            onLoad={({ nativeEvent: { source } }) => setAspectRatio(source.width > 0 && source.height > 0 ? source.width / source.height : null)}
            resizeMode="contain"
            style={[styles.large, aspectRatio === null ? styles.largeUnknown : { aspectRatio }]}
          />
        ) : state.type === 'pending' || state.type === 'idle' ? (
          <View accessible accessibilityLabel={texts.loading}>
            <Skeleton height={LARGE_PLACEHOLDER} radius="lg" />
          </View>
        ) : (
          <Notice tone="hint" icon="camera" text={texts.unavailable} action={{ label: texts.retry, onPress: retry }} />
        )}
        {detail?.partnerCoupled ? (
          <ListGroup>
            <ListRow
              title={texts.share}
              subtitle={texts.shareHint}
              accessory={
                <Switch label={texts.share} value={detail.sharedWithPartner} onValueChange={(shared) => attempt(() => nutrition.setPhotoSharing(photoId, shared))} />
              }
            />
          </ListGroup>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        {confirmDelete ? (
          <>
            <Notice tone="hint" text={texts.deleteQuestion} />
            <View style={styles.actions}>
              <Button variant="secondary" label={texts.cancel} onPress={() => setConfirmDelete(false)} />
              <Button
                variant="secondary"
                label={texts.confirmDelete}
                onPress={() => attempt(() => {
                  nutrition.deletePhoto(photoId);
                  onDeleted();
                })}
              />
            </View>
          </>
        ) : (
          <View style={styles.start}>
            <Button variant="text" label={texts.delete} onPress={() => setConfirmDelete(true)} disabled={detail == null} />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.md, overflow: 'hidden', backgroundColor: color.surfaceSunken, boxShadow: boxShadow.card },
  thumbImage: { width: THUMB, height: THUMB },
  sheet: { flex: 1 },
  fill: { flex: 1 },
  content: { gap: space[4] },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  grow: { flex: 1, gap: space[1] },
  large: { width: '100%', borderRadius: radius.lg, backgroundColor: color.surfaceSunken },
  largeUnknown: { aspectRatio: 4 / 3 },
  footer: { gap: space[2], paddingTop: space[3] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  start: { alignItems: 'flex-start' },
});
