import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { manualOrigin } from '@abnehm/contracts/tracker-rules';

import { Button, Card, color, ListGroup, ListRow, Notice, radius, Sheet, space, Text } from '../design';
import { openTarget } from '../navigation';
import type { WeightDetail, WeightHistoryEntry } from './weight-detail';
import { changeText, dayText, kgText, originNames, shortDayText, spokenChange, timeText, weightTexts } from './weight-texts';
import { WeightEntryForm, type EditedWeight, type WeightFormTrackers } from './WeightEntryForm';

// Inhalt des Gewicht-Detailbildschirms `capture.weight` (Spezifikation 3, Abschnitt 5; #38), von oben nach
// unten: Trendgewicht groß und Tagesgewicht klein, „seit Start“, Veränderung in 2 Wochen und Prognose als
// „Schätzung“; darunter alle Messungen mit Herkunft, das Tagesgewicht gekennzeichnet. Das Diagramm
// dazwischen liefert #177. Steigende Werte stehen neutral als Zahl mit Vorzeichen, nie in `problem`.
// Manuelle Messungen öffnen das Bearbeitungs-Sheet; das schreibgeschützte Sheet importierter liefert #186.

export type WeightDetailContentProps = {
  detail: WeightDetail;
  trackers: WeightFormTrackers;
};

const addTarget = { type: 'capture.weight', newEntry: true } as const;

export function WeightDetailContent({ detail, trackers }: WeightDetailContentProps) {
  const [editing, setEditing] = useState<EditedWeight | null>(null);
  if (detail.entries.length === 0) return <EmptyWeight />;
  return (
    <>
      <WeightSummary detail={detail} />
      <Button variant="secondary" label={weightTexts.add} block onPress={() => openTarget(addTarget)} />
      <View style={styles.section}>
        <Text variant="headline" accessibilityRole="header">
          {weightTexts.measurements}
        </Text>
        <ListGroup>
          {detail.entries.map((entry) => (
            <MeasurementRow key={entry.id} entry={entry} today={detail.today} onEdit={setEditing} />
          ))}
        </ListGroup>
      </View>
      <Sheet visible={editing !== null} onClose={() => setEditing(null)} height="full">
        {editing !== null ? (
          <View style={styles.sheet}>
            <Text variant="title" accessibilityRole="header">
              {weightTexts.editTitle}
            </Text>
            <WeightEntryForm key={editing.id} trackers={trackers} entry={editing} onSaved={() => setEditing(null)} />
          </View>
        ) : null}
      </Sheet>
    </>
  );
}

/** Leerzustand mit genau einer Aktion. */
function EmptyWeight() {
  return (
    <Card variant="empty">
      <View style={styles.empty}>
        <Text>{weightTexts.empty}</Text>
        <Button label={weightTexts.add} block onPress={() => openTarget(addTarget)} />
      </View>
    </Card>
  );
}

function WeightSummary({ detail }: { detail: WeightDetail }) {
  const { trend, lastDayWeight, forecast, today } = detail;
  if (lastDayWeight === null) return null;
  const dayWeight = weightTexts.dayWeightOn(lastDayWeight.weightG, lastDayWeight.localDate, today);
  return (
    <Card>
      <View style={styles.summary}>
        {trend === null ? (
          // Unter drei Tagesgewichten gibt es noch keinen Trend: Das Tagesgewicht steht groß, dazu der Hinweis.
          <>
            <View accessible accessibilityLabel={`${weightTexts.dayWeightLabel} ${kgText(lastDayWeight.weightG)}, ${dayText(lastDayWeight.localDate, today)}`}>
              <Text variant="label" tone="inkMuted">
                {weightTexts.dayWeightLabel}
              </Text>
              <Text variant="numberXl">{kgText(lastDayWeight.weightG)}</Text>
              <Text variant="label" tone="inkMuted">
                {dayText(lastDayWeight.localDate, today)}
              </Text>
            </View>
            <Notice tone="hint" text={weightTexts.belowThree} />
          </>
        ) : (
          <>
            <View accessible accessibilityLabel={`${weightTexts.trendLabel} ${kgText(trend.trendG)}. ${weightTexts.trendExplained} ${dayWeight}`} style={styles.trend}>
              <View>
                <Text variant="label" tone="inkMuted">
                  {weightTexts.trendLabel}
                </Text>
                <Text variant="numberXl">{kgText(trend.trendG)}</Text>
              </View>
              {/* Hauptaufgabe (Impeccable-Kritik): den Trend verstehen, ohne von Tagesschwankungen verunsichert zu werden. */}
              <Text variant="label">{weightTexts.trendExplained}</Text>
              <Text variant="label" tone="inkMuted">
                {dayWeight}
              </Text>
            </View>
            <View style={styles.facts}>
              <Text accessibilityLabel={weightTexts.spokenSinceStart(trend.sinceStartG)}>{weightTexts.sinceStart(trend.sinceStartG)}</Text>
              <Text accessibilityLabel={spokenChange(trend.change)}>{changeText(trend.change)}</Text>
              {forecast !== null ? (
                <View accessible accessibilityLabel={`${weightTexts.forecast(forecast.goalWeightG, forecast.localDate)}, ${weightTexts.estimate}`} style={styles.forecast}>
                  <Text>{weightTexts.forecast(forecast.goalWeightG, forecast.localDate)}</Text>
                  <View style={styles.estimate}>
                    <Text variant="caption">{weightTexts.estimate}</Text>
                  </View>
                </View>
              ) : null}
            </View>
          </>
        )}
      </View>
    </Card>
  );
}

function MeasurementRow({ entry, today, onEdit }: { entry: WeightHistoryEntry; today: WeightDetail['today']; onEdit: (entry: EditedWeight) => void }) {
  const when = `${shortDayText(entry.localDate, today)} · ${timeText(entry.measuredAt, entry.timeZone)}`;
  const imported = entry.origin !== manualOrigin;
  const parts = [when, entry.isDayWeight ? weightTexts.dayWeightMark : null, imported ? entry.sourceAppName : originNames.manuell].filter(Boolean);
  const subtitle = parts.join(' · ');
  return (
    <ListRow
      title={kgText(entry.weightG)}
      subtitle={subtitle}
      tag={imported ? originNames[entry.origin] : undefined}
      accessibilityLabel={`${kgText(entry.weightG)}, ${subtitle}${imported ? `, ${originNames[entry.origin]}` : ''}`}
      onPress={imported ? undefined : () => onEdit({ id: entry.id, weightG: entry.weightG, measuredAt: entry.measuredAt })}
    />
  );
}

const styles = StyleSheet.create({
  section: { gap: space[2] },
  summary: { gap: space[3] },
  trend: { gap: space[1] },
  facts: { gap: space[1] },
  forecast: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] },
  // Wie das Herkunfts-Etikett der Listenzeile: neutral, kein Warnton.
  estimate: { paddingHorizontal: space[2], borderRadius: radius.sm, backgroundColor: color.neutralSoft },
  empty: { gap: space[3] },
  sheet: { gap: space[4] },
});
