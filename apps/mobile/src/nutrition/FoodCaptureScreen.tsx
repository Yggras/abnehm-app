import type { LocalDate, MealKey } from '@abnehm/contracts/base';
import { foodRefKey, foodValuesOf, sameFoodValues, type CaptureMethod, type DisplayUnit, type FoodValues } from '@abnehm/contracts/nutrition';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useClock } from '../clock/clock-context';
import { Button, ListGroup, ListRow, Sheet, size, Skeleton, space, Text, TextField, type IconName } from '../design';
import { closeRoute, openTarget, type RouteScreenProps } from '../navigation';
import { Placeholder } from '../shell/Placeholder';
import { ScreenFrame } from '../shell/ScreenFrame';
import { UnknownTarget } from '../shell/UnknownTarget';
import { useUndoableMessage } from '../shell/use-undoable-message';
import { isTestArtifact } from '../test-artifact';
import { useNutrition } from './app-nutrition';
import { AmountReview, type Selection } from './AmountReview';
import { BlsCatalogProvider, useFoodSearch, useQuickFoods, useRecordFavoriteUse } from './BlsCatalogProvider';
import type { FoodSearchHit } from './food-search';
import type { Nutrition } from './nutrition';
import { editableBaseOf, emptyOwnFoodDraft, ownFoodDraftOf, type OwnFoodDraft } from './own-food-input';
import type { OwnFoodBase } from './own-foods';
import { OwnFoodForm } from './OwnFoodForm';
import type { QuickFood, QuickFoods } from './quick-foods';
import { amountText, captureTargetText, markNames, nutritionTexts } from './texts';
import { useLocalToday } from './use-day-log';

// Hinzufügen-Bildschirm (Spezifikation 2, Abschnitt 6) für die Route `capture.food`: feste Plätze in
// der Reihenfolge Suche, „Barcode scannen“, „Foto aufnehmen“, Mahlzeitenfavoriten, „Zuletzt verwendet“,
// Lebensmittelfavoriten und „Eigenes Lebensmittel anlegen“. #155 füllt die Suche, #157 den letzten Platz
// samt Formular, #158 „Zuletzt verwendet“ und die Lebensmittelfavoriten; die übrigen Plätze füllen ihre
// Tickets (#159–#163). Ein Tipp auf „Zuletzt verwendet“ oder einen Favoriten führt immer in die Mengenprüfung,
// mit vorbelegter Menge. Vor jedem Speichern prüft die
// Person Menge und Einheit im Sheet. Das Formular „Eigenes Lebensmittel“ ist ein Schritt dieses
// Bildschirms, kein Sheet: Es braucht Tastatur und Platz, und Sheets liegen nie in Sheets.

/** Plätze, die spätere Tickets füllen, in fester Reihenfolge zwischen Suche und „Zuletzt verwendet“. */
const laterSlots = ['barcode', 'foto', 'mahlzeitenfavoriten'] as const;
type LaterSlot = (typeof laterSlots)[number];

const slotIcons: Readonly<Record<LaterSlot, IconName>> = {
  barcode: 'barcode',
  foto: 'camera',
  mahlzeitenfavoriten: 'plate',
};

/** So viele Einträge zeigt jede Liste, danach „Alle anzeigen“ (Spezifikation 2, Abschnitt 6; Designwert, nicht belegt). */
const listPreview = 5;

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
  const target = captureTargetText(meal, localDate, today);
  return (
    <ScreenFrame title={nutritionTexts.capture} presentation="modal">
      <Text variant="label" tone="inkMuted">
        {target}
      </Text>
      {nutrition === null ? (
        <CaptureSkeleton />
      ) : (
        <BlsCatalogProvider>
          <AddSlots nutrition={nutrition} meal={meal} localDate={localDate} target={target} />
        </BlsCatalogProvider>
      )}
    </ScreenFrame>
  );
}

/** Der Formularschritt „Eigenes Lebensmittel“: was gespeichert wird und womit das Formular beginnt. */
type FormStep = Readonly<{
  base: OwnFoodBase;
  initial: OwnFoodDraft;
  title: string;
  hint?: string;
  captureMethod: CaptureMethod;
  /** Beim Ändern das Lebensmittel, aus dem das Formular kam: Speichern ohne Änderung kehrt zu ihm zurück. */
  from?: Selection;
}>;

function AddSlots({
  nutrition,
  meal,
  localDate,
  target,
}: {
  nutrition: Nutrition;
  meal: MealKey;
  localDate: LocalDate;
  /** Mahlzeit und Tag, die auch der Mengenschritt nennt. */
  target: string;
}) {
  const search = useFoodSearch(nutrition, meal);
  const quick = useQuickFoods(nutrition, meal);
  const recordFavoriteUse = useRecordFavoriteUse(nutrition);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Selection | null>(null);
  const [form, setForm] = useState<FormStep | null>(null);
  // Jede Änderung an einem eigenen Lebensmittel zählt hoch; danach liest die Suche neu.
  const [ownFoodChanges, setOwnFoodChanges] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `ownFoodChanges` löst das erneute Lesen aus.
  const result = useMemo(() => search.search(query), [search, query, ownFoodChanges]);
  const message = useUndoableMessage();

  /** Führt einen Befehl aus; scheitert er technisch, sieht die Person „Das hat nicht geklappt …“. */
  const attempt = <T,>(command: () => T): { done: true; value: T } | { done: false } => {
    try {
      return { done: true, value: command() };
    } catch (error) {
      message.failed(error);
      return { done: false };
    }
  };

  const add = (choice: Selection, displayUnit: DisplayUnit, displayAmountMilli: number) => {
    const added = attempt(() =>
      nutrition.addEntry({ localDate, meal, captureMethod: choice.captureMethod, foodRef: choice.ref, snapshot: choice.snapshot, displayUnit, displayAmountMilli }),
    );
    if (!added.done) return;
    const { undoToken } = added.value;
    message.show(added.value, { run: () => nutrition.undo(undoToken), expire: () => nutrition.expire(undoToken) });
    setSelected(null);
    // Speichern kehrt zum Protokoll zurück (Spezifikation 2, Abschnitt 6), auch ohne Rückweg, etwa nach
    // einem Link. Kam die Person aus dem Protokoll, bringt sie schon `closeRoute` dorthin.
    closeRoute();
    openTarget({ type: 'log' });
  };

  /** Speichert ein eigenes Lebensmittel und öffnet es danach in der Mengenprüfung. */
  const saveOwnFood = (base: OwnFoodBase, values: FoodValues, captureMethod: CaptureMethod, unit?: DisplayUnit) => {
    // Das Formular hat die Werte schon geprüft; scheitert der Befehl trotzdem, ist das ein Fehler.
    const saved = attempt(() => nutrition.saveOwnFood(base, values));
    if (!saved.done) return;
    setOwnFoodChanges((count) => count + 1);
    setForm(null);
    setSelected({ ...saved.value, captureMethod, unit });
  };

  /**
   * Ein Lebensmittel aus Suche, „Zuletzt verwendet“ oder den Favoriten öffnet die Mengenprüfung, mit
   * vorbelegter Menge. Beim Verwenden eines Favoriten folgt seine gespeicherte Fassung den aktuellen Werten
   * (Spezifikation 2, Abschnitt 7).
   */
  const pick = (selection: Selection, favorite: boolean) => {
    if (favorite && !attempt(() => recordFavoriteUse(selection.ref)).done) return;
    setSelected(selection);
  };
  const pickQuick = ({ ref, snapshot, prefill, available }: QuickFood, captureMethod: 'zuletzt' | 'lebensmittelfavorit') =>
    pick({ ref, snapshot, captureMethod, prefill, available }, captureMethod === 'lebensmittelfavorit');

  const create = (name = '') =>
    setForm({ base: null, initial: emptyOwnFoodDraft(name), title: nutritionTexts.ownFood.create, captureMethod: 'eigenes_lebensmittel' });

  /** „Bearbeiten“ eines eigenen bzw. „Werte korrigieren“ eines BLS-Lebensmittels aus der Mengenprüfung. */
  const edit = (choice: Selection) => {
    const base = editableBaseOf(choice.ref);
    if (base === undefined) return;
    const own = base.type === 'eigen';
    setSelected(null);
    setForm({
      base,
      initial: ownFoodDraftOf(choice.snapshot),
      title: own ? nutritionTexts.ownFood.edit : nutritionTexts.ownFood.correct,
      hint: own ? undefined : nutritionTexts.ownFood.correctHint,
      captureMethod: choice.captureMethod,
      from: choice,
    });
  };

  /** Ohne Änderung entsteht nichts: Erst eine geänderte Fassung wird zum eigenen Lebensmittel (#157). */
  const submit = (step: FormStep, values: FoodValues) => {
    if (step.from !== undefined && sameFoodValues(values, step.from.snapshot)) {
      setForm(null);
      setSelected(step.from);
      return;
    }
    saveOwnFood(step.base, values, step.captureMethod);
  };

  if (form !== null) {
    const { base } = form;
    return (
      <OwnFoodForm
        title={form.title}
        hint={form.hint}
        initial={form.initial}
        onSave={(values) => submit(form, values)}
        onCancel={() => setForm(null)}
        onDelete={
          base?.type === 'eigen'
            ? () => {
                // Scheitert das Löschen, bleibt das Formular offen.
                if (!attempt(() => nutrition.deleteOwnFood(base.key)).done) return;
                setOwnFoodChanges((count) => count + 1);
                setForm(null);
              }
            : undefined
        }
      />
    );
  }

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
      {result.type === 'treffer' ? (
        <SearchHits
          hits={result.hits}
          query={query}
          onSelect={({ ref, snapshot, prefill, available, mark }) => pick({ ref, snapshot, captureMethod: 'suche', prefill, available }, mark === 'favorit')}
          onCreate={create}
        />
      ) : (
        <Slots meal={meal} quick={quick} onPick={pickQuick} onCreate={() => create()} />
      )}
      <Sheet visible={selected !== null} onClose={() => setSelected(null)} height="full">
        {selected === null ? null : (
          <AmountReview
            key={`${foodRefKey(selected.ref)}:${ownFoodChanges}`}
            selection={selected}
            target={target}
            nutrition={nutrition}
            onClose={() => setSelected(null)}
            onAdd={(displayUnit, displayAmountMilli) => add(selected, displayUnit, displayAmountMilli)}
            onEdit={() => edit(selected)}
            onFailed={(error) => message.failed(error)}
            onConversion={(conversion) => {
              const base = editableBaseOf(selected.ref);
              if (base === undefined) return;
              const values = foodValuesOf(selected.snapshot);
              saveOwnFood(base, { ...values, portions: [...values.portions, conversion] }, selected.captureMethod, conversion.unit);
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function SearchHits({
  hits,
  query,
  onSelect,
  onCreate,
}: {
  hits: readonly FoodSearchHit[];
  query: string;
  onSelect: (hit: FoodSearchHit) => void;
  onCreate: (name: string) => void;
}) {
  if (hits.length === 0) {
    // Ohne Treffer: „Eigenes Lebensmittel anlegen“ mit dem Suchtext als Namen (Spezifikation 2, Abschnitt 4).
    return (
      <>
        <Text tone="inkMuted">{nutritionTexts.noHits(query)}</Text>
        <ListGroup>
          <ListRow icon="pencil" title={nutritionTexts.createNamed(query)} onPress={() => onCreate(query)} />
        </ListGroup>
      </>
    );
  }
  return (
    <ListGroup>
      {hits.map((hit) => {
        const per100 = nutritionTexts.per100(hit.kcalPer100, hit.snapshot.baseUnit);
        // Quellenmarke in derselben Zeile: So passen auf das iPhone SE mit Tastatur mehr Treffer.
        return (
          <ListRow
            key={foodRefKey(hit.ref)}
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
 * Die Plätze unter der Suche: die noch fehlenden Plätze, „Zuletzt verwendet“, Lebensmittelfavoriten und
 * „Eigenes Lebensmittel anlegen“ als letzter. Plätze, die spätere Tickets füllen, zeigen Test-Artefakte als
 * „Kommt noch“, damit die Reihenfolge sichtbar bleibt; im Release ist ein fehlender Platz ein
 * Integrationsfehler wie ein fehlender Bildschirm.
 */
function Slots({
  meal,
  quick,
  onPick,
  onCreate,
}: {
  meal: MealKey;
  /** `null`, bis die erste Abfrage gelaufen ist. */
  quick: QuickFoods | null;
  onPick: (food: QuickFood, captureMethod: 'zuletzt' | 'lebensmittelfavorit') => void;
  onCreate: () => void;
}) {
  if (!isTestArtifact()) throw new Error(`Integrationsfehler: Auf dem Hinzufügen-Bildschirm fehlen die Plätze ${laterSlots.join(', ')}.`);
  return (
    <>
      <ListGroup>
        {laterSlots.map((slot) => (
          <View key={slot} testID={`platz-${slot}`}>
            <ListRow icon={slotIcons[slot]} title={nutritionTexts.slots[slot]} subtitle={nutritionTexts.slotInWork} disabled />
          </View>
        ))}
      </ListGroup>
      <QuickList
        slot="zuletzt"
        foods={quick?.recent ?? null}
        empty={nutritionTexts.quick.noRecent(meal)}
        onPick={(food) => onPick(food, 'zuletzt')}
      />
      <QuickList
        slot="lebensmittelfavoriten"
        foods={quick?.favorites ?? null}
        empty={nutritionTexts.quick.noFavorites}
        onPick={(food) => onPick(food, 'lebensmittelfavorit')}
      />
      <View testID="platz-eigenes_lebensmittel">
        <ListGroup>
          <ListRow icon="pencil" title={nutritionTexts.slots.eigenes_lebensmittel} onPress={onCreate} />
        </ListGroup>
      </View>
    </>
  );
}

/** Eine Liste unter ihrer Überschrift: höchstens fünf Lebensmittel, danach „Alle anzeigen“. */
function QuickList({
  slot,
  foods,
  empty,
  onPick,
}: {
  slot: 'zuletzt' | 'lebensmittelfavoriten';
  foods: readonly QuickFood[] | null;
  /** Satz ohne Einträge: was hier künftig steht. */
  empty: string;
  onPick: (food: QuickFood) => void;
}) {
  const [all, setAll] = useState(false);
  const title = nutritionTexts.slots[slot];
  const shown = foods === null ? [] : all ? foods : foods.slice(0, listPreview);
  return (
    <View testID={`platz-${slot}`} style={styles.section}>
      <Text variant="headline" accessibilityRole="header">
        {title}
      </Text>
      {foods === null ? (
        <Skeleton height={size.rowMin} radius="lg" />
      ) : foods.length === 0 ? (
        <Text variant="label" tone="inkMuted">
          {empty}
        </Text>
      ) : (
        <ListGroup>
          {shown.map((food) => {
            const amount = amountText(food.prefill.displayUnit, food.prefill.displayAmountMilli);
            return (
              <ListRow
                key={foodRefKey(food.ref)}
                title={food.snapshot.name}
                subtitle={nutritionTexts.quick.row(amount, food.kcal)}
                onPress={() => onPick(food)}
                accessibilityLabel={nutritionTexts.quick.rowLabel(food.snapshot.name, amount, food.kcal)}
              />
            );
          })}
        </ListGroup>
      )}
      {foods !== null && foods.length > listPreview ? (
        <Button variant="text" label={all ? nutritionTexts.quick.showFewer : nutritionTexts.quick.showAll(foods.length)} onPress={() => setAll((shownAll) => !shownAll)} />
      ) : null}
    </View>
  );
}

function CaptureSkeleton() {
  return (
    <View style={styles.skeleton} accessible accessibilityLabel={nutritionTexts.loading(nutritionTexts.capture)}>
      <Skeleton height={size.fieldHeight} radius="md" />
      <Skeleton height={size.rowMin * 3} radius="lg" />
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { gap: space[4] },
  section: { gap: space[2] },
});
