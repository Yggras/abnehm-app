import type { EntityId } from '@abnehm/contracts/base';
import type { MomoAppearance, PlacementTarget } from '@abnehm/contracts/island';
import { indexCatalog } from '@abnehm/game-rules/catalog';
import { gameCatalog } from '@abnehm/game-rules/content';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';

import { Button, Sheet, space, Text } from '../design';
import type { TargetOf } from '../navigation';
import { useMessageHost } from '../shell/MessageHost';
import { MomoAppearanceProvider, MomoFigure } from '../momo';
import type { BuildOutcome } from './build-object';
import { buildOptions, type BlueprintOption } from './build-options';
import { BuildSheet } from './BuildSheet';
import type { HatchedIsland } from './hatched-island';
import type { IslandEntry } from './IslandBar';
import { IslandView } from './IslandView';
import { islandLayout } from './layout';
import type { PlaceOutcome, UpgradeOutcome } from './object-commands';
import { objectOptions, type StorageItem } from './object-options';
import { ObjectSheet } from './ObjectSheet';
import type { IslandSceneInput, SceneHit } from './scene-model';
import { StorageSheet } from './StorageSheet';
import { buildTexts, momoSheetTexts, objectTexts } from './texts';

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
//
// Objekte und Lager (#194): Ein Tipp auf ein Objekt öffnet das Objekt-Sheet. Ein eigenes Objekt bietet
// Aufwerten mit Preis, Umstellen und Einlagern, eines des Partners nur Infos. „Lager“ in der Leiste (auch
// über die Route `momo` mit `view: 'lager'`) öffnet das Lager-Sheet mit „Platzieren“. Umstellen und
// Platzieren nutzen denselben Modus wie das Bauen: Die passenden freien eigenen Felder leuchten, ein Tippen
// setzt das Objekt dorthin, kostenlos. Ein aufgewertetes oder umgestelltes Objekt erscheint mit Feder.

const catalog = indexCatalog(gameCatalog);

export type HatchedIslandScreenProps = Readonly<{
  island: HatchedIsland;
  /** Ob „So wächst Momo“ jetzt erscheinen soll; merkt das Erscheinen (Einmal-Flag je Installation). */
  takeGrowthIntro(): boolean;
  /** Baut über den Spieldienst (`GameService.build`). */
  build(request: Readonly<{ fieldId: EntityId; blueprintKey: string }>): BuildOutcome;
  /** Wertet über den Spieldienst auf (`GameService.upgrade`). */
  upgrade(islandObjectId: EntityId): UpgradeOutcome;
  /** Platziert über den Spieldienst (`GameService.place`). */
  place(islandObjectId: EntityId, target: PlacementTarget): PlaceOutcome;
  onOpen(view: Exclude<IslandEntry, SheetView>): void;
  /**
   * Ansicht aus der Route `momo`; `bauen` öffnet das Bau-Sheet, `lager` das Lager-Sheet, danach meldet
   * `onViewHandled` sie als erledigt.
   */
  requestedView?: TargetOf<'momo'>['view'];
  onViewHandled?(): void;
  bottomInset: number;
}>;

type SheetContent =
  | Readonly<{ type: 'momo' }>
  | Readonly<{ type: 'wachstum' }>
  | Readonly<{ type: 'bauen'; field: string | null }>
  | Readonly<{ type: 'objekt'; field: string }>
  | Readonly<{ type: 'lager' }>;

/** Was im Modus mit leuchtenden Feldern gesetzt wird: ein Bauplan oder ein eigenes Objekt von der Insel bzw. aus dem Lager. */
type Placing =
  | Readonly<{ type: 'bauen'; option: BlueprintOption }>
  | Readonly<{ type: 'umstellen'; objectId: EntityId; name: string; from: 'insel' | 'lager' }>;

/** Routen-Ansichten und Einstiege der Leiste, die dieser Bildschirm selbst als Sheet öffnet. */
const sheetForView = {
  bauen: { type: 'bauen', field: null },
  lager: { type: 'lager' },
} as const satisfies Partial<Record<NonNullable<TargetOf<'momo'>['view']>, SheetContent>>;

type SheetView = keyof typeof sheetForView;

const isSheetView = (view: string): view is SheetView => Object.hasOwn(sheetForView, view);

/** Titel der Leiste im Modus mit leuchtenden Feldern. */
function placingTitleOf(placing: Placing): string {
  if (placing.type === 'bauen') return buildTexts.placing(placing.option.name);
  return placing.from === 'insel' ? objectTexts.moving(placing.name) : objectTexts.placing(placing.name);
}

export function HatchedIslandScreen({ island, takeGrowthIntro, build, upgrade, place, onOpen, requestedView, onViewHandled, bottomInset }: HatchedIslandScreenProps) {
  const [sheet, setSheet] = useState<SheetContent | null>(null);
  const [placing, setPlacing] = useState<Placing | null>(null);
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

  const openSheet = useCallback((content: SheetContent) => {
    setPlacing(null);
    setSheet(content);
  }, []);
  // Die Route `momo` mit `view: 'bauen'` bzw. `'lager'` öffnet das Sheet, sobald sie ankommt; danach
  // verlässt die Ansicht die Route, damit derselbe Link sie erneut öffnen kann
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const [arrivedView, setArrivedView] = useState<TargetOf<'momo'>['view']>(undefined);
  if (requestedView !== arrivedView) {
    setArrivedView(requestedView);
    if (requestedView !== undefined && isSheetView(requestedView)) openSheet(sheetForView[requestedView]);
  }
  useEffect(() => {
    if (requestedView !== undefined && isSheetView(requestedView)) onViewHandled?.();
  }, [requestedView, onViewHandled]);

  const options = useMemo(() => buildOptions(island), [island]);
  const objects = useMemo(() => objectOptions(catalog, island), [island]);
  const fieldIds = useMemo(() => new Map(island.fields.map((field) => [field.key, field.id])), [island.fields]);
  const scene = useMemo(
    (): IslandSceneInput => ({
      ...islandLayout(gameCatalog, { fields: island.fields, unlockedAreas: island.unlockedAreas }),
      objects: island.objects,
      momo: island.appearance,
    }),
    [island.fields, island.unlockedAreas, island.objects, island.appearance],
  );
  const placingFields = useMemo(() => {
    if (placing === null) return null;
    return placing.type === 'bauen' ? options.fields(placing.option.key) : objects.placeFields(placing.objectId);
  }, [placing, options, objects]);
  const objectSheet = sheet?.type === 'objekt' ? objects.sheetAt(sheet.field) : null;

  // Sheets und Modus bieten nur, was das Gerät erlaubt; eine Ablehnung ist ein Wettlauf, etwa mit einem Pull.
  const notDone = () => showMessage({ messageKey: 'shell.nicht_geklappt', values: {} });

  const buildOn = (fieldKey: string, blueprintKey: string) => {
    setPlacing(null);
    const fieldId = fieldIds.get(fieldKey);
    const outcome = fieldId === undefined ? null : build({ fieldId, blueprintKey });
    if (outcome?.type === 'gebaut') setAppearing(outcome.islandObjectId);
    else notDone();
  };

  const placeAt = (objectId: EntityId, target: PlacementTarget) => {
    setPlacing(null);
    if (place(objectId, target).type !== 'platziert') notDone();
    else if (target.type === 'feld') setAppearing(objectId);
  };

  const onFieldPress = (hit: Exclude<SceneHit, { type: 'momo' }>) => {
    if (hit.type !== 'feld') return;
    if (placing !== null) {
      const fieldId = fieldIds.get(hit.field);
      if (fieldId === undefined || !placingFields?.has(hit.field)) return;
      if (placing.type === 'bauen') buildOn(hit.field, placing.option.key);
      else placeAt(placing.objectId, { type: 'feld', fieldId });
      return;
    }
    if (objects.sheetAt(hit.field) !== null) setSheet({ type: 'objekt', field: hit.field });
    else if (options.opensSheet(hit.field)) setSheet({ type: 'bauen', field: hit.field });
  };

  const choose = (option: BlueprintOption) => {
    if (sheet?.type !== 'bauen') return;
    setSheet(null);
    if (sheet.field === null) setPlacing({ type: 'bauen', option });
    else buildOn(sheet.field, option.key);
  };

  const upgradeObject = (objectId: EntityId) => {
    setSheet(null);
    if (upgrade(objectId).type === 'aufgewertet') setAppearing(objectId);
    else notDone();
  };

  const placeFromStorage = (item: StorageItem) => {
    setSheet(null);
    setPlacing({ type: 'umstellen', objectId: item.id, name: item.name, from: 'lager' });
  };

  const placingTitle = placing === null ? null : placingTitleOf(placing);

  return (
    <>
      <IslandView
        island={scene}
        halves={island.halves}
        viewerPersonId={island.viewerPersonId}
        partnerName={island.partnerDisplayName}
        energy={island.energy}
        onOpen={(view) => {
          if (isSheetView(view)) openSheet(sheetForView[view]);
          else onOpen(view);
        }}
        onFieldPress={onFieldPress}
        onMomoPress={() => {
          if (placing === null) setSheet({ type: 'momo' });
        }}
        onLevelPress={() => setSheet({ type: 'wachstum' })}
        bottomInset={bottomInset}
        building={placingTitle === null || placingFields === null ? null : { title: placingTitle, fields: placingFields, onCancel: () => setPlacing(null) }}
        appearing={appearing}
      />
      <Sheet visible={sheet !== null} onClose={() => setSheet(null)} height={sheet?.type === 'bauen' || sheet?.type === 'lager' ? 'full' : 'content'}>
        {sheet?.type === 'momo' ? (
          <MomoSheet appearance={island.appearance} level={island.progress.level} onGrowth={() => setSheet({ type: 'wachstum' })} />
        ) : sheet?.type === 'bauen' ? (
          <BuildSheet onField={sheet.field !== null} energy={island.energy} options={options.blueprints(sheet.field)} onChoose={choose} />
        ) : sheet?.type === 'lager' ? (
          <StorageSheet items={objects.storage} onPlace={placeFromStorage} />
        ) : sheet?.type === 'objekt' ? (
          objectSheet !== null && (
            <ObjectSheet
              sheet={objectSheet}
              onUpgrade={() => upgradeObject(objectSheet.id)}
              onMove={() => {
                setSheet(null);
                setPlacing({ type: 'umstellen', objectId: objectSheet.id, name: objectSheet.name, from: 'insel' });
              }}
              onStore={() => {
                setSheet(null);
                placeAt(objectSheet.id, { type: 'lager' });
              }}
            />
          )
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
