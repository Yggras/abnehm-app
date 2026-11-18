import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { localDateAfter, type LocalDate } from '@abnehm/contracts/base';

import { Button, Card, Icon, IconButton, ListGroup, ListRow, ProgressBar, Sheet, space, Text } from '../design';
import { openTarget } from '../navigation';
import { activityNames } from '../shell/texts';
import { activityIcons } from './activity-icons';
import { originNames } from './entry-texts';
import { ImportedEntrySheet, type ImportedSheetTrackers } from './ImportedEntrySheet';
import { SportEntryForm, type EditedSport, type SportFormTrackers } from './SportEntryForm';
import { sportTexts } from './sport-texts';
import type { SportDay, SportListEntry, SportWeek } from './sport-week';

// Inhalt des Sport-Detailbildschirms `capture.sport` (Spezifikation 3, Abschnitt 5; #38), von oben nach
// unten: Wochenwechsel, Wochenbalken „X von Wochenziel min“ (Montag bis Sonntag), „+ Einheit“ und die
// Einträge nach Tag. Geblättert wird nur in die Vergangenheit und zurück bis zur laufenden Woche. Manuelle
// Einheiten öffnen das Bearbeitungs-Sheet, importierte ihr schreibgeschütztes Sheet mit „Aktivitätsart
// ändern“ und „Ausblenden“ (#186); nirgends gibt es einen Bestätigungsdialog. Das Abzeichen „ersetzt“
// liefert #185.

export type SportWeekContentProps = {
  week: SportWeek;
  trackers: SportFormTrackers & ImportedSheetTrackers;
  /** Blättert zur Woche, die diesen Tag enthält; `null` ist die laufende Woche. */
  onWeek: (day: LocalDate | null) => void;
};

const addTarget = { type: 'capture.sport', newEntry: true } as const;

export function SportWeekContent({ week, trackers, onWeek }: SportWeekContentProps) {
  const [editing, setEditing] = useState<EditedSport | null>(null);
  const [viewing, setViewing] = useState<SportListEntry | null>(null);
  return (
    <>
      <WeekSwitch week={week} onWeek={onWeek} />
      <WeekSummary week={week} />
      {week.days.length === 0 ? (
        <Card variant="empty">
          <Text>{sportTexts.empty(week.isCurrent)}</Text>
        </Card>
      ) : (
        week.days.map((day) => <DayGroup key={day.localDate} day={day} today={week.today} onEdit={setEditing} onView={setViewing} />)
      )}
      <Sheet visible={editing !== null} onClose={() => setEditing(null)} height="full">
        {editing !== null ? (
          <SportEntryForm key={editing.id} trackers={trackers} entry={editing} title={sportTexts.editTitle} onSaved={() => setEditing(null)} />
        ) : null}
      </Sheet>
      <Sheet visible={viewing !== null} onClose={() => setViewing(null)} height="full">
        {viewing !== null ? (
          <ImportedEntrySheet
            key={viewing.id}
            imported={{ type: 'training', entry: viewing }}
            today={week.today}
            trackers={trackers}
            onDone={() => setViewing(null)}
          />
        ) : null}
      </Sheet>
    </>
  );
}

/**
 * Wochenstand: die Minuten groß wie auf dem Mini-Tracker, darunter der Balken bis zum Sportwochenziel
 * (Impeccable-Kritik, #174). „+ Einheit“ gehört zur laufenden Woche; in vergangenen Wochen fehlt es, weil
 * eine neue Einheit mit „jetzt“ beginnt.
 */
function WeekSummary({ week }: { week: SportWeek }) {
  const target = week.weeklyTargetMinutes;
  const reached = target !== null && target > 0 && week.weekMinutes >= target;
  return (
    <Card>
      <View style={styles.summary}>
        <View style={styles.total}>
          <Text variant="numberXl">{sportTexts.minutes(week.weekMinutes)}</Text>
          <Text tone="inkMuted">{target === null ? sportTexts.thisWeek : sportTexts.ofTarget(target)}</Text>
          {reached ? (
            <View style={styles.reached}>
              <Icon name="check" size="sm" tone="success" />
              <Text variant="label" tone="success">
                {sportTexts.reached}
              </Text>
            </View>
          ) : null}
        </View>
        {target !== null ? (
          <ProgressBar label={sportTexts.barLabel} value={week.weekMinutes} target={target} valueText={sportTexts.progress(week.weekMinutes, target)} legend={false} />
        ) : null}
        {week.isCurrent ? (
          <View style={styles.add}>
            <Button compact variant="secondary" label={sportTexts.add} onPress={() => openTarget(addTarget)} />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

/** Vorige und nächste Woche; über die laufende Woche hinaus geht es nicht. */
function WeekSwitch({ week, onWeek }: Pick<SportWeekContentProps, 'week' | 'onWeek'>) {
  const previousSunday = localDateAfter(week.monday, -1);
  const nextMonday = localDateAfter(week.sunday, 1);
  return (
    <View style={styles.switch}>
      <IconButton icon="back" accessibilityLabel={sportTexts.previousWeek} onPress={() => onWeek(previousSunday)} />
      <Text variant="headline" accessibilityRole="header" accessibilityLabel={`${sportTexts.weekTitle(week)}, ${sportTexts.weekSpoken(week)}`} style={styles.title}>
        {sportTexts.weekTitle(week)}
      </Text>
      <IconButton
        icon="chevron"
        accessibilityLabel={sportTexts.nextWeek}
        disabled={week.isCurrent}
        onPress={() => onWeek(nextMonday >= week.today ? null : nextMonday)}
      />
    </View>
  );
}

type EntryActions = Readonly<{ onEdit: (entry: EditedSport) => void; onView: (entry: SportListEntry) => void }>;

function DayGroup({ day, today, onEdit, onView }: { day: SportDay; today: SportWeek['today'] } & EntryActions) {
  return (
    <View style={styles.day}>
      <Text variant="label" tone="inkMuted" accessibilityRole="header">
        {sportTexts.day(day.localDate, today)}
      </Text>
      <ListGroup>
        {day.entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} onEdit={onEdit} onView={onView} />
        ))}
      </ListGroup>
    </View>
  );
}

function EntryRow({ entry, onEdit, onView }: { entry: SportListEntry } & EntryActions) {
  const imported = entry.origin !== 'manuell';
  return (
    <ListRow
      icon={activityIcons[entry.activityType]}
      title={activityNames[entry.activityType]}
      value={sportTexts.minutes(entry.durationMinutes)}
      subtitle={sportTexts.details(entry)}
      tag={imported ? originNames[entry.origin] : undefined}
      accessibilityLabel={sportTexts.entrySpoken(entry)}
      onPress={imported ? () => onView(entry) : () => onEdit(editedOf(entry))}
    />
  );
}

function editedOf({ id, activityType, durationMinutes, startedAt, activeMilliKcal, timeZone }: SportListEntry): EditedSport {
  return { id, activityType, durationMinutes, startedAt, activeMilliKcal, timeZone };
}

const styles = StyleSheet.create({
  switch: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  title: { flex: 1, textAlign: 'center' },
  day: { gap: space[2] },
  summary: { gap: space[3] },
  total: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space[2] },
  reached: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  add: { alignItems: 'flex-end' },
});
