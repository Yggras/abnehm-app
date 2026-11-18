import { localDateAfter, weekdayOf, type Instant, type LocalDate } from '@abnehm/contracts/base';
import type { ContributionState } from '@abnehm/contracts/contribution';
import type { UiActionIntent } from '@abnehm/contracts/routes';
import type { EncouragementKey } from '@abnehm/contracts/partner';
import type { DailyGoalState } from '@abnehm/contracts/daily-goals';
import type {
  HeaderReady, MomoCharacterReady, MomoDailyGoalsReady, NutritionBudgetReady, NutritionLogReady,
  MomoCharacterEmptyReason, PartnerCardReady, TopNoticeReady, TrackerEmptyReason, TrackerSportReady, TrackerWaterReady,
  TrackerWeightReady, TrackerQuickAction,
} from '@abnehm/contracts/today';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useClock } from '../clock/clock-context';
import { boxShadow, Button, Card, color, EnergySymbol, Icon, IconButton, Notice, ProgressBar, radius, size, space, Text, useLargeTextLayout, Skeleton, type IconName, type IconTone } from '../design';
import { openTarget } from '../navigation';
import { dataAgeOf, partnerHeadline, partnerTexts, standText } from '../partner';
import { PartnerAvatar } from '../partner/PartnerAvatar';
import { PartnerStage } from '../partner/PartnerStage';
import { isTestArtifact } from '../test-artifact';
import { dailyGoalText } from './daily-goal-texts';
import { MomoAppearanceProvider, MomoFigure } from './MomoFigure';
import { useQuickCommand } from './use-quick-command';
import { thousandthsWithOneDecimal, waitingForPartnerText } from './texts';
import { type TodayRegistry, type TodaySlot, type TodayState, MissingTodayContributionError } from './today-registry';

type Data<S> = S extends ContributionState<infer D, string> ? D : never;
const weekdays = { montag: 'Montag', dienstag: 'Dienstag', mittwoch: 'Mittwoch', donnerstag: 'Donnerstag', freitag: 'Freitag', samstag: 'Samstag', sonntag: 'Sonntag' } as const;
const encouragement: Record<EncouragementKey, string> = {
  du_schaffst_das: 'Du schaffst das! 💪', ich_denk_an_dich: 'Ich denk an dich ❤️',
  stark_heute: 'Stark heute! 🎉', gemeinsam_fuer_momo: 'Gemeinsam für Momo 🐣', stolz_auf_dich: 'Bin stolz auf dich 🌟',
};
/** Name je Steckplatz samt Verbformen für „… lädt“ und „… ist gerade nicht verfügbar“. */
type SlotName = Readonly<{ name: string; loads: string; is: string }>;
const singular = (name: string): SlotName => ({ name, loads: 'lädt', is: 'ist' });
const names: Record<TodaySlot, SlotName> = {
  header: singular('Kopfbereich'), top_notice: singular('Anfeuerung'), 'momo.character': singular('Momo'),
  'momo.daily_goals': { name: 'Tagesziele', loads: 'laden', is: 'sind' },
  'nutrition.budget': singular('Kalorienbudget'), 'nutrition.log': singular('Ernährung'), 'trackers.water': singular('Wasser'),
  'trackers.sport': singular('Sport'), 'trackers.weight': singular('Gewicht'), partner: singular('Partner'),
};
function action(intent: UiActionIntent) { openTarget(intent.target); }
/** Texte der festgelegten Leer-Gründe; ein anderer Grund zeigt den allgemeinen Satz. */
const emptyTexts: Readonly<Record<MomoCharacterEmptyReason | TrackerEmptyReason | 'noch_keine_eintraege', string>> = {
  momo_wartet_im_ei: 'Momo wartet im Ei',
  // Texte nach Spezifikation 4, Abschnitt 7; für die vorschlagende Person steht neutral „Vorschlag gesendet“ davor.
  rollenwahl_offen: 'Momo schlüpft, sobald ihr die Rollen verteilt habt',
  rollenwahl_gesendet: 'Vorschlag gesendet. Momo schlüpft, sobald ihr die Rollen verteilt habt',
  noch_keine_eintraege: 'Noch keine Einträge',
  // Mini-Tracker Wasser und Sport ohne gültige Zielversion (Spezifikation 3, Abschnitt 7).
  ohne_zielversion: 'Noch kein Ziel festgelegt.',
};
const emptyTextOf = (reasonKey: string) => (emptyTexts as Readonly<Record<string, string>>)[reasonKey] ?? 'Hier gibt es noch nichts zu zeigen.';
function staleLabel(dataAsOf: Instant): string {
  const [date, time] = dataAsOf.split('T');
  return `Stand: ${date!.split('-').reverse().join('.')} · ${time!.slice(0, 5)} UTC`;
}

/**
 * Jeder Steckplatz beobachtet ausschließlich seine Quelle; auch ungültige neue Daten fallen am Vertragsrand auf.
 * `retry` meldet den Steckplatz neu an, sodass seine Quelle neu liest.
 */
function useContribution<K extends TodaySlot>(registry: TodayRegistry, key: K): readonly [TodayState<K> | null, () => void] {
  const [snapshot, setSnapshot] = useState<{ registry: TodayRegistry; value: TodayState<K> } | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Im Release ist eine fehlende Quelle ein Integrationsfehler, nicht ein dauerhaftes Lade-Skelett.
  if (!isTestArtifact()) registry.read(key);
  useEffect(() => {
    try { return registry.subscribe(key, (value) => setSnapshot({ registry, value })); }
    catch (error) { if (!(error instanceof MissingTodayContributionError) || !isTestArtifact()) throw error; }
  }, [registry, key, attempt]);
  return [snapshot?.registry === registry ? snapshot.value : null, () => setAttempt((count) => count + 1)] as const;
}

function State<K extends TodaySlot>({ registry, slot, children }: {
  registry: TodayRegistry; slot: K; children: (data: Data<TodayState<K>>) => ReactNode;
}) {
  const [state, retry] = useContribution(registry, slot);
  return <StateView state={state} slot={slot} retry={retry}>{children}</StateView>;
}

/** „Erneut versuchen“: Führt die Aktion zurück auf „Heute“, liest der Steckplatz neu, sonst öffnet sie ihr Ziel. */
function retryWith(intent: UiActionIntent, retry?: () => void) {
  if (intent.target.type === 'today' && retry) retry();
  else action(intent);
}

function StateView<K extends TodaySlot>({ state, slot, retry, children }: {
  state: TodayState<K> | null; slot: K; retry?: () => void; children: (data: Data<TodayState<K>>) => ReactNode;
}) {
  const { name, loads, is } = names[slot];
  if (!state) return <Text tone="inkMuted">{isTestArtifact() ? `Beitrag für ${name} fehlt` : 'Lädt …'}</Text>;
  switch (state.type) {
    case 'loading': return <View style={styles.group}><Text tone="inkMuted">{name} {loads} …</Text><Skeleton width="100%" height={48} /></View>;
    case 'ready': return <>{children(state.data as Data<TodayState<K>>)}</>;
    case 'stale': return <View style={styles.group}><Text tone="inkMuted">{staleLabel(state.dataAsOf)}</Text>{children(state.data as Data<TodayState<K>>)}</View>;
    case 'empty': return <View style={styles.group}>
      <Text>{emptyTextOf(state.reasonKey)}</Text>
      {state.action ? <Button variant="secondary" label="Jetzt öffnen" onPress={() => action(state.action!)} /> : null}
    </View>;
    case 'error': return <View style={styles.group}><Text>{name} {is} gerade nicht verfügbar. {state.retryAction ? 'Versuch es erneut.' : 'Versuch es später noch einmal.'}</Text>{state.retryAction ? <Button label="Erneut versuchen" variant="secondary" onPress={() => retryWith(state.retryAction!, retry)} /> : null}</View>;
  }
}

/** Kopf: Anzeigename kommt aus der Person, lokaler Tag ausschließlich aus der Uhr. */
export function headerFor(displayName: string, localDate: LocalDate): HeaderReady {
  return { displayName, localDate, weekday: weekdayOf(localDate), settingsAction: { actionId: 'header.open_settings', target: { type: 'settings' } } };
}

function Header({ data }: { data: HeaderReady }) {
  return <View style={styles.header}>
    <View style={styles.flex}>
      <Text variant="display" accessibilityRole="header">Hallo, {data.displayName}</Text>
      <Text tone="inkMuted">{weekdays[data.weekday]}, {data.localDate.split('-').reverse().join('.')}</Text>
    </View>
    <IconButton icon="gear" accessibilityLabel="Einstellungen" onPress={() => action(data.settingsAction)} />
  </View>;
}

/** Symbol je Zustand (Design-System, „Bedeutung nie nur über Farbe“); der Text nennt den Zustand immer mit. */
const goalSymbols: Readonly<Record<DailyGoalState, { icon: IconName; tone: IconTone }>> = {
  erfuellt: { icon: 'check', tone: 'success' },
  // Bogen in der Farbe der Fortschrittsbalken der Mini-Tracker.
  teilweise: { icon: 'ringPartial', tone: 'self' },
  offen: { icon: 'circleDashed', tone: 'neutral' },
  tagesende: { icon: 'moon', tone: 'hint' },
};
const trackerStatus = { leer: 'Noch offen', teil: 'Unterwegs', erreicht: 'Ziel erreicht', ueber_ziel: 'Über dem Ziel' } as const;

function MomoCharacter({ character, large, stale }: { character: MomoCharacterReady; large: boolean; stale?: Instant }) {
  return <View style={[styles.momo, large && styles.stack]}>
    <View style={styles.momoStage}>
      <MomoAppearanceProvider appearance={character.appearance}><MomoFigure mood={character.appearance.moodKey ?? 'neugierig'} size={size.momoToday} /></MomoAppearanceProvider>
    </View>
    <View style={styles.flex}>
      {stale ? <Text tone="inkMuted">{staleLabel(stale)}</Text> : null}
      <Text variant="headline" accessibilityRole="header">Momo · Level {character.level}</Text>
      <View style={styles.row}><EnergySymbol /><Text>{character.energy} Energie</Text></View>
      <Text tone="inkMuted">{character.waitingForPartner ? waitingForPartnerText(character.partnerDisplayName) : 'Euer gemeinsamer Fortschritt'}</Text>
      <View accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 200, now: character.ownHalfPercent + character.partnerHalfPercent, text: `Dein Anteil ${character.ownHalfPercent} Prozent, Partneranteil ${character.partnerHalfPercent} Prozent` }} accessibilityLabel={`Gemeinsamer Levelbalken, Level ${character.level}`}>
        <View style={styles.levelbar}>
          <View style={styles.levelHalf}><View style={[styles.ownFill, { width: `${character.ownHalfPercent}%` }]} /></View>
          <View style={styles.levelHalf}><View style={[styles.partnerFill, { width: `${character.partnerHalfPercent}%` }]} /></View>
        </View>
        <Text variant="caption">Du · Partner</Text>
      </View>
      {character.islandNotice && (character.islandNotice.newEvents || character.islandNotice.claimableWishes) ? <Text>Neues auf der Insel</Text> : null}
    </View>
  </View>;
}

/**
 * Die drei Tagesziele nach Platz: Symbol, Name und darunter Wert und Zustand in Worten, alles aus `messageKey`.
 * Der Wert steht in eigener Zeile, damit er auf dem iPhone SE nicht mitten im Wert umbricht; der
 * zugängliche Name nennt die ganze Aussage. Eine Zeile öffnet den Bereich des Bausteins; erfüllte Zeilen
 * liegen auf `success-soft`.
 */
function DailyGoals({ goals, stale }: { goals: MomoDailyGoalsReady; stale?: Instant }) {
  return <View style={styles.goals}>
    {stale ? <Text tone="inkMuted">{staleLabel(stale)}</Text> : null}
    {goals.map((goal) => {
      const text = dailyGoalText(goal.evaluation);
      const symbol = goalSymbols[goal.evaluation.currentState];
      const done = goal.evaluation.currentState === 'erfuellt';
      const subline = [text.detail, text.status].filter((part) => part !== null).join(' · ');
      return <Pressable key={goal.slot} accessibilityRole="button" accessibilityLabel={`${text.title}${text.status ? `, ${text.status}` : ''}. Öffnen`}
        onPress={() => action(goal.action)} style={({ pressed }) => [styles.goal, done && styles.goalDone, pressed && styles.goalPressed]}>
        <Icon name={symbol.icon} tone={symbol.tone} />
        <View style={styles.flex}>
          <Text variant="headline">{text.name}</Text>
          {subline ? <Text variant="label" tone="inkMuted">{subline}</Text> : null}
        </View>
        <Icon name="chevron" tone="inkMuted" />
      </Pressable>;
    })}
  </View>;
}

/**
 * Momo-Bereich: Momo mit Energie und Levelbalken (Spezifikation 4), darunter die drei Tagesziele
 * (Spezifikation 1). Beide Beiträge zeigen ihren Zustand unabhängig voneinander. Vor dem Schlüpfen ersetzt
 * die Laichkugel nur Momo; die Tagesziele bleiben sichtbar, weil sie auch solo Energie bringen
 * (Spezifikation 4, User Story 2).
 */
function MomoSlot({ registry, large }: { registry: TodayRegistry; large: boolean }) {
  const [character, retryCharacter] = useContribution(registry, 'momo.character');
  const [goals, retryGoals] = useContribution(registry, 'momo.daily_goals');
  return <Card>
    {character?.type === 'ready' || character?.type === 'stale'
      ? <MomoCharacter character={character.data as MomoCharacterReady} large={large} stale={character.type === 'stale' ? character.dataAsOf : undefined} />
      : <>
        {character?.type === 'empty' ? <MomoFigure mood="neugierig" size={80} /> : null}
        <StateView slot="momo.character" state={character} retry={retryCharacter}>{() => null}</StateView>
      </>}
    <Text variant="headline" accessibilityRole="header">Deine drei Tagesziele</Text>
    {goals?.type === 'ready' || goals?.type === 'stale'
      ? <DailyGoals goals={goals.data as MomoDailyGoalsReady} stale={goals.type === 'stale' ? goals.dataAsOf : undefined} />
      : <StateView slot="momo.daily_goals" state={goals} retry={retryGoals}>{() => null}</StateView>}
  </Card>;
}

function Nutrition({ budget, log, stale }: { budget: NutritionBudgetReady; log: NutritionLogReady; stale?: Instant }) {
  const remaining = budget.budgetKcal - log.intakeKcal;
  return <Card>
    <Text variant="headline" accessibilityRole="header">Ernährung</Text>
    {stale ? <Text tone="inkMuted">{staleLabel(stale)}</Text> : null}
    <Text variant="numberXl">{Math.abs(remaining).toLocaleString('de-DE')} kcal {remaining < 0 ? 'drüber' : 'übrig'}</Text>
    <Text tone="inkMuted">{log.intakeKcal.toLocaleString('de-DE')} von {budget.budgetKcal.toLocaleString('de-DE')} kcal · {budget.maintenanceReason ? 'Haltemodus' : 'Kalorienbudget'}</Text>
    {budget.notice ? <BudgetNotice notice={budget.notice} /> : null}
    <Button label="Tagesprotokoll öffnen" variant="secondary" onPress={() => action(log.logAction)} />
  </Card>;
}

/**
 * Hinweis der Ernährungskarte (Spezifikation 1, Abschnitte 6–8): neutral formuliert, im Ton `hint`, nie
 * `problem`, immer mit Symbol und Text.
 */
function BudgetNotice({ notice }: { notice: NonNullable<NutritionBudgetReady['notice']> }) {
  const open = { label: 'Ansehen', onPress: () => action(notice.action) };
  return notice.type === 'goal_weight_reached'
    ? <Notice tone="hint" icon="flag" text="Zielgewicht erreicht" action={open} />
    : <Notice tone="hint" icon="info" text={`Vorschlag für dein Kalorienbudget: ${notice.suggestedBudgetKcal.toLocaleString('de-DE')} kcal`} action={open} />;
}

/**
 * Mini-Tracker: eigene, dichte Fläche (radius-md wie im Design-System, Innenabstand space-3), damit
 * drei nebeneinander auch auf dem iPhone SE ohne Umbruch mitten im Wort passen. Die Fläche öffnet die
 * Details, der Knopf navigiert oder bucht als Quick-Command ohne Navigation. Mit `progress` zeigt ein
 * Balken den Fortschritt; er liegt außerhalb der Fläche, damit Screenreader ihn als eigene
 * Fortschrittsanzeige erreichen, und der Status sagt „erreicht“ in Worten.
 */
function Tracker({ label, value, of, status, detail, quick, quickLabel, progress }: {
  label: string; value: string; detail: UiActionIntent; quick: TrackerQuickAction; quickLabel: string;
  /** Stand in Worten; ohne ihn steht nur der Wert da, etwa beim Gewicht ohne Wiegetag im Wochenplan. */
  status?: string;
  /** Bezug des Werts, etwa „von 2,5 l“. */
  of?: string;
  /** Fortschritt samt Name für Screenreader, etwa „Wasser heute“ oder „Sport diese Woche“. */
  progress?: { label: string; value: number; target: number };
}) {
  const runCommand = useQuickCommand();
  const valueText = of ? `${value} ${of}` : value;
  return <View style={styles.tracker}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${valueText}${status ? `, ${status}` : ''}. Details öffnen`}
      style={styles.trackerDetail} onPress={() => action(detail)}>
      <Text variant="headline">{label}</Text>
      <Text variant="numberM">{value}</Text>
      {of ? <Text variant="caption" tone="inkMuted">{of}</Text> : null}
    </Pressable>
    {progress ? <ProgressBar label={progress.label} value={progress.value} target={progress.target} valueText={valueText} legend={false} /> : null}
    {status ? <Text variant="label" tone="inkMuted">{status}</Text> : null}
    <Button compact block dense variant="secondary" label={quickLabel} accessibilityLabel={`${label}: ${quickLabel}`}
      onPress={() => quick.type === 'navigate' ? action(quick.intent) : runCommand(quick)} />
  </View>;
}

/**
 * Partner-Karte (Spezifikation 5, Abschnitt 3): gekoppelt nur Name, grober Tageszielstand und dessen Stand,
 * nie Zusammenfassungen; veraltet neutral „Offline · letzter Stand …“ statt des allgemeinen Stale-Hinweises.
 */
function PartnerSlot({ registry }: { registry: TodayRegistry }) {
  const [state, retry] = useContribution(registry, 'partner');
  if (state?.type === 'stale' && state.data.type === 'coupled') return <Partner data={state.data} stale />;
  return <StateView state={state} slot="partner" retry={retry}>{(data) => <Partner data={data as PartnerCardReady} stale={false} />}</StateView>;
}

/** Der Beitrag meldet sich im Minutentakt neu; so liest die Karte das Alter ihres Stands mit der aktuellen Uhr. */
function Partner({ data, stale }: { data: PartnerCardReady; stale: boolean }) {
  const clock = useClock();
  if (data.type === 'solo') return <Card><Text variant="headline" accessibilityRole="header">{partnerTexts.title}</Text>
    <Text>{partnerTexts.soloToday}</Text>
    <Button label={partnerTexts.invite} variant="secondary" onPress={() => action(data.inviteAction)} />
    <Button label={partnerTexts.redeem} variant="text" onPress={() => action(data.redeemAction)} />
  </Card>;
  const stand = standText(dataAgeOf(data.dataAsOf, clock.read()), stale);
  return <Card><Text variant="headline" accessibilityRole="header">{partnerTexts.title}</Text>
    <View accessible accessibilityLabel={partnerHeadline(data.partnerDisplayName, data.dailyGoalStage, stand)} style={styles.partner}>
      <PartnerAvatar displayName={data.partnerDisplayName} />
      <View style={styles.flex}>
        <Text variant="bodyStrong">{data.partnerDisplayName}</Text>
        <PartnerStage stage={data.dailyGoalStage} />
        <Text variant="caption" tone="inkMuted">{stand.shown}</Text>
      </View>
    </View>
    <Button label={partnerTexts.encourage} variant="secondary" onPress={() => action(data.encourageAction)} />
  </Card>;
}

/**
 * Stand des Wiegetags auf dem Gewichts-Mini-Tracker (Spezifikation 3, Abschnitt 7): am Wiegetag
 * offen oder gewogen, sonst der nächste Wiegetag; der liegt höchstens sieben Tage voraus, sein
 * Wochentag ist deshalb eindeutig. Ohne Wiegetag im Wochenplan steht kein Satz da, nur „Eintragen“.
 */
function weighDayText(status: TrackerWeightReady['status'], today: LocalDate): string | undefined {
  switch (status.type) {
    case 'wiegetag_offen': return 'Heute ist Wiegetag';
    case 'gewogen': return 'Heute gewogen';
    case 'kein_wiegetag':
      if (status.nextWeighDay === null) return undefined;
      return `Nächster Wiegetag: ${status.nextWeighDay === localDateAfter(today, 1) ? 'morgen' : weekdays[weekdayOf(status.nextWeighDay)]}`;
  }
}

/** Feste Slots in visueller Reihenfolge; zusammengesetzte Karten benötigen beide Fachbeiträge. */
export function TodayContent({ registry }: { registry: TodayRegistry }) {
  const large = useLargeTextLayout();
  const clock = useClock();
  return <View style={styles.content}>
    <View testID="today-slot-header"><State registry={registry} slot="header">{(data) => <Header data={data as HeaderReady} />}</State></View>
    <View testID="today-slot-top_notice"><State registry={registry} slot="top_notice">{(value) => {
      const data = value as TopNoticeReady;
      const message = encouragement[data.encouragementKey];
      return <Pressable onPress={() => action(data.action)} accessibilityRole="button"
        accessibilityLabel={`${data.senderDisplayName} feuert dich an: ${message}. Ansehen`} style={styles.encouragement}>
        <Icon name="heart" tone="partner" />
        <Text variant="label" style={styles.flex}>{data.senderDisplayName} feuert dich an · {message}</Text>
        <Icon name="chevron" tone="inkMuted" />
      </Pressable>;
    }}</State></View>
    <View testID="today-slot-momo"><MomoSlot registry={registry} large={large} /></View>
    <View testID="today-slot-nutrition"><CardPair registry={registry} first="nutrition.budget" second="nutrition.log">{(a, b, stale) => <Nutrition budget={a as NutritionBudgetReady} log={b as NutritionLogReady} stale={stale} />}</CardPair></View>
    <View testID="today-slot-trackers" style={[styles.trackers, large && styles.stack]}>
      <View style={!large && styles.trackerColumn}><State registry={registry} slot="trackers.water">{(value) => { const d = value as TrackerWaterReady; return <Tracker label="Wasser" value={`${thousandthsWithOneDecimal(d.countedMl)} l`} of={`von ${thousandthsWithOneDecimal(d.targetMl)} l`} progress={{ label: 'Wasser heute', value: d.countedMl, target: d.targetMl }} status={trackerStatus[d.status]} detail={d.detailAction} quick={d.quickAction} quickLabel="+250 ml" />; }}</State></View>
      <View style={!large && styles.trackerColumn}><State registry={registry} slot="trackers.sport">{(value) => { const d = value as TrackerSportReady; return <Tracker label="Sport" value={`${d.weekMinutes} min`} of={`von ${d.weeklyTargetMinutes} min diese Woche`} progress={{ label: 'Sport diese Woche', value: d.weekMinutes, target: d.weeklyTargetMinutes }} status={trackerStatus[d.status]} detail={d.detailAction} quick={d.quickAction} quickLabel="+ Einheit" />; }}</State></View>
      <View style={!large && styles.trackerColumn}><State registry={registry} slot="trackers.weight">{(value) => { const d = value as TrackerWeightReady; return <Tracker label="Gewicht" value={d.value ? `${thousandthsWithOneDecimal(d.value.weightG)} kg` : 'Noch kein Gewicht'} of={d.value?.type === 'trend' ? 'Trend' : undefined} status={weighDayText(d.status, clock.read().localDate)} detail={d.detailAction} quick={d.quickAction} quickLabel="Eintragen" />; }}</State></View>
    </View>
    <View testID="today-slot-partner"><PartnerSlot registry={registry} /></View>
  </View>;
}

function CardPair<A extends TodaySlot, B extends TodaySlot>({ registry, first, second, children }: {
  registry: TodayRegistry; first: A; second: B; children: (a: Data<TodayState<A>>, b: Data<TodayState<B>>, stale?: Instant) => ReactNode;
}) {
  const [a, retryA] = useContribution(registry, first);
  const [b, retryB] = useContribution(registry, second);
  if ((a?.type === 'ready' || a?.type === 'stale') && (b?.type === 'ready' || b?.type === 'stale')) {
    return <>{children(a.data as Data<TodayState<A>>, b.data as Data<TodayState<B>>, a.type === 'stale' ? a.dataAsOf : b.type === 'stale' ? b.dataAsOf : undefined)}</>;
  }
  return <View style={styles.group}>
    {a?.type === 'ready' || a?.type === 'stale' ? null : <StateView slot={first} state={a} retry={retryA}>{() => null}</StateView>}
    {b?.type === 'ready' || b?.type === 'stale' ? null : <StateView slot={second} state={b} retry={retryB}>{() => null}</StateView>}
  </View>;
}

const styles = StyleSheet.create({
  content: { gap: space[4] }, header: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  partner: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  encouragement: { minHeight: size.touchMin, flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.md, backgroundColor: color.partnerSoft },
  flex: { flex: 1 }, row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  momo: { flexDirection: 'row', gap: space[4], alignItems: 'center' },
  momoStage: { backgroundColor: color.momoStage, borderRadius: size.momoToday / 2 },
  group: { gap: space[2] }, trackers: { flexDirection: 'row', gap: space[2] }, stack: { flexDirection: 'column' },
  trackerColumn: { flex: 1, minWidth: 0 },
  goals: { gap: space[2] },
  goal: { minHeight: size.rowMin, minWidth: size.touchMin, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.md },
  goalDone: { backgroundColor: color.successSoft },
  // Gedrückt wie eine Listenzeile (`ListRow`): Fläche einen Ton dunkler.
  goalPressed: { backgroundColor: color.surfaceSunken },
  levelbar: { flexDirection: 'row', height: size.levelbarHeight, borderRadius: size.levelbarHeight / 2, overflow: 'hidden', backgroundColor: color.surfaceSunken },
  levelHalf: { flex: 1 }, ownFill: { height: '100%', backgroundColor: color.self }, partnerFill: { height: '100%', alignSelf: 'flex-end', backgroundColor: color.partner },
  tracker: { gap: space[2], padding: space[3], borderRadius: radius.md, backgroundColor: color.surfaceCard, boxShadow: boxShadow.card },
  trackerDetail: { minHeight: size.touchMin, minWidth: size.touchMin, gap: space[1] },
});
