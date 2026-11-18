import type { LocalDate, MealKey } from '@abnehm/contracts/base';
import {
  roundKcal,
  type CaptureMethod,
  type DisplayUnit,
  type FoodRef,
  type NutritionEntryAddedOutcome,
  type NutritionSnapshot,
  type PortionConversion,
} from '@abnehm/contracts/nutrition';
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
import type { Nutrition } from './nutrition';
import { checkPortionDraft, emptyOwnFoodDraft, ownFoodDraftOf, type OwnFoodDraft } from './own-food-input';
import { ownFoodBaseOf, ownFoodValuesOf, type OwnFoodBase, type OwnFoodValues } from './own-foods';
import { OwnFoodForm } from './OwnFoodForm';
import {
  amountProblemText,
  conversionProblemText,
  dateText,
  kcalText,
  macrosText,
  markNames,
  mealNames,
  milliText,
  nutritionTexts,
  ownFoodProblemText,
  sourceNames,
  unitChipText,
  unitText,
} from './texts';
import { useLocalToday } from './use-day-log';

// Hinzufügen-Bildschirm (Spezifikation 2, Abschnitt 6) für die Route `capture.food`: feste Plätze in
// der Reihenfolge Suche, „Barcode scannen“, „Foto aufnehmen“, Mahlzeitenfavoriten, „Zuletzt verwendet“,
// Lebensmittelfavoriten und „Eigenes Lebensmittel anlegen“. #155 füllt die Suche, #157 den letzten Platz
// samt Formular; die übrigen Plätze füllen ihre Tickets (#158–#163). Vor jedem Speichern prüft die
// Person Menge und Einheit im Sheet. Das Formular „Eigenes Lebensmittel“ ist ein Schritt dieses
// Bildschirms, kein Sheet: Es braucht Tastatur und Platz, und Sheets liegen nie in Sheets.

/** Plätze, die spätere Tickets füllen, in fester Reihenfolge zwischen Suche und eigenem Lebensmittel. */
const laterSlots = ['barcode', 'foto', 'mahlzeitenfavoriten', 'zuletzt', 'lebensmittelfavoriten'] as const;
type LaterSlot = (typeof laterSlots)[number];

const slotIcons: Readonly<Record<LaterSlot, IconName>> = {
  barcode: 'barcode',
  foto: 'camera',
  mahlzeitenfavoriten: 'plate',
  zuletzt: 'undo',
  lebensmittelfavoriten: 'star',
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

/** Ein Lebensmittel in der Mengenprüfung: Referenz, aktuelle Fassung und wie die Person es gefunden hat. */
type Selection = Readonly<{
  ref: FoodRef;
  snapshot: NutritionSnapshot;
  captureMethod: CaptureMethod;
  /** Vorgewählte Einheit, etwa die gerade eingetragene Umrechnung; sonst die Vorbelegung des Moduls. */
  unit?: DisplayUnit;
}>;

/** Der Formularschritt „Eigenes Lebensmittel“: was gespeichert wird und womit das Formular beginnt. */
type FormStep = Readonly<{
  base: OwnFoodBase;
  initial: OwnFoodDraft;
  title: string;
  hint?: string;
  captureMethod: CaptureMethod;
}>;

function AddSlots({ nutrition, meal, localDate }: { nutrition: Nutrition; meal: MealKey; localDate: LocalDate }) {
  const search = useFoodSearch(nutrition);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Selection | null>(null);
  const [form, setForm] = useState<FormStep | null>(null);
  // Jede Änderung an einem eigenen Lebensmittel zählt hoch; danach liest die Suche neu.
  const [ownFoodChanges, setOwnFoodChanges] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `ownFoodChanges` löst das erneute Lesen aus.
  const result = useMemo(() => search.search(query), [search, query, ownFoodChanges]);
  const message = useUndoableMessage();

  const add = (choice: Selection, displayUnit: DisplayUnit, displayAmountMilli: number) => {
    let outcome: NutritionEntryAddedOutcome;
    try {
      outcome = nutrition.addEntry({ localDate, meal, captureMethod: choice.captureMethod, foodRef: choice.ref, snapshot: choice.snapshot, displayUnit, displayAmountMilli });
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

  /** Speichert ein eigenes Lebensmittel und öffnet es danach in der Mengenprüfung. */
  const saveOwnFood = (base: OwnFoodBase, values: OwnFoodValues, captureMethod: CaptureMethod, unit?: DisplayUnit) => {
    let saved;
    try {
      saved = nutrition.saveOwnFood(base, values);
    } catch (error) {
      // Das Formular hat die Werte schon geprüft; scheitert der Befehl trotzdem, ist das ein Fehler.
      message.failed(error);
      return;
    }
    setOwnFoodChanges((count) => count + 1);
    setForm(null);
    setSelected({ ...saved, captureMethod, unit });
  };

  const create = (name = '') =>
    setForm({ base: null, initial: emptyOwnFoodDraft(name), title: nutritionTexts.ownFood.create, captureMethod: 'eigenes_lebensmittel' });

  /** „Bearbeiten“ eines eigenen bzw. „Werte korrigieren“ eines BLS-Lebensmittels aus der Mengenprüfung. */
  const edit = (choice: Selection) => {
    const base = ownFoodBaseOf(choice.ref);
    if (base === undefined || base === null) return;
    const own = base.type === 'eigen';
    setSelected(null);
    setForm({
      base,
      initial: ownFoodDraftOf(choice.snapshot),
      title: own ? nutritionTexts.ownFood.edit : nutritionTexts.ownFood.correct,
      hint: own ? undefined : nutritionTexts.ownFood.correctHint,
      captureMethod: choice.captureMethod,
    });
  };

  if (form !== null) {
    const { base } = form;
    return (
      <OwnFoodForm
        title={form.title}
        hint={form.hint}
        initial={form.initial}
        onSave={(values) => saveOwnFood(base, values, form.captureMethod)}
        onCancel={() => setForm(null)}
        onDelete={
          base?.type === 'eigen'
            ? () => {
                try {
                  nutrition.deleteOwnFood(base.key);
                } catch (error) {
                  message.failed(error);
                }
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
          onSelect={(hit) => setSelected({ ref: hit.ref, snapshot: hit.snapshot, captureMethod: 'suche' })}
          onCreate={create}
        />
      ) : (
        <Slots onCreate={() => create()} />
      )}
      <Sheet visible={selected !== null} onClose={() => setSelected(null)} height="full">
        {selected === null ? null : (
          <AmountReview
            key={`${selected.ref.type}:${selected.ref.key}:${ownFoodChanges}`}
            selection={selected}
            nutrition={nutrition}
            onClose={() => setSelected(null)}
            onAdd={(displayUnit, displayAmountMilli) => add(selected, displayUnit, displayAmountMilli)}
            onEdit={() => edit(selected)}
            onConversion={(conversion) => {
              const base = ownFoodBaseOf(selected.ref);
              if (base === undefined) return;
              const values = ownFoodValuesOf(selected.snapshot);
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
 * Die Plätze unter der Suche, „Eigenes Lebensmittel anlegen“ als letzter. Plätze, die spätere Tickets
 * füllen, zeigen Test-Artefakte als „Kommt noch“, damit die Reihenfolge sichtbar bleibt; im Release ist
 * ein fehlender Platz ein Integrationsfehler wie ein fehlender Bildschirm.
 */
function Slots({ onCreate }: { onCreate: () => void }) {
  if (!isTestArtifact()) throw new Error(`Integrationsfehler: Auf dem Hinzufügen-Bildschirm fehlen die Plätze ${laterSlots.join(', ')}.`);
  return (
    <ListGroup>
      {laterSlots.map((slot) => (
        <View key={slot} testID={`platz-${slot}`}>
          <ListRow icon={slotIcons[slot]} title={nutritionTexts.slots[slot]} subtitle={nutritionTexts.slotInWork} disabled />
        </View>
      ))}
      <View testID="platz-eigenes_lebensmittel">
        <ListRow icon="pencil" title={nutritionTexts.slots.eigenes_lebensmittel} onPress={onCreate} />
      </View>
    </ListGroup>
  );
}

/**
 * Mengenprüfung als Sheet: Name und Quelle, Mengenfeld mit Einheiten-Chips, kcal groß, Makros klein und
 * „Hinzufügen“. Vorbelegt ist die letzte Menge dieses Lebensmittels, sonst eine Portion, sonst 100 g bzw. ml.
 * Stück und Portion gibt es nur mit bekannter Umrechnung; eine fehlende trägt die Person hier ein.
 */
function AmountReview({
  selection,
  nutrition,
  onClose,
  onAdd,
  onEdit,
  onConversion,
}: {
  selection: Selection;
  nutrition: Nutrition;
  onClose: () => void;
  onAdd: (displayUnit: DisplayUnit, displayAmountMilli: number) => void;
  onEdit: () => void;
  onConversion: (conversion: PortionConversion) => void;
}) {
  const { snapshot } = selection;
  const [prefill] = useState(() =>
    selection.unit === undefined
      ? nutrition.prefillAmount(selection.ref, snapshot)
      : { displayUnit: selection.unit, displayAmountMilli: defaultAmountMilli(snapshot, selection.unit) },
  );
  const [unit, setUnit] = useState<DisplayUnit>(prefill.displayUnit);
  const [input, setInput] = useState(() => milliText(prefill.displayAmountMilli));
  const [submitted, setSubmitted] = useState(false);
  const [addingConversion, setAddingConversion] = useState(false);
  const check = checkAmountInput(snapshot, unit, input);
  // Ein leeres Feld beim Tippen ist noch kein Fehler; erst „Hinzufügen“ fragt nach der Menge.
  const problem = check.type === 'problem' && (submitted || check.problem !== 'leer') ? amountProblemText(check.problem, snapshot.baseUnit) : undefined;
  const units: DisplayUnit[] = [snapshot.baseUnit, ...snapshot.portions.map((portion) => portion.unit)];
  // Die Quellenangabe nennt die Quelle schon (BLS, Open Food Facts); sonst die Art der Werte.
  const source = snapshot.attribution ?? sourceNames[snapshot.source];
  const kcal = check.type === 'menge' ? kcalText(roundKcal(check.totals.milliKcal)) : nutritionTexts.noKcal;
  // Ändern lässt sich ein eigenes oder ein BLS-Lebensmittel; ein Barcode-Produkt erst mit #160.
  const base = ownFoodBaseOf(selection.ref);
  const missing = (['stueck', 'portion'] as const).filter((candidate) => !snapshot.portions.some((portion) => portion.unit === candidate));

  if (addingConversion && base !== undefined && base !== null) {
    return <ConversionStep snapshot={snapshot} own={base.type === 'eigen'} missing={missing} onBack={() => setAddingConversion(false)} onSave={onConversion} />;
  }

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
      {base === undefined || base === null ? null : (
        <View style={styles.foodActions}>
          {missing.length > 0 ? (
            <Button variant="text" icon="plus" label={nutritionTexts.addConversion(missing)} onPress={() => setAddingConversion(true)} />
          ) : null}
          <Button
            variant="text"
            icon="pencil"
            label={base.type === 'eigen' ? nutritionTexts.editFood : nutritionTexts.ownFood.correct}
            onPress={onEdit}
          />
        </View>
      )}
    </View>
  );
}

/**
 * Fehlende Umrechnung eintragen (Spezifikation 2, Abschnitt 2): wie viel g bzw. ml ein Stück oder eine
 * Portion hat, optional mit Bezeichnung. Bei einem eigenen Lebensmittel wird sie dort gespeichert, bei
 * einer externen Quelle entsteht ein eigenes Lebensmittel. Die App schätzt keine Umrechnung.
 */
function ConversionStep({
  snapshot,
  own,
  missing,
  onBack,
  onSave,
}: {
  snapshot: NutritionSnapshot;
  own: boolean;
  missing: readonly ('stueck' | 'portion')[];
  onBack: () => void;
  onSave: (conversion: PortionConversion) => void;
}) {
  const texts = nutritionTexts.conversion;
  const [unit, setUnit] = useState(missing[0] ?? 'stueck');
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const check = checkPortionDraft(unit, snapshot.baseUnit, { amount, label });
  const amountProblem = submitted && check.type === 'probleme' ? check.problems.amount : undefined;
  const labelProblem = submitted && check.type === 'probleme' ? check.problems.label : undefined;

  return (
    <View style={styles.sheet}>
      <View style={styles.sheetHead}>
        <View style={styles.grow}>
          <Text variant="title" accessibilityRole="header">
            {texts.title}
          </Text>
          <Text variant="caption" tone="inkMuted">
            {snapshot.name}
          </Text>
        </View>
        <IconButton icon="close" accessibilityLabel={texts.back} onPress={onBack} />
      </View>
      {missing.length > 1 ? (
        <View style={styles.units}>
          {missing.map((option) => (
            <Chip key={option} label={texts.unitName[option]} selection="single" selected={option === unit} onPress={() => setUnit(option)} />
          ))}
        </View>
      ) : null}
      <TextField
        kind="number"
        label={nutritionTexts.ownFood.conversionAmount(unit)}
        unit={snapshot.baseUnit}
        value={amount}
        onChangeText={setAmount}
        problem={amountProblem === undefined ? undefined : conversionProblemText(unit, amountProblem, snapshot.baseUnit)}
      />
      <TextField
        kind="text"
        label={nutritionTexts.ownFood.conversionLabel(unit)}
        placeholder={nutritionTexts.ownFood.conversionPlaceholder(unit)}
        value={label}
        onChangeText={setLabel}
        problem={labelProblem === undefined ? undefined : ownFoodProblemText('stueckLabel', labelProblem, snapshot.baseUnit)}
      />
      <Text variant="label" tone="inkMuted">
        {texts.hint(own)}
      </Text>
      <Button
        label={nutritionTexts.ownFood.save}
        block
        onPress={() => {
          setSubmitted(true);
          if (check.type === 'umrechnung') onSave(check.conversion);
        }}
      />
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
  sheet: { gap: space[4] },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  grow: { flex: 1, gap: space[1] },
  units: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  values: { gap: space[1] },
  foodActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], justifyContent: 'center' },
  skeleton: { gap: space[4] },
});
