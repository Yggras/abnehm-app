import { useState } from 'react';

import type { Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import { activityTypes, type ImportOrigin } from '@abnehm/contracts/tracker-rules';
import type { ActivityType } from '@abnehm/contracts/trackers';

import { Button, ListGroup, ListRow, Notice, Sheet } from '../design';
import { activityNames } from '../shell/texts';
import { useUndoableMessage, type UndoableOutcome } from '../shell/use-undoable-message';
import { activityIcons } from './activity-icons';
import { dayText, originNames, sourceAppText, timeText } from './entry-texts';
import { SheetLayout } from './SheetLayout';
import type { SportListEntry } from './sport-week';
import { kcalText, sportTexts } from './sport-texts';
import type { Trackers } from './trackers';
import type { WeightHistoryEntry } from './weight-detail';
import { kgText, weightTexts } from './weight-texts';

// Schreibgeschütztes Sheet eines importierten Trainings oder Gewichts (Spezifikation 3, Abschnitt 4; #186).
// Hauptaufgabe: verstehen, woher ein Eintrag kommt, und eine Fehlaufnahme ausblenden. Es zeigt die Werte,
// Herkunft (Apple Health bzw. Health Connect) und Quell-App, dazu den Hinweis, dass die Werte in der
// Quell-App geändert werden. Bearbeiten lässt sich nichts; die Aktionen sind „Aktivitätsart ändern“ (nur
// Training) und „Ausblenden“. Beide schließen das Sheet ohne Bestätigungsdialog, und der Meldungs-Host zeigt
// „52 min Radfahren ausgeblendet · Rückgängig“ bzw. „Jetzt Krafttraining statt Radfahren · Rückgängig“. Die
// Auswahl der Art steht im selben Sheet, weil Sheets nicht in Sheets stehen (Design-System). Das Sheet eines
// Gewichts hat nur wenige Zeilen und nimmt die Höhe seines Inhalts; das eines Trainings mit der Liste der
// acht Arten die volle Höhe (Impeccable-Kritik, #186).

/** Ein importierter Eintrag aus der Wochenübersicht des Sports oder der Messliste des Gewichts. */
export type ImportedEntry = Readonly<{ type: 'training'; entry: SportListEntry }> | Readonly<{ type: 'gewicht'; entry: WeightHistoryEntry }>;

export type ImportedSheetTrackers = Pick<Trackers, 'hideImported' | 'overrideActivityType' | 'undo' | 'expire'>;

export type ImportedEntrySheetProps = {
  /** Der gezeigte Import; `null` schließt das Sheet. */
  imported: ImportedEntry | null;
  /** Heute; der Tag des Eintrags steht relativ dazu, etwa „heute“ oder „gestern“. */
  today: LocalDate;
  trackers: ImportedSheetTrackers;
  /** Weggewischt, ausgeblendet oder umbenannt; der Aufrufer setzt `imported` auf `null`. */
  onClose: () => void;
};

export const importedTexts = {
  sourceHint: 'Werte änderst du in der Quell-App.',
  changeActivity: 'Aktivitätsart ändern',
  hide: 'Ausblenden',
  back: 'Zurück',
  activity: 'Art',
  duration: 'Dauer',
  start: 'Beginn',
  calories: 'Kalorien',
  caloriesHint: 'wird nur angezeigt',
  weight: 'Gewicht',
  measured: 'Gemessen',
  origin: 'Herkunft',
  sourceApp: 'Quell-App',
  /** Titel, etwa „Training aus Apple Health“. */
  title: (imported: ImportedEntry) => `${imported.type === 'training' ? 'Training' : 'Gewicht'} aus ${originNames[imported.entry.origin as ImportOrigin]}`,
  /** Unter der Art, wenn die Person sie geändert hat, etwa „erkannt als Radfahren“. */
  recognized: (activityType: ActivityType) => `erkannt als ${activityNames[activityType]}`,
  /** Zugänglicher Name von „Ausblenden“, etwa „52 min Radfahren ausblenden“. */
  hideSpoken: (imported: ImportedEntry) =>
    imported.type === 'training'
      ? `${imported.entry.durationMinutes} min ${activityNames[imported.entry.activityType]} ausblenden`
      : `${kgText(imported.entry.weightG)} ausblenden`,
} as const;

export function ImportedEntrySheet({ imported, today, trackers, onClose }: ImportedEntrySheetProps) {
  return (
    <Sheet visible={imported !== null} onClose={onClose} height={imported?.type === 'gewicht' ? 'content' : 'full'}>
      {imported !== null ? <ImportedEntryContent key={imported.entry.id} imported={imported} today={today} trackers={trackers} onDone={onClose} /> : null}
    </Sheet>
  );
}

type ImportedEntryContentProps = Omit<ImportedEntrySheetProps, 'imported' | 'onClose'> & Readonly<{ imported: ImportedEntry; onDone: () => void }>;

function ImportedEntryContent({ imported, today, trackers, onDone }: ImportedEntryContentProps) {
  const message = useUndoableMessage();
  const [choosing, setChoosing] = useState(false);

  /** Führt den Befehl aus, schließt und zeigt die Meldung mit „Rückgängig“. */
  const run = (command: () => UndoableOutcome & Readonly<{ undoToken: string }>) => {
    let outcome;
    try {
      outcome = command();
    } catch (error) {
      // Etwa weil die Quelle den Eintrag inzwischen gelöscht hat: „Das hat nicht geklappt …“.
      return message.failed(error);
    }
    const { undoToken } = outcome;
    onDone();
    message.show(outcome, { run: () => trackers.undo(undoToken), expire: () => trackers.expire(undoToken) });
  };

  if (choosing && imported.type === 'training') {
    const { entry } = imported;
    const choose = (activityType: ActivityType) => {
      if (activityType === entry.activityType) return setChoosing(false);
      run(() => trackers.overrideActivityType(entry.id, activityType));
    };
    return (
      <SheetLayout title={importedTexts.changeActivity} actions={<Button variant="text" label={importedTexts.back} block onPress={() => setChoosing(false)} />}>
        {entry.recognizedActivityType !== null ? <Notice tone="neutral" text={sentence(importedTexts.recognized(entry.recognizedActivityType))} /> : null}
        <ListGroup>
          {activityTypes.map((type) => (
            <ListRow
              key={type}
              icon={activityIcons[type]}
              title={activityNames[type]}
              accessibilityLabel={activityNames[type]}
              selected={entry.activityType === type}
              onPress={() => choose(type)}
            />
          ))}
        </ListGroup>
      </SheetLayout>
    );
  }

  const actions = (
    <>
      {imported.type === 'training' ? (
        <Button variant="secondary" icon="pencil" label={importedTexts.changeActivity} block onPress={() => setChoosing(true)} />
      ) : null}
      <Button
        variant="secondary"
        icon="eye"
        label={importedTexts.hide}
        accessibilityLabel={importedTexts.hideSpoken(imported)}
        block
        onPress={() => run(() => trackers.hideImported(imported.entry.id))}
      />
    </>
  );
  const sourceApp = sourceAppText(imported.entry.sourceAppId, imported.entry.sourceAppName);
  return (
    <SheetLayout title={importedTexts.title(imported)} actions={actions} fit={imported.type === 'gewicht'}>
      <ListGroup>{imported.type === 'training' ? <TrainingValues entry={imported.entry} today={today} /> : <WeightValues entry={imported.entry} today={today} />}</ListGroup>
      <ListGroup>
        <ListRow title={importedTexts.origin} value={originNames[imported.entry.origin as ImportOrigin]} />
        {sourceApp !== null ? <ListRow title={importedTexts.sourceApp} value={sourceApp} /> : null}
      </ListGroup>
      <Notice tone="hint" text={importedTexts.sourceHint} />
    </SheetLayout>
  );
}

function TrainingValues({ entry, today }: { entry: SportListEntry; today: LocalDate }) {
  const overridden = entry.recognizedActivityType !== null && entry.recognizedActivityType !== entry.activityType;
  return (
    <>
      <ListRow
        icon={activityIcons[entry.activityType]}
        title={importedTexts.activity}
        value={activityNames[entry.activityType]}
        subtitle={overridden ? importedTexts.recognized(entry.recognizedActivityType!) : undefined}
      />
      <ListRow title={importedTexts.duration} value={sportTexts.minutes(entry.durationMinutes)} />
      <ListRow title={importedTexts.start} value={when(entry.startedAt, entry.timeZone, entry.localDate, today)} />
      {entry.activeMilliKcal !== null ? (
        <ListRow
          title={importedTexts.calories}
          subtitle={importedTexts.caloriesHint}
          value={kcalText(entry.activeMilliKcal, false)}
          accessibilityLabel={`${importedTexts.calories}, ${kcalText(entry.activeMilliKcal, true)}, ${importedTexts.caloriesHint}`}
        />
      ) : null}
    </>
  );
}

function WeightValues({ entry, today }: { entry: WeightHistoryEntry; today: LocalDate }) {
  return (
    <>
      <ListRow title={importedTexts.weight} value={kgText(entry.weightG)} subtitle={entry.isDayWeight ? weightTexts.dayWeightMark : undefined} />
      <ListRow title={importedTexts.measured} value={when(entry.measuredAt, entry.timeZone, entry.localDate, today)} />
    </>
  );
}

/** Tag und Uhrzeit, etwa „heute · 07:00“ oder „Mo, 12.10. · 18:30“. */
function when(instant: Instant, timeZone: TimeZone, localDate: LocalDate, today: LocalDate): string {
  return `${dayText(localDate, today)} · ${timeText(instant, timeZone)}`;
}

/** Erster Buchstabe groß, als eigener Satz im Hinweis. */
function sentence(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
