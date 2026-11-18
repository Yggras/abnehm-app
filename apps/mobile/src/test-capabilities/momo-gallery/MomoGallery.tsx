import { LocalDate } from '@abnehm/contracts/base';
import { MomoMood, type MomoAppearance } from '@abnehm/contracts/island';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, color, radius, size, space, Text } from '../../design';
import { IslandCanvas } from '../../island/IslandCanvas';
import { islandScene, type SceneField, type SceneObject } from '../../island/scene-model';
import { MomoAppearanceProvider, MomoFigure, moodNames } from '../../momo';
import type { MomoGalleryView } from './views';

// Momo-Galerie (#187), nur in Test-Artefakten: Sie zeigt den vertikalen Schnitt des Momo-Rigs für die
// Geräteprüfung und die Impeccable-Critique auf Simulator und Gerät. `heute` zeigt beide Formen in allen
// Stimmungen mit und ohne Accessoires in 104 dp (`momo-today`), dazu Laichkugel und Leerzustand;
// `insel` zeigt Momo im Insel-Canvas, verdeckt von einem Objekt davor, am Tag und am Abend.

const moods = MomoMood.options;
const dressed = { kopf: 'strohhuetchen', hals: 'muschelkette' } as const;
const bare = { kopf: null, hals: null } as const;

const rows: readonly Readonly<{ title: string; appearance: MomoAppearance }>[] = [
  { title: 'Kaulquappe', appearance: { stage: 'geschluepft', formKey: 'kaulquappe', moodKey: 'zufrieden', accessories: bare } },
  { title: 'Kaulquappe mit Strohhütchen und Muschelkette', appearance: { stage: 'geschluepft', formKey: 'kaulquappe', moodKey: 'zufrieden', accessories: dressed } },
  { title: 'Lagunendrache', appearance: { stage: 'geschluepft', formKey: 'lagunendrache', moodKey: 'zufrieden', accessories: bare } },
  { title: 'Lagunendrache mit Strohhütchen und Muschelkette', appearance: { stage: 'geschluepft', formKey: 'lagunendrache', moodKey: 'zufrieden', accessories: dressed } },
];

export function MomoGallery({ view, onClose }: { view: MomoGalleryView; onClose(): void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text variant="title" accessibilityRole="header">
          Momo-Galerie
        </Text>
        <Button variant="text" label="Schließen" onPress={onClose} />
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[6] }]}>{view === 'heute' ? <Today /> : <Island />}</ScrollView>
    </View>
  );
}

function Today() {
  return (
    <>
      {rows.map(({ title, appearance }) => (
        <View key={title} style={styles.section}>
          <Text variant="headline">{title}</Text>
          <View style={styles.grid}>
            {moods.map((mood) => (
              <View key={mood} style={styles.tile}>
                <View style={styles.stage}>
                  <MomoAppearanceProvider appearance={{ ...appearance, moodKey: mood }}>
                    <MomoFigure mood={mood} size={size.momoToday} />
                  </MomoAppearanceProvider>
                </View>
                <Text tone="inkMuted">{moodNames[mood]}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
      <View style={styles.section}>
        <Text variant="headline">Laichkugel und Leerzustände</Text>
        <View style={styles.grid}>
          {[size.momoToday, 96, 80].map((figureSize) => (
            <View key={figureSize} style={styles.tile}>
              <View style={styles.stage}>
                <MomoFigure mood="zufrieden" size={figureSize} />
              </View>
              <Text tone="inkMuted">{figureSize} dp</Text>
            </View>
          ))}
        </View>
      </View>
    </>
  );
}

/** Eine Lichtung aus 5 × 5 Feldern; Momo steht in der Mitte, ein Apfelbaum und eine Laterne davor. */
const fields: readonly SceneField[] = Array.from({ length: 25 }, (_, index) => ({
  key: `galerie:${index % 5}:${Math.floor(index / 5)}`,
  x: index % 5,
  y: Math.floor(index / 5),
  kind: 'lichtung',
  ownerPersonId: null,
}));
const objects: readonly SceneObject[] = [
  { id: 'baum', fieldKey: 'galerie:3:3', art: 'apfelbaum_3', ownerPersonId: 'galerie' },
  { id: 'laterne', fieldKey: 'galerie:2:3', art: 'laterne_2', ownerPersonId: 'galerie' },
];

const islandCases: readonly Readonly<{ title: string; momo: MomoAppearance; minutesOfDay: number }>[] = [
  { title: 'Tag: Kaulquappe, zufrieden', momo: { stage: 'geschluepft', formKey: 'kaulquappe', moodKey: 'zufrieden', accessories: dressed }, minutesOfDay: 14 * 60 },
  { title: 'Tag: Lagunendrache, freut sich', momo: { stage: 'geschluepft', formKey: 'lagunendrache', moodKey: 'freut_sich', accessories: dressed }, minutesOfDay: 14 * 60 },
  { title: 'Abend: Lagunendrache, schläft', momo: { stage: 'geschluepft', formKey: 'lagunendrache', moodKey: 'schlaeft', accessories: dressed }, minutesOfDay: 21 * 60 },
];

function Island() {
  return (
    <>
      {islandCases.map(({ title, momo, minutesOfDay }) => {
        const scene = islandScene({
          island: { fields, fog: [], objects, momo },
          viewerPersonId: 'galerie',
          mode: 'ansehen',
          localTime: { localDate: LocalDate.parse('2026-10-14'), minutesOfDay },
          zoom: 1,
        });
        return (
          <View key={title} style={styles.section}>
            <Text variant="headline">{title}</Text>
            <View style={styles.island}>
              <IslandCanvas scene={scene} onHit={() => undefined} accessibilityLabel={title} />
            </View>
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: color.surfaceBase },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[4], paddingVertical: space[2] },
  content: { paddingHorizontal: space[4], gap: space[5] },
  section: { gap: space[2] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  tile: { alignItems: 'center', gap: space[1] },
  stage: { backgroundColor: color.momoStage, borderRadius: radius.lg, padding: space[1] },
  island: { height: 260, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: color.islandWater },
});
