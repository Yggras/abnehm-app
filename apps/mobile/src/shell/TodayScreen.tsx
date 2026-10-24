import { weekdayOf, type Instant, type LocalDate } from '@abnehm/contracts/base';
import type { ContributionState } from '@abnehm/contracts/contribution';
import type { UiActionIntent } from '@abnehm/contracts/routes';
import type { EncouragementKey } from '@abnehm/contracts/partner';
import type {
  HeaderReady, MomoCharacterReady, MomoDailyGoalsReady, NutritionBudgetReady, NutritionLogReady,
  PartnerCardReady, TopNoticeReady, TrackerSportReady, TrackerWaterReady, TrackerWeightReady, TrackerQuickAction,
} from '@abnehm/contracts/today';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, color, EnergySymbol, Icon, IconButton, radius, size, space, Text, useLargeTextLayout, Skeleton } from '../design';
import { openTarget } from '../navigation';
import { isTestArtifact } from '../test-artifact';
import { MomoAppearanceProvider, MomoFigure } from './MomoFigure';
import { useQuickCommand } from './use-quick-command';
import { type TodayRegistry, type TodaySlot, type TodayState, MissingTodayContributionError } from './today-registry';

type Data<S> = S extends ContributionState<infer D, string> ? D : never;
const weekdays = { montag: 'Montag', dienstag: 'Dienstag', mittwoch: 'Mittwoch', donnerstag: 'Donnerstag', freitag: 'Freitag', samstag: 'Samstag', sonntag: 'Sonntag' } as const;
const encouragement: Record<EncouragementKey, string> = {
  du_schaffst_das: 'Du schaffst das! 💪', ich_denk_an_dich: 'Ich denk an dich ❤️',
  stark_heute: 'Stark heute! 🎉', gemeinsam_fuer_momo: 'Gemeinsam für Momo 🐣', stolz_auf_dich: 'Bin stolz auf dich 🌟',
};
const names: Record<TodaySlot, string> = {
  header: 'Kopfbereich', top_notice: 'Anfeuerung', 'momo.character': 'Momo', 'momo.daily_goals': 'Tagesziele',
  'nutrition.budget': 'Kalorienbudget', 'nutrition.log': 'Ernährung', 'trackers.water': 'Wasser',
  'trackers.sport': 'Sport', 'trackers.weight': 'Gewicht', partner: 'Partner',
};
function action(intent: UiActionIntent) { openTarget(intent.target); }
function staleLabel(dataAsOf: Instant): string {
  const [date, time] = dataAsOf.split('T');
  return `Stand: ${date!.split('-').reverse().join('.')} · ${time!.slice(0, 5)} UTC`;
}

/** Jeder Steckplatz beobachtet ausschließlich seine Quelle; auch ungültige neue Daten fallen am Vertragsrand auf. */
function useContribution<K extends TodaySlot>(registry: TodayRegistry, key: K): TodayState<K> | null {
  const [snapshot, setSnapshot] = useState<{ registry: TodayRegistry; value: TodayState<K> } | null>(null);
  // Im Release ist eine fehlende Quelle ein Integrationsfehler, nicht ein dauerhaftes Lade-Skelett.
  if (!isTestArtifact()) registry.read(key);
  useEffect(() => {
    try { return registry.subscribe(key, (value) => setSnapshot({ registry, value })); }
    catch (error) { if (!(error instanceof MissingTodayContributionError) || !isTestArtifact()) throw error; }
  }, [registry, key]);
  return snapshot?.registry === registry ? snapshot.value : null;
}

function State<K extends TodaySlot>({ registry, slot, children }: {
  registry: TodayRegistry; slot: K; children: (data: Data<TodayState<K>>) => ReactNode;
}) {
  const state = useContribution(registry, slot);
  return <StateView state={state} slot={slot}>{children}</StateView>;
}

function StateView<K extends TodaySlot>({ state, slot, children }: {
  state: TodayState<K> | null; slot: K; children: (data: Data<TodayState<K>>) => ReactNode;
}) {
  if (!state) return <Text tone="inkMuted">{isTestArtifact() ? `Beitrag für ${names[slot]} fehlt` : 'Lädt …'}</Text>;
  switch (state.type) {
    case 'loading': return <View style={styles.group}><Text tone="inkMuted">{names[slot]} lädt …</Text><Skeleton width="100%" height={48} /></View>;
    case 'ready': return <>{children(state.data as Data<TodayState<K>>)}</>;
    case 'stale': return <View style={styles.group}><Text tone="inkMuted">{staleLabel(state.dataAsOf)}</Text>{children(state.data as Data<TodayState<K>>)}</View>;
    case 'empty': return <View style={styles.group}>
      <Text>{state.reasonKey === 'momo_wartet_im_ei' ? 'Momo wartet im Ei' : state.reasonKey === 'rollenwahl_offen' ? 'Momo wartet auf eure Rollenwahl' : state.reasonKey === 'noch_keine_eintraege' ? 'Noch keine Einträge' : 'Hier gibt es noch nichts zu zeigen.'}</Text>
      {state.action ? <Button variant="secondary" label="Jetzt öffnen" onPress={() => action(state.action!)} /> : null}
    </View>;
    case 'error': return <View style={styles.group}><Text>{names[slot]} ist gerade nicht verfügbar. {state.retryAction ? 'Versuch es erneut.' : 'Versuch es später noch einmal.'}</Text>{state.retryAction ? <Button label="Erneut versuchen" variant="secondary" onPress={() => action(state.retryAction!)} /> : null}</View>;
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

const goalNames = {
  ernaehrung_erfasst: 'Ernährung erfasst', im_kalorienbudget: 'Im Kalorienbudget',
  wasserziel: 'Wasserziel', sporteinheit: 'Sporteinheit', gewogen: 'Gewogen',
} as const;
const goalStatus = { offen: 'Noch offen', teilweise: 'Unterwegs', erfuellt: 'Erreicht', tagesende: 'Am Tagesende' } as const;
const trackerStatus = { leer: 'Noch offen', teil: 'Unterwegs', erreicht: 'Ziel erreicht', ueber_ziel: 'Über dem Ziel' } as const;

function MomoArea({ character, goals, large, stale }: { character: MomoCharacterReady; goals: MomoDailyGoalsReady; large: boolean; stale?: Instant }) {
  return <Card><View style={[styles.momo, large && styles.stack]}>
    <View style={styles.momoStage}>
      <MomoAppearanceProvider appearance={character.appearance}><MomoFigure mood={character.appearance.moodKey ?? 'neugierig'} size={size.momoToday} /></MomoAppearanceProvider>
    </View>
    <View style={styles.flex}>
      {stale ? <Text tone="inkMuted">{staleLabel(stale)}</Text> : null}
      <Text variant="headline" accessibilityRole="header">Momo · Level {character.level}</Text>
      <View style={styles.row}><EnergySymbol /><Text>{character.energy} Energie</Text></View>
      <Text tone="inkMuted">{character.waitingForPartner ? 'Dein Teil ist voll. Momo wartet auf euch beide.' : 'Euer gemeinsamer Fortschritt'}</Text>
      <View accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 200, now: character.ownHalfPercent + character.partnerHalfPercent, text: `Dein Anteil ${character.ownHalfPercent} Prozent, Partneranteil ${character.partnerHalfPercent} Prozent` }} accessibilityLabel={`Gemeinsamer Levelbalken, Level ${character.level}`}>
        <View style={styles.levelbar}>
          <View style={styles.levelHalf}><View style={[styles.ownFill, { width: `${character.ownHalfPercent}%` }]} /></View>
          <View style={styles.levelHalf}><View style={[styles.partnerFill, { width: `${character.partnerHalfPercent}%` }]} /></View>
        </View>
        <Text variant="caption">Du · Partner</Text>
      </View>
      {character.islandNotice && (character.islandNotice.newEvents || character.islandNotice.claimableWishes) ? <Text>Neues auf der Insel</Text> : null}
    </View>
  </View>
  <Text variant="headline">Deine drei Tagesziele</Text>
  {goals.map((goal) => <Button key={goal.slot} compact variant="text" block label={`${goal.slot}. ${goalNames[goal.evaluation.progress.type]} · ${goalStatus[goal.evaluation.currentState]}`} onPress={() => action(goal.action)} />)}
  </Card>;
}

function Nutrition({ budget, log, stale }: { budget: NutritionBudgetReady; log: NutritionLogReady; stale?: Instant }) {
  const remaining = budget.budgetKcal - log.intakeKcal;
  return <Card>
    <Text variant="headline" accessibilityRole="header">Ernährung</Text>
    {stale ? <Text tone="inkMuted">{staleLabel(stale)}</Text> : null}
    <Text variant="numberXl">{Math.abs(remaining).toLocaleString('de-DE')} kcal {remaining < 0 ? 'drüber' : 'übrig'}</Text>
    <Text tone="inkMuted">{log.intakeKcal.toLocaleString('de-DE')} von {budget.budgetKcal.toLocaleString('de-DE')} kcal · {budget.maintenanceReason ? 'Haltemodus' : 'Kalorienbudget'}</Text>
    {budget.notice ? <View style={styles.row}>
      <Icon name="star" tone="hint" />
      <View style={styles.flex}><Text>{budget.notice.type === 'goal_weight_reached' ? 'Zielgewicht erreicht' : `Budgetvorschlag: ${budget.notice.suggestedBudgetKcal} kcal`}</Text></View>
      <Button label="Ansehen" variant="text" compact onPress={() => action(budget.notice!.action)} />
    </View> : null}
    <Button label="Tagesprotokoll öffnen" variant="secondary" onPress={() => action(log.logAction)} />
  </Card>;
}

function Tracker({ label, value, status, detail, quick, quickLabel }: {
  label: string; value: string; status: string; detail: UiActionIntent; quick: TrackerQuickAction; quickLabel: string;
}) {
  const runCommand = useQuickCommand();
  return <Card>
    <View style={styles.tracker}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}, ${status}. Details öffnen`}
        style={styles.trackerDetail} onPress={() => action(detail)}>
        <Text variant="headline">{label}</Text><Text variant="numberM">{value}</Text><Text tone="inkMuted">{status}</Text>
      </Pressable>
      <Button compact variant="secondary" label={quickLabel} accessibilityLabel={`${label}: ${quickLabel}`}
        onPress={() => quick.type === 'navigate' ? action(quick.intent) : runCommand(quick)} />
    </View>
  </Card>;
}

function Partner({ data }: { data: PartnerCardReady }) {
  return <Card><Text variant="headline" accessibilityRole="header">Wir</Text>
    {data.type === 'solo' ? <>
      <Text>Momo wartet im Ei. Lade deinen Partner ein, wenn ihr gemeinsam starten möchtet.</Text>
      <Button label="Partner einladen" variant="secondary" onPress={() => action(data.inviteAction)} />
      <Button label="Code eingeben" variant="text" onPress={() => action(data.redeemAction)} />
    </> : <>
      <Text>{data.partnerDisplayName} · {({ noch_nichts: 'Startet heute', unterwegs: 'Ist unterwegs', fast_geschafft: 'Fast geschafft', geschafft: 'Heute geschafft' } as const)[data.dailyGoalStage]}</Text>
      <Button label="Anfeuern" variant="secondary" onPress={() => action(data.encourageAction)} />
    </>}
  </Card>;
}

/** Feste Slots in visueller Reihenfolge; zusammengesetzte Karten benötigen beide Fachbeiträge. */
export function TodayContent({ registry }: { registry: TodayRegistry }) {
  const large = useLargeTextLayout();
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
    <View testID="today-slot-momo"><CardPair registry={registry} first="momo.character" second="momo.daily_goals">{(a, b, stale) => <MomoArea character={a as MomoCharacterReady} goals={b as MomoDailyGoalsReady} large={large} stale={stale} />}</CardPair></View>
    <View testID="today-slot-nutrition"><CardPair registry={registry} first="nutrition.budget" second="nutrition.log">{(a, b, stale) => <Nutrition budget={a as NutritionBudgetReady} log={b as NutritionLogReady} stale={stale} />}</CardPair></View>
    <View testID="today-slot-trackers" style={[styles.trackers, large && styles.stack]}>
      <View style={!large && styles.trackerColumn}><State registry={registry} slot="trackers.water">{(value) => { const d = value as TrackerWaterReady; return <Tracker label="Wasser" value={`${d.countedMl.toLocaleString('de-DE')} ml / ${d.targetMl.toLocaleString('de-DE')} ml`} status={trackerStatus[d.status]} detail={d.detailAction} quick={d.quickAction} quickLabel="+250 ml" />; }}</State></View>
      <View style={!large && styles.trackerColumn}><State registry={registry} slot="trackers.sport">{(value) => { const d = value as TrackerSportReady; return <Tracker label="Sport" value={`${d.weekMinutes} / ${d.weeklyTargetMinutes} min`} status={trackerStatus[d.status]} detail={d.detailAction} quick={d.quickAction} quickLabel="+ Einheit" />; }}</State></View>
      <View style={!large && styles.trackerColumn}><State registry={registry} slot="trackers.weight">{(value) => { const d = value as TrackerWeightReady; return <Tracker label="Gewicht" value={d.value ? `${(d.value.weightG / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg` : 'Noch kein Gewicht'} status={d.status.type === 'wiegetag_offen' ? 'Wiegetag offen' : d.status.type === 'gewogen' ? 'Gewogen' : 'Nächster Wiegetag'} detail={d.detailAction} quick={d.quickAction} quickLabel="Eintragen" />; }}</State></View>
    </View>
    <View testID="today-slot-partner"><State registry={registry} slot="partner">{(data) => <Partner data={data as PartnerCardReady} />}</State></View>
  </View>;
}

function CardPair<A extends TodaySlot, B extends TodaySlot>({ registry, first, second, children }: {
  registry: TodayRegistry; first: A; second: B; children: (a: Data<TodayState<A>>, b: Data<TodayState<B>>, stale?: Instant) => ReactNode;
}) {
  const a = useContribution(registry, first);
  const b = useContribution(registry, second);
  if (first === 'momo.character' && a?.type === 'empty') {
    return <Card><MomoFigure mood="neugierig" size={80} /><StateView slot={first} state={a}>{() => null}</StateView></Card>;
  }
  if ((a?.type === 'ready' || a?.type === 'stale') && (b?.type === 'ready' || b?.type === 'stale')) {
    return <>{children(a.data as Data<TodayState<A>>, b.data as Data<TodayState<B>>, a.type === 'stale' ? a.dataAsOf : b.type === 'stale' ? b.dataAsOf : undefined)}</>;
  }
  return <View style={styles.group}>
    {a?.type === 'ready' || a?.type === 'stale' ? null : <StateView slot={first} state={a}>{() => null}</StateView>}
    {b?.type === 'ready' || b?.type === 'stale' ? null : <StateView slot={second} state={b}>{() => null}</StateView>}
  </View>;
}

const styles = StyleSheet.create({
  content: { gap: space[4] }, header: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  encouragement: { minHeight: size.touchMin, flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.md, backgroundColor: color.partnerSoft },
  flex: { flex: 1 }, row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  momo: { flexDirection: 'row', gap: space[4], alignItems: 'center' },
  momoStage: { backgroundColor: color.momoStage, borderRadius: size.momoToday / 2 },
  group: { gap: space[2] }, trackers: { flexDirection: 'row', gap: space[2] }, stack: { flexDirection: 'column' },
  trackerColumn: { flex: 1, minWidth: 0 },
  levelbar: { flexDirection: 'row', height: size.levelbarHeight, borderRadius: size.levelbarHeight / 2, overflow: 'hidden', backgroundColor: color.surfaceSunken },
  levelHalf: { flex: 1 }, ownFill: { height: '100%', backgroundColor: color.self }, partnerFill: { height: '100%', alignSelf: 'flex-end', backgroundColor: color.partner },
  tracker: { gap: space[2], alignItems: 'flex-start' }, trackerDetail: { minHeight: size.touchMin, minWidth: size.touchMin, gap: space[1] },
});
