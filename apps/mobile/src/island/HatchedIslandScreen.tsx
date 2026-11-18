import type { EntityId } from '@abnehm/contracts/base';
import type { MomoAppearance } from '@abnehm/contracts/island';
import { gameCatalog } from '@abnehm/game-rules/content';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';

import { Button, Sheet, space, Text } from '../design';
import type { TargetOf } from '../navigation';
import { useMessageHost } from '../shell/MessageHost';
import { MomoAppearanceProvider, MomoFigure } from '../shell/MomoFigure';
import type { BuildOutcome } from './build-object';
import { buildOptions, type BlueprintOption } from './build-options';
import { BuildSheet } from './BuildSheet';
import type { HatchedIsland } from './hatched-island';
import type { IslandEntry } from './IslandBar';
import { IslandView } from './IslandView';
import { islandLayout } from './layout';
import type { IslandSceneInput, SceneHit } from './scene-model';
import { momoSheetTexts } from './texts';

// Die geschlüpfte Insel im Tab „Momo“ (Spezifikation 4, Abschnitt 7; #184, #191, #192): die Inselansicht
// aus den lokalen Daten, das Momo-Sheet nach einem Tipp auf Momo, beim ersten Öffnen einmalig „So wächst
// Momo“ und das Bauen. Alle Sheets teilen ein Sheet, denn Sheets in Sheets gibt es nicht
// (`design/native/Sheet.tsx`); aus dem Momo-Sheet heraus wechselt der Inhalt zur Erklärung. Der
// Levelbalken öffnet die Erklärung als zweiter Einstieg (Impeccable-Kritik zu #184).
//
// Bauen (#192): Ein Tipp auf ein freies eigenes Feld öffnet das Bau-Sheet mit den Bauplänen, die dort
// dürfen; die Wahl baut sofort auf dieses Feld. „Bauen“ in der Leiste öffnet das Sheet mit allen
// Bauplänen, die irgendwo auf ein freies eigenes Feld dürfen; die Wahl startet den Bau-Modus, in dem die
// gültigen Felder leuchten und ein Tippen baut. Das Objekt erscheint mit Feder, die eigene Hälfte wächst.
// Abbrechen geht jederzeit: über die Bau-Leiste, und System-Zurück beendet zuerst den Bau-Modus, dann ein
// offenes Sheet, erst danach greift die normale Navigation (Impeccable-Prüfung, B11).

export type HatchedIslandScreenProps = Readonly<{
  island: HatchedIsland;
  /** Ob „So wächst Momo“ jetzt erscheinen soll; merkt das Erscheinen (Einmal-Flag je Installation). */
  takeGrowthIntro(): boolean;
  /** Baut über den Spieldienst (`GameService.build`). */
  build(request: Readonly<{ fieldId: EntityId; blueprintKey: string }>): BuildOutcome;
  onOpen(view: Exclude<IslandEntry, 'bauen'>): void;
  /** Ansicht aus der Route `momo`; `bauen` öffnet das Bau-Sheet, danach meldet `onViewHandled` sie als erledigt. */
  requestedView?: TargetOf<'momo'>['view'];
  onViewHandled?(): void;
  bottomInset: number;
}>;

type SheetContent = Readonly<{ type: 'momo' }> | Readonly<{ type: 'wachstum' }> | Readonly<{ type: 'bauen'; field: string | null }>;

export function HatchedIslandScreen({ island, takeGrowthIntro, build, onOpen, requestedView, onViewHandled, bottomInset }: HatchedIslandScreenProps) {
  const [sheet, setSheet] = useState<SheetContent | null>(null);
  const [placing, setPlacing] = useState<BlueprintOption | null>(null);
  const [appearing, setAppearing] = useState<string | null>(null);
  const { showMessage } = useMessageHost();

  // Ein besuchter Tab bleibt gemountet, auch wenn die Person woanders ist; das native Sheet läge dann über
  // dem fremden Bildschirm. Die Erklärung erscheint deshalb erst, wenn der Tab im Vordergrund ist.
  // Gemerkt wird das Erscheinen, nicht erst das Schließen: Auch weggewischt kommt sie nicht wieder.
  useFocusEffect(
    useCallback(() => {
      if (takeGrowthIntro()) setSheet({ type: 'wachstum' });
    }, [takeGrowthIntro]),
  );
  // Wer den Tab verlässt, bricht den Bau-Modus ab; zurück auf der Insel wird nicht unbemerkt weitergebaut.
  useFocusEffect(useCallback(() => () => setPlacing(null), []));
  // System-Zurück (Android) beendet zuerst den Bau-Modus, dann ein offenes Sheet (B11). Spätere
  // Abonnenten kommen zuerst an die Reihe, `true` beendet die Kette
  // (https://reactnative.dev/docs/backhandler); auf iOS hat ein Tab keine Zurück-Geste.
  useFocusEffect(
    useCallback(() => {
      if (placing === null && sheet === null) return undefined;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (placing !== null) setPlacing(null);
        else setSheet(null);
        return true;
      });
      return () => subscription.remove();
    }, [placing, sheet]),
  );

  const startBuilding = useCallback(() => {
    setPlacing(null);
    setSheet({ type: 'bauen', field: null });
  }, []);
  // Die Route `momo` mit `view: 'bauen'` öffnet das Bau-Sheet, sobald sie ankommt; danach verlässt die
  // Ansicht die Route, damit derselbe Link sie erneut öffnen kann
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const [arrivedView, setArrivedView] = useState<TargetOf<'momo'>['view']>(undefined);
  if (requestedView !== arrivedView) {
    setArrivedView(requestedView);
    if (requestedView === 'bauen') startBuilding();
  }
  useEffect(() => {
    if (requestedView === 'bauen') onViewHandled?.();
  }, [requestedView, onViewHandled]);

  const options = useMemo(() => buildOptions(island), [island]);
  const fieldIds = useMemo(() => new Map(island.fields.map((field) => [field.key, field.id])), [island.fields]);
  const scene = useMemo(
    (): IslandSceneInput => ({
      ...islandLayout(gameCatalog, { fields: island.fields, unlockedAreas: island.unlockedAreas }),
      objects: island.objects,
      momo: island.appearance,
    }),
    [island.fields, island.unlockedAreas, island.objects, island.appearance],
  );
  const placingFields = useMemo(() => (placing === null ? null : options.fields(placing.key)), [placing, options]);

  const buildOn = (fieldKey: string, blueprintKey: string) => {
    setPlacing(null);
    const fieldId = fieldIds.get(fieldKey);
    const outcome = fieldId === undefined ? null : build({ fieldId, blueprintKey });
    if (outcome?.type === 'gebaut') setAppearing(outcome.islandObjectId);
    // Bau-Sheet und Bau-Modus bieten nur, was das Gerät erlaubt; eine Ablehnung ist ein Wettlauf, etwa mit einem Pull.
    else showMessage({ messageKey: 'shell.nicht_geklappt', values: {} });
  };

  const onFieldPress = (hit: Exclude<SceneHit, { type: 'momo' }>) => {
    if (hit.type !== 'feld') return;
    if (placing !== null) {
      if (placingFields?.has(hit.field)) buildOn(hit.field, placing.key);
      return;
    }
    if (options.opensSheet(hit.field)) setSheet({ type: 'bauen', field: hit.field });
  };

  const choose = (option: BlueprintOption) => {
    if (sheet?.type !== 'bauen') return;
    setSheet(null);
    if (sheet.field === null) setPlacing(option);
    else buildOn(sheet.field, option.key);
  };

  return (
    <>
      <IslandView
        island={scene}
        halves={island.halves}
        viewerPersonId={island.viewerPersonId}
        partnerName={island.partnerDisplayName}
        energy={island.energy}
        onOpen={(view) => (view === 'bauen' ? startBuilding() : onOpen(view))}
        onFieldPress={onFieldPress}
        onMomoPress={() => {
          if (placing === null) setSheet({ type: 'momo' });
        }}
        onLevelPress={() => setSheet({ type: 'wachstum' })}
        bottomInset={bottomInset}
        building={placing === null || placingFields === null ? null : { name: placing.name, fields: placingFields, onCancel: () => setPlacing(null) }}
        appearing={appearing}
      />
      <Sheet visible={sheet !== null} onClose={() => setSheet(null)} height={sheet?.type === 'bauen' ? 'full' : 'content'}>
        {sheet?.type === 'momo' ? (
          <MomoSheet appearance={island.appearance} level={island.progress.level} onGrowth={() => setSheet({ type: 'wachstum' })} />
        ) : sheet?.type === 'bauen' ? (
          <BuildSheet onField={sheet.field !== null} energy={island.energy} options={options.blueprints(sheet.field)} onChoose={choose} />
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
