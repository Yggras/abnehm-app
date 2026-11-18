import { Canvas } from '@shopify/react-native-skia';
import { StyleSheet, View } from 'react-native';

import type { ArtKey } from '@abnehm/game-rules/catalog';

import { color, radius, size, space } from '../design';
import { ObjectArt } from './IslandArt';

// Vorschau eines Bauplans oder Objekts in Bau-Sheet, Objekt-Sheet und Lager (#192, #194): die Grafik auf
// Gras, ein Feld breit, damit sie so groß wie auf der Insel bei Zoom 1 erscheint.

const preview = size.islandTile;

export function ObjectPreview({ art }: Readonly<{ art: ArtKey }>) {
  return (
    <View style={styles.preview}>
      <Canvas style={styles.canvas}>
        {/* Der Fuß der Grafik steht auf der unteren Feldecke, damit auch hohe Objekte ganz zu sehen sind. */}
        <ObjectArt at={{ x: preview / 2, y: preview - space[3] }} art={art} foliage="islandFoliage" />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { width: preview, height: preview, borderRadius: radius.md, backgroundColor: color.islandGrass, overflow: 'hidden' },
  canvas: { width: preview, height: preview },
});
