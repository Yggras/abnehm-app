import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { localDateAfter } from '@abnehm/contracts/base';

import { Button, Card, IconButton, ListGroup, ListRow, ProgressBar, Sheet, space, Text } from '../design';
import { openTarget } from '../navigation';
import { activityNames } from '../shell/texts';
import { activityIcons } from './activity-icons';
import { originNames } from './entry-texts';
import { SportEntryForm, type EditedSport, type SportFormTrackers } from './SportEntryForm';
import { sportTexts } from './sport-texts';
import type { SportDay, SportListEntry, SportWeek } from './sport-week';

// Inhalt des Sport-Detailbildschirms `capture.sport` (Spezifikation 3, Abschnitt 5; #38), von oben nach
// unten: Wochenwechsel, Wochenbalken „X von Wochenziel min“ (Montag bis Sonntag), „+ Einheit“ und die
// Einträge nach Tag. Geblättert wird nur in die Vergangenheit und zurück bis zur laufenden Woche. Manuelle
// Einheiten öffnen das Bearbeitungs-Sheet; nirgends gibt es einen Bestätigungsdialog. Importierte zeigen
// ihre Herkunft; ihr schreibgeschütztes Sheet und das Abzeichen „ersetzt“ liefern #185 und #186.

export type SportWeekContentProps = {
  week: SportWeek;
  trackers: SportFormTrackers;
  /** Blättert zur Woche, die diesen Tag enthält; `null` ist die laufende Woche. */
  onWeek: (day: SportWeek['monday'] | null) => void;
};

const addTarget = { type: 'capture.sport', newEntry: true } as const;

export function SportWeekContent({ week, trackers, onWeek }: SportWeekContentProps) {
  const [editing, setEditing] = useState<EditedSport | null>(null);
  return (
    <>
      <WeekSwitch week={week} onWeek={onWeek} />
      <Card>
        {week.weeklyTargetMinutes === null ? (
          <Text variant="bodyStrong">{sportTexts.withoutTarget(week.weekMinutes)}</Text>
        ) : (
          <ProgressBar
            label={sportTexts.barLabel}
            value={week.weekMinutes}
            target={week.weeklyTargetMinutes}
            valueText={sportTexts.progress(week.weekMinutes, week.weeklyTargetMinutes)}
          />
        )}
      </Card>
      <Button variant="secondary" label={sportTexts.add} block onPress={() => openTarget(addTarget)} />
      {week.days.length === 0 ? (
        <Card variant="empty">
          <Text>{sportTexts.empty(week.isCurrent)}</Text>
        </Card>
      ) : (
        week.days.map((day) => <DayGroup key={day.localDate} day={day} today={week.today} onEdit={setEditing} />)
      )}
      <Sheet visible={editing !== null} onClose={() => setEditing(null)} height="full">
        {editing !== null ? (
          <View style={styles.sheet}>
            <Text variant="title" accessibilityRole="header">
              {sportTexts.editTitle}
            </Text>
            <SportEntryForm key={editing.id} trackers={trackers} entry={editing} onSaved={() => setEditing(null)} />
          </View>
        ) : null}
      </Sheet>
    </>
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

function DayGroup({ day, today, onEdit }: { day: SportDay; today: SportWeek['today']; onEdit: (entry: EditedSport) => void }) {
  return (
    <View style={styles.day}>
      <Text variant="label" tone="inkMuted" accessibilityRole="header">
        {sportTexts.day(day.localDate, today)}
      </Text>
      <ListGroup>
        {day.entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} onEdit={onEdit} />
        ))}
      </ListGroup>
    </View>
  );
}

function EntryRow({ entry, onEdit }: { entry: SportListEntry; onEdit: (entry: EditedSport) => void }) {
  const imported = entry.origin !== 'manuell';
  return (
    <ListRow
      icon={activityIcons[entry.activityType]}
      title={activityNames[entry.activityType]}
      value={sportTexts.minutes(entry.durationMinutes)}
      subtitle={sportTexts.details(entry)}
      tag={imported ? originNames[entry.origin] : undefined}
      accessibilityLabel={sportTexts.entrySpoken(entry)}
      onPress={imported ? undefined : () => onEdit(editedOf(entry))}
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
  sheet: { gap: space[4] },
});
