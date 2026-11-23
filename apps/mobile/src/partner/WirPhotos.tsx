import type { PartnerPhotoList } from '@abnehm/contracts/partner';
import { useIsFocused } from 'expo-router';
import { useState } from 'react';
import { FlatList, Image, Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { boxShadow, color, Icon, IconButton, pressedEdge, radius, Skeleton, space, Text } from '../design';
import { useOnlineRead } from '../online';
import type { Partner } from './partner';
import type { PartnerPhotoVariant } from './partner-photos';
import { photoTexts } from './texts';

// „Fotos von heute“ (Spezifikation 5, Abschnitt 2; #122): die Zeile beim Bereich Ernährung der Partnerübersicht
// und die Vollbildansicht zum Wischen. Abgefragt wird nur online und nur, solange „Wir“ sichtbar ist; jedes
// erneute Sichtbarwerden holt eine frische Liste mit neuen, höchstens 10 Minuten gültigen Handles. Liste und
// Bilder laufen über `useOnlineRead` (TanStack Query ohne Persistenz, `gcTime: 0`) und kommen als `data:`-URI
// nur in den Arbeitsspeicher (`online/memory-image.ts`). Offline, leer oder `forbidden` gibt es keine Zeile;
// ein Bildfehler zeigt ein neutrales Platzhalterbild.

type Photo = PartnerPhotoList['photos'][number];

/** Kantenlänge einer Vorschau (Designwert, nicht belegt): vier Vorschauen und „+N“ passen auf das iPhone SE. */
const THUMB = 56;
/** Höchstens so viele Vorschauen, danach „+N“ (Spezifikation 5, Abschnitt 2). */
const MAX_PREVIEWS = 4;

export type TodayPhotos = Readonly<{
  /** Die Fotos der Liste; leer offline, ohne Ergebnis, bei leerer Liste und bei `forbidden`. */
  photos: readonly Photo[];
  /** Pull-to-Refresh: lädt die Liste neu, sofern sie gerade abgefragt werden darf. */
  reload(): Promise<unknown>;
}>;

/**
 * Die Fotoliste des Partners für „Wir“. Abgefragt wird nur, solange „Wir“ sichtbar und das Gerät online ist;
 * jedes erneute Sichtbar- oder Onlinewerden ist ein neuer Besuch mit eigenem Schlüssel und damit frischer Liste.
 */
export function useTodayPhotos(partner: Partner | null, online: boolean): TodayPhotos {
  const focused = useIsFocused();
  const active = partner !== null && online && focused;
  // Jeder Wechsel zu „aktiv“ ist ein neuer Besuch; angepasst noch im Rendern, damit der alte Schlüssel nie abfragt
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const [visit, setVisit] = useState({ active: false, count: 0 });
  if (visit.active !== active) setVisit({ active, count: active ? visit.count + 1 : visit.count });
  const { state, retry } = useOnlineRead(['partnerfotos', 'liste', visit.count], () => partner!.photos.list(), {
    enabled: active && visit.active,
  });
  return {
    photos: active && state.type === 'ok' ? state.value.photos : [],
    reload: () => (active ? retry() : Promise.resolve()),
  };
}

/** Die Zeile „Fotos von heute“; ohne Fotos entfällt sie still. */
export function PhotosRow({ partner, name, photos }: { partner: Partner; name: string; photos: readonly Photo[] }) {
  const [opened, setOpened] = useState<number | null>(null);
  if (photos.length === 0) return null;
  const previews = photos.slice(0, MAX_PREVIEWS);
  const more = photos.length - previews.length;
  return (
    <View testID="wir-fotos" style={styles.row}>
      <View style={styles.label}>
        <Icon name="camera" tone="partner" />
        <Text variant="label" tone="inkMuted">
          {photoTexts.title}
        </Text>
      </View>
      <View style={styles.strip}>
        {previews.map((photo, index) => (
          <Pressable
            key={photo.handle}
            accessibilityRole="button"
            accessibilityLabel={photoTexts.name(name, photo.meal, { position: index + 1, count: photos.length })}
            onPress={() => setOpened(index)}
            style={({ pressed }) => [styles.thumb, pressed && pressedEdge('card', 'cardPressed')]}
          >
            <PartnerImage partner={partner} name={name} photo={photo} variant="vorschau" />
          </Pressable>
        ))}
        {more > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={photoTexts.moreSpoken(name, more)}
            onPress={() => setOpened(MAX_PREVIEWS)}
            style={({ pressed }) => [styles.thumb, styles.more, pressed && pressedEdge('card', 'cardPressed')]}
          >
            <Text variant="headline" style={styles.moreText}>
              {photoTexts.more(more)}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {opened === null ? null : (
        <PhotoViewer partner={partner} name={name} photos={photos} initialIndex={opened} onClose={() => setOpened(null)} />
      )}
    </View>
  );
}

/**
 * Ein Bild per Handle: lädt als Fläche in Bildform, kommt als Foto oder bei jedem Fehler als neutraler
 * Platzhalter mit Kamera-Symbol, nie im Ton `problem`.
 */
function PartnerImage({ partner, name, photo, variant, label }: {
  partner: Partner; name: string; photo: Photo; variant: PartnerPhotoVariant; label?: string;
}) {
  const { state } = useOnlineRead(['partnerfoto', photo.handle, variant], () => partner.photos.image(photo.handle, variant));
  const fill = variant === 'gross' ? styles.large : styles.fill;
  if (state.type === 'ok') {
    return (
      <Image
        testID={variant === 'vorschau' ? 'partnerfoto-vorschau' : 'partnerfoto-gross'}
        source={{ uri: state.value.uri }}
        accessible={label !== undefined}
        accessibilityRole={label === undefined ? undefined : 'image'}
        accessibilityLabel={label}
        accessibilityIgnoresInvertColors
        resizeMode={variant === 'gross' ? 'contain' : 'cover'}
        style={fill}
      />
    );
  }
  if (state.type === 'pending' || state.type === 'idle') {
    return (
      <View accessible={label !== undefined} accessibilityLabel={label === undefined ? undefined : photoTexts.loading} style={fill}>
        <Skeleton height={variant === 'gross' ? 240 : THUMB} radius="md" />
      </View>
    );
  }
  return (
    <View
      testID="partnerfoto-platzhalter"
      accessible
      accessibilityRole="image"
      accessibilityLabel={photoTexts.unavailable(name, photo.meal)}
      style={[fill, styles.placeholder]}
    >
      <Icon name="camera" size="lg" tone="inkMuted" />
    </View>
  );
}

/** Vollbildansicht zum Wischen: je Foto eine Seite in voller Breite, oben Mahlzeit, Position und „Schließen“. */
function PhotoViewer({ partner, name, photos, initialIndex, onClose }: {
  partner: Partner; name: string; photos: readonly Photo[]; initialIndex: number; onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(initialIndex);
  const current = photos[Math.min(index, photos.length - 1)]!;
  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView testID="partnerfoto-vollbild" style={styles.viewer}>
        <View style={styles.bar}>
          <View style={styles.grow}>
            <Text variant="headline" tone="onInverse" accessibilityRole="header">
              {photoTexts.meal(current.meal)}
            </Text>
            <Text variant="caption" tone="onInverse">
              {photoTexts.position(index + 1, photos.length)}
            </Text>
          </View>
          <IconButton icon="close" accessibilityLabel={photoTexts.close} onPress={onClose} />
        </View>
        <FlatList
          testID="partnerfoto-seiten"
          data={photos}
          keyExtractor={(photo) => photo.handle}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, item) => ({ length: width, offset: width * item, index: item })}
          onMomentumScrollEnd={({ nativeEvent }) => setIndex(Math.max(0, Math.min(photos.length - 1, Math.round(nativeEvent.contentOffset.x / width))))}
          renderItem={({ item, index: position }) => (
            <View style={[styles.page, { width }]}>
              <PartnerImage
                partner={partner}
                name={name}
                photo={item}
                variant="gross"
                label={photoTexts.name(name, item.meal, { position: position + 1, count: photos.length })}
              />
            </View>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { gap: space[2], borderTopWidth: 1, borderTopColor: color.line, paddingTop: space[2] },
  label: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: color.surfaceSunken,
    boxShadow: boxShadow.card,
  },
  fill: { width: THUMB, height: THUMB },
  more: { alignItems: 'center', justifyContent: 'center', backgroundColor: color.partnerSoft },
  moreText: { color: color.partner },
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: color.surfaceSunken },
  viewer: { flex: 1, backgroundColor: color.surfaceInverse },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[2] },
  grow: { flex: 1 },
  page: { flex: 1, justifyContent: 'center', paddingHorizontal: space[2] },
  large: { width: '100%', height: '100%' },
});

