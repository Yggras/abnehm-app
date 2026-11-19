import { localDateAfter, MealKey, type EntityId, type LocalDate } from '@abnehm/contracts/base';
import type { NutritionEntryDeletedOutcome, NutritionEntryUpdatedOutcome } from '@abnehm/contracts/nutrition';
import { usePathname } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useClock } from '../clock/clock-context';
import { Button, Card, IconButton, ListGroup, ListRow, Sheet, size, Skeleton, space, Text } from '../design';
import { openTarget, pathOf, routeCatalog } from '../navigation';
import { useMessageHost } from '../shell/MessageHost';
import { ScreenFrame } from '../shell/ScreenFrame';
import { useUndoableMessage } from '../shell/use-undoable-message';
import { useNutrition } from './app-nutrition';
import type { DayLog, DayLogMeal, EntryDetail } from './day-log';
import type { EntryChange } from './entries';
import { EntryEditor } from './EntryEditor';
import { MealPhotoStrip, MealPhotoView } from './MealPhotos';
import type { Nutrition } from './nutrition';
import { useDayLog, useLocalToday } from './use-day-log';
import { amountText, kcalText, logDayParts, logDayText, macrosText, mealNames, nutritionTexts } from './texts';

// Tab „Protokoll“ (Spezifikation 2, Abschnitt 6): Kopf mit Tagesnavigation, Datum, Wochentag, Tagessumme und
// aufklappbaren Tagesmakros, ohne Budgetvergleich (der bleibt auf „Heute“), darunter die vier Mahlzeiten mit
// Summe, Einträgen und „+“. Das Protokoll öffnet „Heute“, blättert tageweise zurück und springt mit „Heute“
// zurück; künftige Tage sind nicht erreichbar. Ein neuer Eintrag gehört zum gewählten Tag. Antippen eines
// Eintrags öffnet seine Mengenansicht. Online zeigt jede Mahlzeit die Vorschauen ihrer Fotos; Antippen öffnet
// die Fotoansicht (#164). Der Bildschirm spricht nur mit dem Ernährungsmodul.

/** Pfade der übrigen Tabs; dorthin zu wechseln setzt den gewählten Tag zurück. */
const otherTabPaths = new Set(
  (Object.keys(routeCatalog) as (keyof typeof routeCatalog)[]).filter((name) => name !== 'log' && routeCatalog[name].presentation === 'tab').map(pathOf),
);

export function LogScreen() {
  const nutrition = useNutrition();
  const today = useLocalToday(useClock());
  // `null` folgt „heute“, auch über Mitternacht; ein früherer Tag bleibt gewählt.
  const [chosen, setChosen] = useState<LocalDate | null>(null);
  // Das Protokoll öffnet „Heute“: Ein Wechsel auf einen anderen Tab setzt den Tag zurück. Ein Bildschirm
  // darüber, etwa Erfassen beim Nachtragen, ist kein Tab und behält den Tag.
  // Angepasst beim Rendern statt im Effekt (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const pathname = usePathname();
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    if (otherTabPaths.has(pathname)) setChosen(null);
  }
  const localDate = chosen !== null && chosen < today ? chosen : today;
  const log = useDayLog(nutrition, localDate);
  return (
    <ScreenFrame title={nutritionTexts.log} presentation="tab">
      {log === null || nutrition === null ? (
        <LogSkeleton />
      ) : (
        <DayLogView
          nutrition={nutrition}
          log={log}
          today={today}
          onDay={(day) => setChosen(day >= today ? null : day)}
        />
      )}
    </ScreenFrame>
  );
}

function DayLogView({ nutrition, log, today, onDay }: { nutrition: Nutrition; log: DayLog; today: LocalDate; onDay: (day: LocalDate) => void }) {
  const [editing, setEditing] = useState<EntryDetail | null>(null);
  const [viewing, setViewing] = useState<{ photoId: EntityId; meal: MealKey } | null>(null);
  const message = useUndoableMessage();
  const { showMessage } = useMessageHost();
  const closePhoto = useCallback(() => setViewing(null), []);

  /** Führt einen Befehl aus, zeigt seine Meldung mit „Rückgängig“ und schließt das Sheet. */
  const run = (command: () => NutritionEntryUpdatedOutcome | NutritionEntryDeletedOutcome) => {
    try {
      const outcome = command();
      message.show(outcome, { run: () => nutrition.undo(outcome.undoToken), expire: () => nutrition.expire(outcome.undoToken) });
    } catch (error) {
      message.failed(error);
    }
    setEditing(null);
  };

  return (
    <>
      <DayHead log={log} today={today} onDay={onDay} />
      {log.meals.map((meal) => (
        <MealSection
          key={meal.meal}
          nutrition={nutrition}
          meal={meal}
          localDate={log.localDate}
          onEntry={(id) => setEditing(nutrition.entryDetail(id))}
          onPhoto={(photoId) => setViewing({ photoId, meal: meal.meal })}
        />
      ))}
      <Sheet visible={viewing !== null} onClose={closePhoto} height="full">
        {viewing === null ? null : (
          <MealPhotoView
            key={viewing.photoId}
            nutrition={nutrition}
            photoId={viewing.photoId}
            meal={viewing.meal}
            onClose={closePhoto}
            onDeleted={() => {
              setViewing(null);
              showMessage({ messageKey: 'ernaehrung.foto_geloescht', values: {} });
            }}
            onFailed={message.failed}
          />
        )}
      </Sheet>
      <Sheet visible={editing !== null} onClose={() => setEditing(null)} height="full">
        {editing === null ? null : (
          <EntryEditor
            key={editing.id}
            entry={editing}
            today={today}
            nutrition={nutrition}
            onFailed={message.failed}
            onClose={() => setEditing(null)}
            onSave={(change: EntryChange) => run(() => nutrition.updateEntry(editing.id, change))}
            onDelete={() => run(() => nutrition.deleteEntry(editing.id))}
          />
        )}
      </Sheet>
    </>
  );
}

/** Kopf: Tag mit Blättern und „Heute“, Tagessumme in kcal und aufklappbare Tagesmakros. */
function DayHead({ log, today, onDay }: { log: DayLog; today: LocalDate; onDay: (day: LocalDate) => void }) {
  const [macrosShown, setMacrosShown] = useState(false);
  const isToday = log.localDate === today;
  const { day, date } = logDayParts(log.localDate, today);
  return (
    <Card>
      <View style={styles.head}>
        <View style={styles.dayRow}>
          <IconButton icon="back" accessibilityLabel={nutritionTexts.previousDay} onPress={() => onDay(localDateAfter(log.localDate, -1))} />
          <View accessible accessibilityRole="header" accessibilityLabel={logDayText(log.localDate, today)} style={styles.day}>
            <Text variant="headline" style={styles.center}>
              {day}
            </Text>
            <Text variant="label" tone="inkMuted" style={styles.center}>
              {date}
            </Text>
          </View>
          <IconButton icon="chevron" accessibilityLabel={nutritionTexts.nextDay} disabled={isToday} onPress={() => onDay(localDateAfter(log.localDate, 1))} />
        </View>
        <View accessible accessibilityLabel={nutritionTexts.intake(isToday, log.intakeKcal)} style={styles.intake}>
          <Text variant="numberM">{kcalText(log.intakeKcal)}</Text>
          <Text variant="label" tone="inkMuted">
            {nutritionTexts.intakeLabel}
          </Text>
        </View>
        {macrosShown ? (
          <Text variant="label" tone="inkMuted">
            {macrosText(log.macros)}
          </Text>
        ) : null}
        <View style={styles.headActions}>
          <Button
            variant="text"
            label={macrosShown ? nutritionTexts.hideMacros : nutritionTexts.showMacros}
            onPress={() => setMacrosShown((shown) => !shown)}
          />
          {isToday ? null : <Button variant="secondary" compact icon="calendar" label={nutritionTexts.backToToday} onPress={() => onDay(today)} />}
        </View>
      </View>
    </Card>
  );
}

function MealSection({
  nutrition,
  meal,
  localDate,
  onEntry,
  onPhoto,
}: {
  nutrition: Nutrition;
  meal: DayLogMeal;
  localDate: LocalDate;
  onEntry: (id: EntityId) => void;
  onPhoto: (photoId: EntityId) => void;
}) {
  const name = mealNames[meal.meal];
  const hasEntries = meal.entries.length > 0;
  return (
    <View testID={`mahlzeit-${meal.meal}`} style={styles.meal}>
      <View style={styles.mealHead}>
        <View accessible accessibilityRole="header" accessibilityLabel={hasEntries ? `${name}, ${kcalText(meal.kcal)}` : name} style={styles.mealTitle}>
          <Text variant="headline">{name}</Text>
          {hasEntries ? (
            <Text variant="label" tone="inkMuted">
              {kcalText(meal.kcal)}
            </Text>
          ) : null}
        </View>
        <IconButton
          icon="plus"
          accessibilityLabel={nutritionTexts.addTo(meal.meal)}
          onPress={() => openTarget({ type: 'capture.food', meal: meal.meal, localDate })}
        />
      </View>
      <MealPhotoStrip nutrition={nutrition} meal={meal.meal} photoIds={meal.photoIds} onOpen={onPhoto} />
      {hasEntries ? (
        <ListGroup>
          {meal.entries.map((entry) => {
            const amount = amountText(entry.displayUnit, entry.displayAmountMilli);
            return (
              <ListRow
                key={entry.id}
                icon={entry.fromPhoto ? 'camera' : undefined}
                title={entry.name}
                subtitle={amount}
                value={kcalText(entry.kcal)}
                accessibilityLabel={nutritionTexts.entry(meal.meal, entry.name, amount, entry.kcal, entry.aiEstimate)}
                onPress={() => onEntry(entry.id)}
              />
            );
          })}
        </ListGroup>
      ) : (
        <Card variant="empty">
          <Text tone="inkMuted">{nutritionTexts.emptyMeal}</Text>
        </Card>
      )}
    </View>
  );
}

/** Laden: Skelett in der Form von Kopf und Mahlzeiten, keine Spinner. */
function LogSkeleton() {
  return (
    <View style={styles.skeleton} accessible accessibilityLabel={nutritionTexts.loading(nutritionTexts.log)}>
      <Card>
        <View style={styles.head}>
          <Skeleton width="60%" />
          <Skeleton width="30%" />
        </View>
      </Card>
      {MealKey.options.map((meal) => (
        <View key={meal} style={styles.meal}>
          <Skeleton width="40%" />
          <Skeleton height={size.rowMin} radius="lg" />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { gap: space[1] },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  day: { flex: 1 },
  center: { textAlign: 'center' },
  intake: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: space[2] },
  headActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  meal: { gap: space[2] },
  mealHead: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  mealTitle: { flex: 1, flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: space[2] },
  skeleton: { gap: space[4] },
});
