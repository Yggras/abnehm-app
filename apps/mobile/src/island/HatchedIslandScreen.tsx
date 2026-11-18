import type { MomoAppearance } from '@abnehm/contracts/island';
import { gameCatalog } from '@abnehm/game-rules/content';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Sheet, space, Text } from '../design';
import { MomoAppearanceProvider, MomoFigure } from '../shell/MomoFigure';
import type { HatchedIsland } from './hatched-island';
import type { IslandEntry } from './IslandBar';
import { IslandView } from './IslandView';
import { islandLayout } from './layout';
import type { IslandSceneInput } from './scene-model';
import { momoSheetTexts } from './texts';

// Die geschlüpfte Insel im Tab „Momo“ (Spezifikation 4, Abschnitt 7; #184): die Inselansicht aus den
// lokalen Daten, das Momo-Sheet nach einem Tipp auf Momo und beim ersten Öffnen einmalig „So wächst
// Momo“. Beide teilen ein Sheet, denn Sheets in Sheets gibt es nicht (`design/native/Sheet.tsx`); aus
// dem Momo-Sheet heraus wechselt der Inhalt zur Erklärung. Der Levelbalken öffnet die Erklärung als
// zweiter Einstieg (Impeccable-Kritik zu #184). Gebaute Objekte stehen auf ihren Feldern, und die eigene
// Hälfte wächst mit jedem eigenen Bau sofort (#191).

export type HatchedIslandScreenProps = Readonly<{
  island: HatchedIsland;
  /** Ob „So wächst Momo“ jetzt erscheinen soll; merkt das Erscheinen (Einmal-Flag je Installation). */
  takeGrowthIntro(): boolean;
  onOpen(view: IslandEntry): void;
  bottomInset: number;
}>;

type SheetContent = 'momo' | 'wachstum' | null;

export function HatchedIslandScreen({ island, takeGrowthIntro, onOpen, bottomInset }: HatchedIslandScreenProps) {
  const [sheet, setSheet] = useState<SheetContent>(null);
  // Ein besuchter Tab bleibt gemountet, auch wenn die Person woanders ist; das native Sheet läge dann über
  // dem fremden Bildschirm. Die Erklärung erscheint deshalb erst, wenn der Tab im Vordergrund ist.
  // Gemerkt wird das Erscheinen, nicht erst das Schließen: Auch weggewischt kommt sie nicht wieder.
  useFocusEffect(
    useCallback(() => {
      if (takeGrowthIntro()) setSheet('wachstum');
    }, [takeGrowthIntro]),
  );
  const scene = useMemo(
    (): IslandSceneInput => ({
      ...islandLayout(gameCatalog, { fields: island.fields, unlockedAreas: island.unlockedAreas }),
      objects: island.objects,
      momo: island.appearance,
    }),
    [island.fields, island.unlockedAreas, island.objects, island.appearance],
  );

  return (
    <>
      <IslandView
        island={scene}
        halves={island.halves}
        viewerPersonId={island.viewerPersonId}
        partnerName={island.partnerDisplayName}
        energy={island.energy}
        onOpen={onOpen}
        onMomoPress={() => setSheet('momo')}
        onLevelPress={() => setSheet('wachstum')}
        bottomInset={bottomInset}
      />
      <Sheet visible={sheet !== null} onClose={() => setSheet(null)}>
        {sheet === 'momo' ? (
          <MomoSheet appearance={island.appearance} level={island.progress.level} onGrowth={() => setSheet('wachstum')} />
        ) : (
          <GrowthExplanation onDone={() => setSheet(null)} />
        )}
      </Sheet>
    </>
  );
}

/** Momo-Sheet: Form und Level, dazu die Erklärung zum erneuten Öffnen. Den Schrank ergänzt #206. */
function MomoSheet({ appearance, level, onGrowth }: { appearance: MomoAppearance; level: number; onGrowth(): void }) {
  return (
    <View style={styles.sheet}>
      <View style={styles.momo}>
        <MomoAppearanceProvider appearance={appearance}>
          <MomoFigure mood={appearance.moodKey ?? 'zufrieden'} size={96} />
        </MomoAppearanceProvider>
        <View style={styles.title}>
          <Text variant="headline" accessibilityRole="header">{momoSheetTexts.title}</Text>
          {appearance.formKey !== null && <Text tone="inkMuted">{momoSheetTexts.formAndLevel(appearance.formKey, level)}</Text>}
        </View>
      </View>
      <Button block variant="secondary" label={momoSheetTexts.growth} onPress={onGrowth} />
    </View>
  );
}

/** „So wächst Momo“: die drei Sätze aus Spezifikation 4, Abschnitt 7. */
function GrowthExplanation({ onDone }: { onDone(): void }) {
  return (
    <View style={styles.sheet}>
      <Text variant="headline" accessibilityRole="header">{momoSheetTexts.growth}</Text>
      <View style={styles.sentences}>
        {momoSheetTexts.growthSentences.map((sentence) => (
          <Text key={sentence}>{sentence}</Text>
        ))}
      </View>
      <Button block label={momoSheetTexts.understood} onPress={onDone} />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: space[4] },
  momo: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  title: { flex: 1, gap: space[1] },
  sentences: { gap: space[2] },
});
