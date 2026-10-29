import type { LocalDate, MealKey } from '@abnehm/contracts/base';
import { roundKcal, type DisplayUnit, type NutritionEntryAddedOutcome } from '@abnehm/contracts/nutrition';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useClock } from '../clock/clock-context';
import { Button, Chip, IconButton, ListGroup, ListRow, Sheet, size, Skeleton, space, Text, TextField, type IconName } from '../design';
import { closeRoute, openTarget, type RouteScreenProps } from '../navigation';
import { Placeholder } from '../shell/Placeholder';
import { ScreenFrame } from '../shell/ScreenFrame';
import { UnknownTarget } from '../shell/UnknownTarget';
import { useUndoableMessage } from '../shell/use-undoable-message';
import { isTestArtifact } from '../test-artifact';
import { checkAmountInput, defaultAmountMilli } from './amount-input';
import { useNutrition } from './app-nutrition';
import { BlsCatalogProvider, useFoodSearch } from './BlsCatalogProvider';
import type { FoodSearchHit } from './food-search';
import { useLocalToday } from './hooks';
import type { Nutrition } from './nutrition';
import {
  amountProblemText,
  dateText,
  kcalText,
  macrosText,
  markNames,
  mealNames,
  milliText,
  nutritionTexts,
  sourceNames,
  unitChipText,
  unitText,
} from './texts';

// Hinzufügen-Bildschirm (Spezifikation 2, Abschnitt 6) für die Route `capture.food`: feste Plätze in
// der Reihenfolge Suche, „Barcode scannen“, „Foto aufnehmen“, Mahlzeitenfavoriten, „Zuletzt verwendet“,
// Lebensmittelfavoriten und „Eigenes Lebensmittel anlegen“. #155 füllt die Suche; die übrigen Plätze
// füllen ihre Tickets (#157–#163). Vor jedem Speichern prüft die Person Menge und Einheit im Sheet.

/** Die Plätze in fester Reihenfolge; die Suche steht immer oben. */
const laterSlots = ['barcode', 'foto', 'mahlzeitenfavoriten', 'zuletzt', 'lebensmittelfavoriten', 'eigenes_lebensmittel'] as const;
type LaterSlot = (typeof laterSlots)[number];

const slotIcons: Readonly<Record<LaterSlot, IconName>> = {
  barcode: 'barcode',
  foto: 'camera',
  mahlzeitenfavoriten: 'plate',
  zuletzt: 'undo',
  lebensmittelfavoriten: 'star',
  eigenes_lebensmittel: 'pencil',
};

export function FoodCaptureScreen({ target }: RouteScreenProps<'capture.food'>) {
  const today = useLocalToday(useClock());
  // Ohne Mahlzeit kommt erst der Auswahlschritt; ihn liefert #168 zusammen mit „Essen“ im ＋-Sheet.
  if (target.meal === undefined) return <Placeholder target={target} />;
  const localDate = target.localDate ?? today;
  // Künftige Tage sind nicht erreichbar (Spezifikation 2, Abschnitt 6), auch nicht per Link.
  if (localDate > today) return <UnknownTarget />;
  return <AddFood meal={target.meal} localDate={localDate} today={today} />;
}

function AddFood({ meal, localDate, today }: { meal: MealKey; localDate: LocalDate; today: LocalDate }) {
  const nutrition = useNutrition();
  return (
    <ScreenFrame title={nutritionTexts.capture} presentation="modal">
      <Text variant="label" tone="inkMuted">
        {`${mealNames[meal]} · ${localDate === today ? nutritionTexts.today : dateText(localDate)}`}
      </Text>
      {nutrition === null ? (
        <CaptureSkeleton />
      ) : (
        <BlsCatalogProvider>
          <AddSlots nutrition={nutrition} meal={meal} localDate={localDate} />
        </BlsCatalogProvider>
      )}
    </ScreenFrame>
  );
}

function AddSlots({ nutrition, meal, localDate }: { nutrition: Nutrition; meal: MealKey; localDate: LocalDate }) {
  const search = useFoodSearch();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<FoodSearchHit | null>(null);
  const result = useMemo(() => search.search(query), [search, query]);
  const message = useUndoableMessage();

  const add = (hit: FoodSearchHit, displayUnit: DisplayUnit, displayAmountMilli: number) => {
    let outcome: NutritionEntryAddedOutcome;
    try {
      outcome = nutrition.addEntry({ localDate, meal, captureMethod: 'suche', foodRef: hit.ref, snapshot: hit.snapshot, displayUnit, displayAmountMilli });
    } catch (error) {
      message.failed(error);
      return;
    }
    message.show(outcome, { run: () => nutrition.undo(outcome.undoToken), expire: () => nutrition.expire(outcome.undoToken) });
    setSelected(null);
    // Speichern kehrt zum Protokoll zurück (Spezifikation 2, Abschnitt 6), auch ohne Rückweg, etwa nach
    // einem Link. Kam die Person aus dem Protokoll, bringt sie schon `closeRoute` dorthin.
    closeRoute();
    openTarget({ type: 'log' });
  };

  return (
    <>
      <View testID="platz-suche">
        <TextField
          kind="search"
          label={nutritionTexts.search}
          hideLabel
          placeholder={nutritionTexts.search}
          value={query}
          onChangeText={setQuery}
        />
      </View>
      {result.type === 'treffer' ? <SearchHits hits={result.hits} query={query} onSelect={setSelected} /> : <LaterSlots />}
      <Sheet visible={selected !== null} onClose={() => setSelected(null)} height="full">
        {selected === null ? null : (
          <AmountCheck
            key={`${selected.ref.type}:${selected.ref.key}`}
            hit={selected}
            nutrition={nutrition}
            onClose={() => setSelected(null)}
            onAdd={(displayUnit, displayAmountMilli) => add(selected, displayUnit, displayAmountMilli)}
          />
        )}
      </Sheet>
    </>
  );
}

function SearchHits({ hits, query, onSelect }: { hits: readonly FoodSearchHit[]; query: string; onSelect: (hit: FoodSearchHit) => void }) {
  if (hits.length === 0) return <Text tone="inkMuted">{nutritionTexts.noHits(query)}</Text>;
  return (
    <ListGroup>
      {hits.map((hit) => {
        const per100 = nutritionTexts.per100(hit.kcalPer100, hit.snapshot.baseUnit);
        // Quellenmarke in derselben Zeile: So passen auf das iPhone SE mit Tastatur mehr Treffer.
        return (
          <ListRow
            key={`${hit.ref.type}:${hit.ref.key}`}
            title={hit.snapshot.name}
            subtitle={`${per100} · ${markNames[hit.mark]}`}
            onPress={() => onSelect(hit)}
            accessibilityLabel={`${hit.snapshot.name}, ${per100}, ${markNames[hit.mark]}`}
          />
        );
      })}
    </ListGroup>
  );
}

/**
 * Plätze, die spätere Tickets füllen. Test-Artefakte zeigen sie als „Kommt noch“, damit die Reihenfolge
 * sichtbar bleibt; im Release ist ein fehlender Platz ein Integrationsfehler wie ein fehlender Bildschirm.
 */
function LaterSlots() {
  if (!isTestArtifact()) throw new Error(`Integrationsfehler: Auf dem Hinzufügen-Bildschirm fehlen die Plätze ${laterSlots.join(', ')}.`);
  return (
    <ListGroup>
      {laterSlots.map((slot) => (
        <View key={slot} testID={`platz-${slot}`}>
          <ListRow icon={slotIcons[slot]} title={nutritionTexts.slots[slot]} subtitle={nutritionTexts.slotInWork} disabled />
        </View>
      ))}
    </ListGroup>
  );
}

/**
 * Mengenprüfung als Sheet: Name und Quelle, Mengenfeld mit Einheiten-Chips, kcal groß, Makros klein und
 * „Hinzufügen“. Vorbelegt ist die letzte Menge dieses Lebensmittels, sonst eine Portion, sonst 100 g bzw. ml.
 */
function AmountCheck({
  hit,
  nutrition,
  onClose,
  onAdd,
}: {
  hit: FoodSearchHit;
  nutrition: Nutrition;
  onClose: () => void;
  onAdd: (displayUnit: DisplayUnit, displayAmountMilli: number) => void;
}) {
  const { snapshot } = hit;
  const [prefill] = useState(() => nutrition.prefillAmount(hit.ref, snapshot));
  const [unit, setUnit] = useState<DisplayUnit>(prefill.displayUnit);
  const [input, setInput] = useState(() => milliText(prefill.displayAmountMilli));
  const [submitted, setSubmitted] = useState(false);
  const check = checkAmountInput(snapshot, unit, input);
  // Ein leeres Feld beim Tippen ist noch kein Fehler; erst „Hinzufügen“ fragt nach der Menge.
  const problem = check.type === 'problem' && (submitted || check.problem !== 'leer') ? amountProblemText(check.problem, snapshot.baseUnit) : undefined;
  const units: DisplayUnit[] = [snapshot.baseUnit, ...snapshot.portions.map((portion) => portion.unit)];
  // Die Quellenangabe nennt die Quelle schon (BLS, Open Food Facts); sonst die Art der Werte.
  const source = snapshot.attribution ?? sourceNames[snapshot.source];
  const kcal = check.type === 'menge' ? kcalText(roundKcal(check.totals.milliKcal)) : '– kcal';

  return (
    <View style={styles.sheet}>
      <View style={styles.sheetHead}>
        <View style={styles.grow}>
          <Text variant="title" accessibilityRole="header">
            {snapshot.name}
          </Text>
          <Text variant="caption" tone="inkMuted">
            {source}
          </Text>
        </View>
        <IconButton icon="close" accessibilityLabel={nutritionTexts.close} onPress={onClose} />
      </View>
      <TextField
        kind="number"
        label={nutritionTexts.amount}
        unit={unitText(unit)}
        value={input}
        onChangeText={setInput}
        problem={problem}
      />
      <View style={styles.units}>
        {units.map((option) => (
          <Chip
            key={option}
            label={unitChipText(snapshot, option)}
            selection="single"
            selected={option === unit}
            onPress={() => {
              if (option === unit) return;
              setUnit(option);
              setInput(milliText(defaultAmountMilli(snapshot, option)));
            }}
          />
        ))}
      </View>
      <View style={styles.values}>
        <Text variant="numberXl">{kcal}</Text>
        {check.type === 'menge' ? (
          <Text variant="label" tone="inkMuted">
            {macrosText(check.totals)}
          </Text>
        ) : null}
      </View>
      <Button
        label={nutritionTexts.add}
        block
        onPress={() => {
          setSubmitted(true);
          if (check.type === 'menge') onAdd(unit, check.amount.displayAmountMilli);
        }}
      />
    </View>
  );
}

function CaptureSkeleton() {
  return (
    <View style={styles.skeleton} accessible accessibilityLabel={`${nutritionTexts.capture} lädt`}>
      <Skeleton height={size.fieldHeight} radius="md" />
      <Skeleton height={size.rowMin * 3} radius="lg" />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: space[4] },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  grow: { flex: 1, gap: space[1] },
  units: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  values: { gap: space[1] },
  skeleton: { gap: space[4] },
});
