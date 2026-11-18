import { usePreventRemove } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { GoalCalculation, GoalCalculatorResult, GoalInputError } from '@abnehm/contracts/goal-calculator';
import type { Pace } from '@abnehm/contracts/ports';

import { Button, Chip, ListGroup, ListRow, Notice, Sheet, Skeleton, size, space, Stepper, Switch, Text, TextField } from '../design';
import type { RouteScreenProps } from '../navigation';
import { useAppPlan, useGoalSettings, type GoalDraft, type GoalSettings, type GoalVersionView } from '../plan';
import { SectionTitle } from '../settings/SectionTitle';
import { useMessageHost } from '../shell/MessageHost';
import { ScreenFrame } from '../shell/ScreenFrame';
import { thousandthsWithOneDecimal, titleOf } from '../shell/texts';
import { gramsOfKgText } from '../trackers/kg-text';
import { activityLevelNames, goalTexts as texts, kcalText, kgText, litreText, paceNames, paceRates, rowLabel } from './texts';

/**
 * Einstellungsseite „Ziele“ (Spezifikation 1, Abschnitt 10; #147), unter „Dein Plan“ in der Übersicht der
 * Einstellungen. Sie zeigt die heute gültigen Ziele samt Herleitung des Kalorienbudgets, Prognose und
 * Haltemodus, darüber eine bevorstehende Fassung „ab morgen“. „Ziele ändern“ öffnet die Bearbeitung;
 * „Ab morgen übernehmen“ legt über das Plan-Modul eine vollständige Zielversion ab morgen an, ein erneutes
 * Übernehmen am selben Tag ersetzt sie. Im erzwungenen Haltemodus erklärt die Seite den Grund statt
 * Tempo und Budgeteingabe. Den Bereich „Körperdaten & Neuberechnung“ liefert #148.
 */
export function GoalsScreen({ target }: RouteScreenProps<'settings'>) {
  const state = useGoalSettings();
  const [editing, setEditing] = useState(false);
  return (
    <ScreenFrame title={titleOf(target)} presentation="page">
      {state.type === 'loading' ? (
        <View style={styles.loading} accessibilityLabel={texts.loading}>
          <Skeleton width="60%" />
        </View>
      ) : state.type === 'error' ? (
        <Notice tone="problem" cause="technik" text={texts.error} />
      ) : state.settings.current === null || state.settings.draft === null ? (
        <Text>{texts.empty}</Text>
      ) : editing ? (
        <GoalForm settings={state.settings} base={state.settings.draft} onDone={() => setEditing(false)} />
      ) : (
        <Overview settings={state.settings} current={state.settings.current} onEdit={() => setEditing(true)} />
      )}
      <Notice tone="neutral" text={texts.disclaimer} />
    </ScreenFrame>
  );
}

const kcalOf = (milliKcal: number) => Math.floor(milliKcal / 1_000);

function Overview({ settings, current, onEdit }: { settings: GoalSettings; current: GoalVersionView; onEdit: () => void }) {
  return (
    <>
      {settings.upcoming === null ? null : <Upcoming current={current} upcoming={settings.upcoming.view} />}
      <BudgetDerivation view={current} />
      <Goals view={current} />
      <Button label={texts.edit} variant="secondary" block onPress={onEdit} />
    </>
  );
}

/** Eine Zeile mit Wert; ihr zugänglicher Name nennt Titel, Wert und Unterzeile. */
function ValueRow({ title, value, subtitle, label }: { title: string; value: string; subtitle?: string; label?: string }) {
  return <ListRow title={title} value={value} subtitle={subtitle} accessibilityLabel={label ?? rowLabel(title, value, subtitle)} />;
}

type ShownField = Readonly<{ title: string; text: (view: GoalVersionView) => string }>;

/** Die Werte, die „ab morgen“ nennt; Zwischenwerte der Herleitung zeigt die Seite erst, wenn sie gelten. */
const shownFields: readonly ShownField[] = [
  { title: texts.budget, text: ({ values }) => kcalText(kcalOf(values.calorieBudgetMilliKcal)) },
  { title: texts.pace, text: ({ values }) => texts.paceText(values.pace) },
  { title: texts.goalWeight, text: ({ values }) => kgText(values.goalWeightG) },
  { title: texts.water, text: ({ values }) => texts.waterPerDay(values.waterTargetMl) },
  { title: texts.sport, text: ({ values }) => texts.sportPerWeek(values.weeklySportTargetMinutes) },
];

function Upcoming({ current, upcoming }: { current: GoalVersionView; upcoming: GoalVersionView }) {
  const rows = shownFields.flatMap((field) => {
    const before = field.text(current);
    const after = field.text(upcoming);
    return before === after ? [] : [{ title: field.title, before, after }];
  });
  if (rows.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionTitle>{texts.sections.upcoming}</SectionTitle>
      <Text variant="label" tone="inkMuted">
        {texts.upcomingIntro}
      </Text>
      <ListGroup>
        {rows.map(({ title, before, after }) => (
          <ValueRow key={title} title={title} value={after} subtitle={texts.previously(before)} />
        ))}
      </ListGroup>
    </View>
  );
}

function BudgetDerivation({ view }: { view: GoalVersionView }) {
  const { values } = view;
  const factor = activityFactors[values.activityLevel];
  return (
    <View style={styles.section}>
      <SectionTitle>{texts.sections.budget}</SectionTitle>
      <ListGroup>
        <ValueRow title={texts.budget} value={kcalText(kcalOf(values.calorieBudgetMilliKcal))} subtitle={texts.budgetSources[values.budgetSource]} />
        <ValueRow title={texts.basal} value={kcalText(kcalOf(values.basalMetabolicRateMilliKcal))} />
        <ValueRow
          title={texts.activity}
          subtitle={activityLevelNames[values.activityLevel]}
          value={texts.activityFactor(factor)}
          label={rowLabel(`${texts.activity} ${activityLevelNames[values.activityLevel]}`, texts.activityFactorSpoken(factor))}
        />
        <ValueRow title={texts.total} value={kcalText(kcalOf(values.totalEnergyExpenditureMilliKcal))} />
        {values.deficitMilliKcal === null || values.pace === null ? null : (
          <ValueRow
            title={texts.deficit(values.pace)}
            value={texts.deficitValue(kcalOf(values.deficitMilliKcal))}
            label={rowLabel(texts.deficit(values.pace), texts.deficitSpoken(kcalOf(values.deficitMilliKcal)))}
          />
        )}
        <ValueRow
          title={texts.lowerBound}
          value={kcalText(kcalOf(values.lowerBoundMilliKcal))}
          subtitle={texts.lowerBoundHint}
          label={rowLabel(texts.lowerBound, kcalText(kcalOf(values.lowerBoundMilliKcal)))}
        />
      </ListGroup>
      {view.budgetRaisedToLowerBound ? <Notice tone="hint" text={texts.raised} /> : null}
    </View>
  );
}

/** PAL der Aktivitätsstufen (DGE), wie sie die Zielversion zur Herleitung nennt. */
const activityFactors = { wenig_aktiv: 1.4, maessig_aktiv: 1.6, aktiv: 1.8 } as const;

function Goals({ view }: { view: GoalVersionView }) {
  const { values, forecast } = view;
  const forecastText = forecast === null ? undefined : `${texts.forecast(forecast.year, forecast.month)} · ${texts.estimate}`;
  const maintenance = values.maintenanceReason === null ? texts.maintenanceStates.off : texts.maintenanceStates[values.maintenanceReason];
  return (
    <View style={styles.section}>
      <SectionTitle>{texts.sections.goals}</SectionTitle>
      <ListGroup>
        <ValueRow
          title={texts.goalWeight}
          value={kgText(values.goalWeightG)}
          subtitle={forecastText}
          label={rowLabel(texts.goalWeight, kgText(values.goalWeightG), forecast && texts.forecast(forecast.year, forecast.month), forecast && texts.estimate)}
        />
        {values.pace === null ? null : <ValueRow title={texts.pace} value={paceNames[values.pace]} subtitle={paceRates[values.pace]} />}
        <ValueRow title={texts.water} value={texts.waterPerDay(values.waterTargetMl)} />
        <ValueRow title={texts.sport} value={texts.sportPerWeek(values.weeklySportTargetMinutes)} />
        <ValueRow title={texts.maintenance} value={maintenance} />
      </ListGroup>
      {forecast === null ? null : (
        <Text variant="label" tone="inkMuted">
          {texts.slowsDown}
        </Text>
      )}
      {values.maintenanceReason === 'sicherheits_check' ? <Notice tone="hint" text={texts.maintenanceForced(view.safetyTriggers)} /> : null}
    </View>
  );
}

/** Der Bearbeitungsstand: Entwurf samt Texten der Eingabefelder. */
type Form = Readonly<{
  draft: GoalDraft;
  /** Die Person hält ihr Gewicht freiwillig; der erzwungene Haltemodus hängt nicht daran. */
  holding: boolean;
  goalWeightText: string;
  manual: boolean;
  manualBudgetText: string;
}>;

function formOf(base: GoalDraft): Form {
  return {
    draft: base,
    holding: base.pace === null,
    goalWeightText: base.goalWeightG === null ? '' : thousandthsWithOneDecimal(base.goalWeightG),
    manual: base.manualBudgetKcal !== null,
    manualBudgetText: base.manualBudgetKcal === null ? '' : String(base.manualBudgetKcal),
  };
}

/** Ganze kcal, auch mit deutschem Tausenderpunkt („1.700“). */
function kcalOfText(text: string): number | null {
  const digits = text.trim().replace(/\./g, '');
  return /^\d{1,5}$/.test(digits) ? Number(digits) : null;
}

/** Der Entwurf, den „Ab morgen übernehmen“ anlegen würde, und was ihm fehlt. */
function candidateOf(form: Form) {
  const goalWeightG = gramsOfKgText(form.goalWeightText);
  const manualBudgetKcal = form.manual ? kcalOfText(form.manualBudgetText) : null;
  const draft: GoalDraft = {
    ...form.draft,
    goalWeightG: goalWeightG ?? form.draft.goalWeightG,
    pace: form.holding ? null : form.draft.pace,
    manualBudgetKcal: form.manual ? (manualBudgetKcal ?? form.draft.manualBudgetKcal) : null,
  };
  return { draft, goalWeightUnreadable: goalWeightG === null, manualBudgetUnreadable: form.manual && manualBudgetKcal === null };
}

const sameDraft = (a: GoalDraft, b: GoalDraft) => (Object.keys(a) as (keyof GoalDraft)[]).every((key) => a[key] === b[key]);

const errorsOf = (result: GoalCalculatorResult): readonly GoalInputError[] => (result.type === 'ungueltig' ? result.errors : []);

function GoalForm({ settings, base, onDone }: { settings: GoalSettings; base: GoalDraft; onDone: () => void }) {
  const plan = useAppPlan();
  const { showMessage } = useMessageHost();
  const [form, setForm] = useState(() => formOf(base));
  const change = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }));
  const { draft, goalWeightUnreadable, manualBudgetUnreadable } = candidateOf(form);
  const result = settings.preview(draft);
  // Grenzen, Vorschlag und Sicherheitsgrund hängen weder am Zielgewicht noch am eigenen Budget; ohne beide
  // lassen sie sich auch zeigen, solange eine dieser Eingaben ungültig ist.
  const reference = settings.preview({ ...draft, goalWeightG: null, manualBudgetKcal: null });
  const calculation: GoalCalculation | null = reference.type === 'berechnet' ? reference : null;
  const forced = calculation?.maintenanceReason === 'sicherheits_check';
  const errors = errorsOf(result);
  const goalWeightProblem = goalWeightProblemOf(goalWeightUnreadable, errors, calculation);
  const budgetRange = calculation?.manualBudgetRange ?? null;
  const budgetProblem =
    budgetRange !== null && (manualBudgetUnreadable || errors.some((error) => error.startsWith('manual_budget')))
      ? texts.manualBudgetInvalid(budgetRange.min, budgetRange.max)
      : undefined;
  const paceMissing = !forced && !form.holding && draft.pace === null;
  const goalNotBelow = !forced && !form.holding && draft.pace !== null && result.type === 'berechnet' && result.hints.includes('goal_weight_not_below_current');
  const changed = !sameDraft(draft, base);
  const valid = result.type === 'berechnet' && !goalWeightUnreadable && !manualBudgetUnreadable && !paceMissing && !goalNotBelow;

  const [leaving, setLeaving] = useState<Readonly<{ repeat: () => void; confirmed: boolean }> | null>(null);
  usePreventRemove(changed && leaving?.confirmed !== true, ({ repeat }) => setLeaving({ repeat, confirmed: false }));
  useEffect(() => {
    if (leaving?.confirmed) leaving.repeat();
  }, [leaving]);

  /** Legt die Fassung ab morgen an; liefert, ob das gelang. */
  function save(): boolean {
    if (plan === null || !valid) return false;
    const saved = plan.changeGoals(draft);
    if (saved.type === 'ungueltig') return false;
    if (saved.type === 'gespeichert') showMessage({ messageKey: 'ziele.ab_morgen_gespeichert', values: {} });
    return true;
  }

  return (
    <>
      <Text>{texts.editIntro}</Text>
      {forced ? (
        <Notice tone="hint" text={texts.maintenanceForced(calculation?.safetyTriggers ?? [])} />
      ) : (
        <ListGroup>
          <ListRow
            title={texts.holdSwitch}
            subtitle={texts.holdHint}
            accessory={
              <Switch
                label={texts.holdSwitch}
                value={form.holding}
                onValueChange={(holding) => change({ holding, draft: { ...form.draft, pace: null }, manual: false })}
              />
            }
          />
        </ListGroup>
      )}

      <View style={styles.section}>
        <TextField
          label={texts.goalWeight}
          kind="number"
          unit="kg"
          value={form.goalWeightText}
          onChangeText={(goalWeightText) => change({ goalWeightText })}
          hint={calculation === null ? undefined : texts.goalWeightHint(calculation.goalWeight.suggestion, calculation.goalWeight.range.min)}
          problem={goalWeightProblem}
        />
        {goalNotBelow ? <Notice tone="hint" text={texts.goalNotBelow(draft.weightG)} /> : null}
      </View>

      {forced || form.holding ? null : (
        <View style={styles.section}>
          <SectionTitle>{texts.pace}</SectionTitle>
          <View style={styles.chips}>
            {(['entspannt', 'zuegiger'] as const satisfies readonly Pace[]).map((pace) => (
              <Chip
                key={pace}
                label={texts.paceChoice(pace)}
                selection="single"
                selected={draft.pace === pace}
                onPress={() => change({ draft: { ...form.draft, pace } })}
              />
            ))}
          </View>
          {paceMissing ? <Notice tone="hint" text={texts.choosePace} /> : null}
        </View>
      )}

      {forced ? null : (
        <View style={styles.section}>
          <ListGroup>
            <ListRow
              title={texts.manualBudget}
              subtitle={texts.manualBudgetHint}
              accessory={<Switch label={texts.manualBudget} value={form.manual} onValueChange={(manual) => change({ manual })} />}
            />
          </ListGroup>
          {form.manual ? (
            <TextField
              label={texts.manualBudgetField}
              kind="number"
              unit="kcal"
              value={form.manualBudgetText}
              onChangeText={(manualBudgetText) => change({ manualBudgetText })}
              hint={budgetRange === null ? undefined : texts.manualBudgetRange(budgetRange.min, budgetRange.max)}
              problem={budgetProblem}
            />
          ) : null}
        </View>
      )}

      <ListGroup>
        <Stepper
          label={texts.water}
          value={draft.waterTargetMl ?? calculation?.water.targetMl ?? 0}
          valueText={litreText(draft.waterTargetMl ?? calculation?.water.targetMl ?? 0)}
          {...(calculation?.water.range ?? waterRange)}
          hint={texts.waterHint}
          onChange={(waterTargetMl) => change({ draft: { ...form.draft, waterTargetMl } })}
        />
        <Stepper
          label={texts.sport}
          value={draft.weeklySportTargetMinutes ?? calculation?.sport.weeklyTargetMinutes ?? 0}
          valueText={texts.sportStep(draft.weeklySportTargetMinutes ?? calculation?.sport.weeklyTargetMinutes ?? 0)}
          {...(calculation?.sport.range ?? sportRange)}
          hint={texts.sportHint}
          onChange={(weeklySportTargetMinutes) => change({ draft: { ...form.draft, weeklySportTargetMinutes } })}
        />
      </ListGroup>

      {result.type === 'berechnet' ? (
        <View style={styles.section}>
          <ListGroup>
            <ValueRow title={texts.newBudget} value={kcalText(result.calorieBudget.kcal)} />
          </ListGroup>
          {result.budgetRaisedToLowerBound ? <Notice tone="hint" text={texts.raised} /> : null}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button label={texts.save} block disabled={!valid || !changed} onPress={() => save() && onDone()} />
        <Button label={texts.cancel} variant="text" block onPress={onDone} />
      </View>

      <Sheet visible={leaving !== null && !leaving.confirmed} onClose={() => setLeaving(null)}>
        <View style={styles.sheet}>
          <Text variant="title" accessibilityRole="header">
            {texts.leave.title}
          </Text>
          <Text>{texts.leave.text}</Text>
          <Button
            label={texts.save}
            block
            disabled={!valid}
            onPress={() => {
              if (save()) setLeaving((current) => current && { ...current, confirmed: true });
              else setLeaving(null);
            }}
          />
          <Button label={texts.leave.discard} variant="secondary" block onPress={() => setLeaving((current) => current && { ...current, confirmed: true })} />
          <Button label={texts.leave.stay} variant="text" block onPress={() => setLeaving(null)} />
        </View>
      </Sheet>
    </>
  );
}

/** Wasser- und Sportgrenzen des Zielrechners (Spezifikation 1, Abschnitt 3; Designwerte), solange die Rechnung fehlt. */
const waterRange = { min: 500, max: 5_000, step: 250 } as const;
const sportRange = { min: 30, max: 600, step: 10 } as const;

function goalWeightProblemOf(unreadable: boolean, errors: readonly GoalInputError[], calculation: GoalCalculation | null): string | undefined {
  if (errors.includes('goal_weight_below_lower_limit') && calculation !== null) return texts.goalWeightBelowLimit(calculation.goalWeight.range.min);
  if (unreadable || errors.some((error) => error.startsWith('goal_weight'))) return texts.goalWeightInvalid;
  return undefined;
}

const styles = StyleSheet.create({
  section: { gap: space[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  actions: { gap: space[2] },
  loading: { minHeight: size.rowMin, justifyContent: 'center', paddingHorizontal: space[4] },
  sheet: { gap: space[4] },
});
