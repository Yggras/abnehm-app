import { instantAtWallClock, type Clock } from '@abnehm/clock';
import { AreaKey, EntityId, localDateAfter, type Instant, type LocalDate } from '@abnehm/contracts/base';
import type { CheckInMoment, CheckInReason, DailyGoalCause } from '@abnehm/contracts/daily-goals';
import { notificationTexts } from '@abnehm/contracts/notification-texts';
import { checkInTrackerField, wallClockMinutes, type CheckInTopic, type NotificationSettingUpsert } from '@abnehm/contracts/notifications';
import type { IslandCheckInHintReader, PlanReader } from '@abnehm/contracts/ports';
import type { RouteTarget } from '@abnehm/contracts/routes';
import { isSportDay, isWeighDay } from '@abnehm/contracts/tracker-rules';

import type { DailyGoalRegistry, ValidPlan } from '../daily-goals';
import type { LocalDatabase } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import { readNotificationSetting } from './notification-setting';
import type { LocalNotification, NotificationPort } from './port';

// Check-in-Planer (Spezifikation 5, Abschnitt 7; #135): berechnet bei jedem Aufruf den vollständigen
// Sollzustand der lokal geplanten Tages-Check-ins und gleicht ihn über den Mitteilungs-Port ab. Quellen
// sind die Benachrichtigungseinstellung, der `PlanReader`, `evaluateCheckIn` je aktivem Tracker, der
// optionale `IslandCheckInHintReader`, die Uhr samt Gerätezone und die Erlaubnis des Ports. Wann neu
// geplant wird, entscheiden die Auslöser (#137); weil jeder Abgleich alles berechnet, ändert er nur, was
// sich tatsächlich unterscheidet, etwa genau die Tage einer Wochenplanänderung.

/** Heute plus die folgenden 13 lokalen Tage, je Mittag und Abend: höchstens 28 Check-ins. */
const windowDays = 14;
const idPrefix = 'checkin:';

/** Was einen Abgleich angestoßen hat (#137); der Planer berechnet unabhängig davon immer den ganzen Sollzustand. */
export type CheckInRescheduleCause = DailyGoalCause | 'app_start' | 'vordergrund' | 'hintergrund' | 'tageswechsel' | 'einstellung' | 'erlaubnis' | 'zeitzone';

/** Was ein Abgleich am Port geändert hat; ein ersetzter Check-in steht in beiden Listen. */
export type CheckInReconciliation = Readonly<{ scheduled: readonly string[]; cancelled: readonly string[] }>;

export type CheckInPlanner = Readonly<{
  /** Plant die Check-ins des Fensters neu: fehlende planen, veraltete abbrechen, geänderte ersetzen. */
  reschedule(cause: CheckInRescheduleCause): Promise<CheckInReconciliation>;
  /** Bricht alle Check-ins ab, etwa beim Abmelden oder nach einem `401`. */
  clearAll(): Promise<CheckInReconciliation>;
}>;

export type CheckInPlannerOptions = Readonly<{
  database: Pick<LocalDatabase, 'read'>;
  registry: Pick<DailyGoalRegistry, 'evaluateCheckIn'>;
  planReader: PlanReader;
  /** Ohne ihn entfällt der Insel-Zusatz. */
  islandCheckInHintReader: IslandCheckInHintReader | null;
  clock: Clock;
  port: NotificationPort;
  /** Ein Tracker, dessen Check-in den Vertrag verletzt; er zählt dann als nicht hinterher. */
  onError(error: unknown): void;
}>;

/** Deterministischer Identifikator `checkin:<lokaler Tag>:<mittag|abend>`. */
export function checkInId(localDate: LocalDate, moment: CheckInMoment): string {
  return `${idPrefix}${localDate}:${moment}`;
}

const isCheckInId = (id: string) => id.startsWith(idPrefix);

/** Ein Tipp öffnet „Heute“ (Spezifikation 5, Abschnitt 7). */
const target: RouteTarget = { type: 'today' };

export function createCheckInPlanner(options: CheckInPlannerOptions): CheckInPlanner {
  const { port } = options;
  // Abgleiche laufen nacheinander, damit sich Listen und Änderungen zweier Läufe nicht überkreuzen.
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = (run: () => Promise<CheckInReconciliation>) => {
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  };

  return {
    reschedule: () => serialized(async () => reconcile(port, await desiredCheckIns(options))),
    clearAll: () => serialized(() => reconcile(port, [])),
  };
}

async function reconcile(port: NotificationPort, desired: readonly LocalNotification[]): Promise<CheckInReconciliation> {
  const existing = new Map((await port.scheduled()).filter((notification) => isCheckInId(notification.id)).map((notification) => [notification.id, notification]));
  const wanted = new Set(desired.map((notification) => notification.id));
  const scheduled: string[] = [];
  const cancelled: string[] = [];

  for (const id of [...existing.keys()].sort()) {
    if (wanted.has(id)) continue;
    await port.cancel(id);
    cancelled.push(id);
  }
  for (const notification of desired) {
    const current = existing.get(notification.id);
    if (current !== undefined && current.data.version === notification.data.version) continue;
    // Abbrechen und neu planen, statt sich auf das Ersetzen gleicher Identifikatoren je Plattform zu verlassen.
    if (current !== undefined) {
      await port.cancel(notification.id);
      cancelled.push(notification.id);
    }
    await port.schedule(notification);
    scheduled.push(notification.id);
  }
  return { scheduled, cancelled };
}

type Moment = Readonly<{ moment: CheckInMoment; minutes: number }>;

function enabledMoments(setting: NotificationSettingUpsert): Moment[] {
  return [
    ...(setting.middayEnabled ? [{ moment: 'mittag' as const, minutes: wallClockMinutes(setting.middayTime) }] : []),
    ...(setting.eveningEnabled ? [{ moment: 'abend' as const, minutes: wallClockMinutes(setting.eveningTime) }] : []),
  ];
}

/** Der Sollzustand: ohne Erlaubnis, Person, Zeitpunkt oder Tracker leer. */
async function desiredCheckIns(options: CheckInPlannerOptions): Promise<LocalNotification[]> {
  const { database, planReader, islandCheckInHintReader, clock, port } = options;
  if ((await port.permission()) !== 'granted') return [];

  const reading = clock.read();
  const { own, setting } = database.read((tx) => ({ own: readOwnPerson(tx), setting: readNotificationSetting(tx) }));
  if (own === undefined) return [];
  const personId = EntityId.parse(own.id);
  const moments = enabledMoments(setting);
  const trackers = AreaKey.options.filter((tracker) => setting[checkInTrackerField(tracker)]);
  if (moments.length === 0 || trackers.length === 0) return [];

  const days = Array.from({ length: windowDays }, (_, offset) => localDateAfter(reading.localDate, offset));
  const plans = await Promise.all(days.map((day) => planReader.effectivePlan(personId, day)));
  const hint = (await islandCheckInHintReader?.hint(personId, reading.instant)) ?? null;

  const notifications: LocalNotification[] = [];
  for (const plan of plans) {
    if (plan.type !== 'gueltig') continue;
    for (const { moment, minutes } of moments) {
      const at = instantAtWallClock(plan.localDate, minutes, reading.timeZone);
      if (Date.parse(at) <= Date.parse(reading.instant)) continue;
      const isToday = plan.localDate === reading.localDate;
      const topics = isToday ? todayTopics(options, personId, plan, moment, trackers) : futureTopics(plan, moment, trackers);
      if (topics.length === 0) continue;
      notifications.push(checkIn(plan.localDate, moment, at, {
        moment,
        topics,
        islandEventKind: isToday ? (hint?.eventKind ?? null) : null,
      }));
    }
  }
  return notifications;
}

/** Heute: die Tracker, die laut `evaluateCheckIn` mit dem jetzigen Datenstand hinterherhinken. */
function todayTopics(
  { database, registry, onError }: CheckInPlannerOptions,
  personId: EntityId,
  plan: ValidPlan,
  moment: CheckInMoment,
  trackers: readonly AreaKey[],
): CheckInTopic[] {
  return database.read((tx) =>
    trackers.flatMap((tracker) => {
      const result = registry.evaluateCheckIn(tx, { tracker, personId, localDate: plan.localDate, moment, plan });
      if (result.type === 'contract_error') {
        onError(new Error(`Tages-Check-in ${tracker}: ${result.error.code}`));
        return [];
      }
      return result.behind ? [topicOf(result.reason)] : [];
    }),
  );
}

/** Künftige Tage ohne aktuelle Werte: Ernährung und Wasser immer, Sport nur abends am Sporttag, Gewicht am Wiegetag. */
function futureTopics(plan: ValidPlan, moment: CheckInMoment, trackers: readonly AreaKey[]): CheckInTopic[] {
  const { bausteine } = plan.weeklyPlanDay;
  return trackers.flatMap((tracker): CheckInTopic[] => {
    switch (tracker) {
      case 'ernaehrung':
        return [{ type: 'ernaehrung' }];
      case 'wasser':
        return [{ type: 'wasser', progress: null }];
      case 'sport':
        return moment === 'abend' && isSportDay(bausteine) ? [{ type: 'sport' }] : [];
      case 'gewicht':
        return isWeighDay(bausteine) ? [{ type: 'gewicht' }] : [];
    }
  });
}

/** Werte zeigt nur das Wasser, und nur heute. */
function topicOf(reason: CheckInReason): CheckInTopic {
  switch (reason.type) {
    case 'wasser':
      return { type: 'wasser', progress: { countedMl: reason.countedMl, targetMl: reason.targetMl } };
    case 'ernaehrung':
    case 'sport':
    case 'gewicht':
      return { type: reason.type };
  }
}

function checkIn(localDate: LocalDate, moment: CheckInMoment, at: Instant, values: Parameters<typeof notificationTexts.render<'tages_checkin'>>[1]): LocalNotification {
  const { title, body } = notificationTexts.render('tages_checkin', values);
  return {
    id: checkInId(localDate, moment),
    at,
    channel: 'checkins',
    title,
    body,
    // `version` erkennt beim Abgleich einen geänderten Check-in; der Port meldet geplante nur mit `data`.
    data: { target, version: JSON.stringify([at, title, body]) },
  };
}
