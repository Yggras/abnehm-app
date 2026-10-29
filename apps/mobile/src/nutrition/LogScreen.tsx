import { MealKey, type LocalDate } from '@abnehm/contracts/base';
import { StyleSheet, View } from 'react-native';

import { useClock } from '../clock/clock-context';
import { Card, IconButton, ListGroup, ListRow, size, Skeleton, space, Text } from '../design';
import { openTarget } from '../navigation';
import { ScreenFrame } from '../shell/ScreenFrame';
import { useNutrition } from './app-nutrition';
import type { DayLog, DayLogMeal } from './day-log';
import { useDayLog, useLocalToday } from './use-day-log';
import { amountText, dateText, kcalText, mealNames, nutritionTexts } from './texts';

// Tab „Protokoll“ (Spezifikation 2, Abschnitt 6): Kopf mit Datum, Wochentag und Tagessumme, ohne
// Budgetvergleich (der bleibt auf „Heute“), darunter die vier Mahlzeiten mit Summe, Einträgen und „+“.
// Der Bildschirm spricht nur mit dem Ernährungsmodul. Tagesnavigation und Bearbeiten ergänzt #156.

export function LogScreen() {
  const nutrition = useNutrition();
  const today = useLocalToday(useClock());
  const log = useDayLog(nutrition, today);
  return (
    <ScreenFrame title={nutritionTexts.log} presentation="tab">
      {log === null ? <LogSkeleton /> : <DayLogView log={log} today={today} />}
    </ScreenFrame>
  );
}

function DayLogView({ log, today }: { log: DayLog; today: LocalDate }) {
  const isToday = log.localDate === today;
  return (
    <>
      <Card>
        <View style={styles.head}>
          <Text variant="label" tone="inkMuted">
            {isToday ? `${nutritionTexts.today}, ${dateText(log.localDate)}` : dateText(log.localDate)}
          </Text>
          <View accessible accessibilityLabel={nutritionTexts.intake(isToday, log.intakeKcal)} style={styles.intake}>
            <Text variant="numberM">{kcalText(log.intakeKcal)}</Text>
            <Text variant="label" tone="inkMuted">
              {nutritionTexts.intakeLabel}
            </Text>
          </View>
        </View>
      </Card>
      {log.meals.map((meal) => (
        <MealSection key={meal.meal} meal={meal} localDate={log.localDate} />
      ))}
    </>
  );
}

function MealSection({ meal, localDate }: { meal: DayLogMeal; localDate: LocalDate }) {
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
      {hasEntries ? (
        <ListGroup>
          {meal.entries.map((entry) => {
            const amount = amountText(entry.displayUnit, entry.displayAmountMilli);
            return (
              <ListRow
                key={entry.id}
                title={entry.name}
                subtitle={amount}
                value={kcalText(entry.kcal)}
                accessibilityLabel={nutritionTexts.entry(meal.meal, entry.name, amount, entry.kcal)}
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
  intake: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: space[2] },
  meal: { gap: space[2] },
  mealHead: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  mealTitle: { flex: 1, flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: space[2] },
  skeleton: { gap: space[4] },
});
