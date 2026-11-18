import { usePreventRemove } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { targetInputLimits } from '@abnehm/contracts/goal-calculator';
import { kcalOfMilliKcal } from '@abnehm/contracts/plan';
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

const kcalOf = kcalOfMilliKcal;

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
  { title: texts.maintenance, text: ({ values }) => maintenanceText(values.maintenanceReason) },
];

function maintenanceText(reason: GoalVersionView['values']['maintenanceReason']): string {
  return reason === null ? texts.maintenanceStates.off : texts.maintenanceStates[reason];
}

function Upcoming({ current, upcoming }: { current: GoalVersionView; upcoming: GoalVersionView }) {
  const rows = shownFields.flatMap((field) => {
    const before = field.text(current);
    const after = field.text(upcoming);
    return before === after ? [] : [{ title: field.title, before, after }];
  });
  // Ändert die Fassung nur die Herleitung, etwa das Alter am Geburtstag, nennt sie das statt einer leeren Liste.
  const shown = rows.length > 0 ? rows : [{ title: texts.budget, before: texts.derivationBefore, after: texts.derivationChanged }];
  return (
    <View style={styles.section}>
      <SectionTitle>{texts.sections.upcoming}</SectionTitle>
      <Text variant="label" tone="inkMuted">
        {texts.upcomingIntro}
      </Text>
      <ListGroup>
        {shown.map(({ title, before, after }) => (
          <ValueRow key={title} title={title} value={after} subtitle={texts.previously(before)} />
        ))}
      </ListGroup>
    </View>
  );
}

function BudgetDerivation({ view }: { view: GoalVersionView }) {
  const { values } = view;
  const factor = view.activityFactor;
  return (
    <View style={styles.section}>
      <SectionTitle>{texts.sections.budget}</SectionTitle>
      <ListGroup>
        <ValueRow title={texts.budget} value={kcalText(kcalOf(values.calorieBudgetMilliKcal))} subtitle={texts.budgetSources[values.budgetSource]} />
        <ValueRow title={texts.basal} value={kcalText(kcalOf(values.basalMetabolicRateMilliKcal))} />
        {factor === null ? null : (
          <ValueRow
            title={texts.activity}
            subtitle={activityLevelNames[values.activityLevel]}
            value={texts.activityFactor(factor)}
            label={rowLabel(`${texts.activity} ${activityLevelNames[values.activityLevel]}`, texts.activityFactorSpoken(factor))}
          />
        )}
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

function Goals({ view }: { view: GoalVersionView }) {
  const { values, forecast } = view;
  const forecastText = forecast === null ? undefined : `${texts.forecast(forecast.year, forecast.month)} · ${texts.estimate}`;
  const maintenance = maintenanceText(values.maintenanceReason);
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
  /** Eigenes Budget der Person; im Haltemodus nie, dort ist das Budget der Gesamtumsatz. */
  manual: boolean;
  manualBudgetText: string;
  /** Das Budget eines angenommenen Budgetvorschlags gilt weiter, bis die Person ein anderes wählt. */
  keepsSuggestion: boolean;
}>;

function formOf(base: GoalDraft, suggestedBudgetKcal: number | null): Form {
  const manual = base.manualBudgetKcal !== null && suggestedBudgetKcal === null;
  return {
    draft: base,
    holding: base.pace === null,
    goalWeightText: base.goalWeightG === null ? '' : thousandthsWithOneDecimal(base.goalWeightG),
    manual,
    manualBudgetText: manual ? String(base.manualBudgetKcal) : '',
    keepsSuggestion: suggestedBudgetKcal !== null,
  };
}

/** Ganze kcal, auch mit deutschem Tausenderpunkt („1.700“). */
function kcalOfText(text: string): number | null {
  const digits = text.trim().replace(/\./g, '');
  return /^\d{1,5}$/.test(digits) ? Number(digits) : null;
}

/** Der Entwurf, den „Ab morgen übernehmen“ anlegen würde, und welche Eingabe sich nicht lesen lässt. */
function candidateOf(form: Form, suggestedBudgetKcal: number | null) {
  const goalWeightG = gramsOfKgText(form.goalWeightText);
  const ownBudget = form.manual && !form.holding;
  const manualBudgetKcal = ownBudget ? kcalOfText(form.manualBudgetText) : null;
  const budget = form.holding ? null : ownBudget ? manualBudgetKcal : form.keepsSuggestion ? suggestedBudgetKcal : null;
  const draft: GoalDraft = {
    ...form.draft,
    goalWeightG: goalWeightG ?? form.draft.goalWeightG,
    pace: form.holding ? null : form.draft.pace,
    manualBudgetKcal: budget,
  };
  return { draft, goalWeightUnreadable: goalWeightG === null, manualBudgetUnreadable: ownBudget && manualBudgetKcal === null };
}

const sameDraft = (a: GoalDraft, b: GoalDraft) => (Object.keys(a) as (keyof GoalDraft)[]).every((key) => a[key] === b[key]);

function GoalForm({ settings, base, onDone }: { settings: GoalSettings; base: GoalDraft; onDone: () => void }) {
  const plan = useAppPlan();
  const { showMessage } = useMessageHost();
  const [form, setForm] = useState(() => formOf(base, settings.suggestedBudgetKcal));
  const change = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }));
  const { draft, goalWeightUnreadable, manualBudgetUnreadable } = candidateOf(form, settings.suggestedBudgetKcal);
  // Die fachliche Prüfung liegt im Plan-Modul; hier bleibt nur, was sich als Text nicht lesen lässt.
  const check = settings.check(draft, { holding: form.holding });
  const { result, reference, forced } = check;
  const goalWeightProblem =
    check.goalWeightProblem === 'below_limit' && reference !== null
      ? texts.goalWeightBelowLimit(reference.goalWeight.range.min)
      : goalWeightUnreadable || check.goalWeightProblem !== null ? texts.goalWeightInvalid : undefined;
  const budgetRange = reference?.manualBudgetRange ?? null;
  const budgetProblem = budgetRange !== null && (manualBudgetUnreadable || check.manualBudgetInvalid) ? texts.manualBudgetInvalid(budgetRange.min, budgetRange.max) : undefined;
  const changed = !sameDraft(draft, base);
  const valid = check.valid && !goalWeightUnreadable && !manualBudgetUnreadable;
  const waterTargetMl = draft.waterTargetMl ?? reference?.water.targetMl ?? targetInputLimits.waterTargetMl.min;
  const sportMinutes = draft.weeklySportTargetMinutes ?? reference?.sport.weeklyTargetMinutes ?? targetInputLimits.weeklySportTargetMinutes.min;

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
        <Notice tone="hint" text={texts.maintenanceForced(reference?.safetyTriggers ?? [])} />
      ) : (
        <ListGroup>
          <ListRow
            title={texts.holdSwitch}
            subtitle={texts.holdHint}
            accessory={
              <Switch
                label={texts.holdSwitch}
                value={form.holding}
                onValueChange={(holding) => change({ holding, draft: { ...form.draft, pace: null }, manual: false, keepsSuggestion: false })}
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
          hint={reference === null ? undefined : texts.goalWeightHint(reference.goalWeight.suggestion, reference.goalWeight.range.min)}
          problem={goalWeightProblem}
        />
        {check.goalWeightNotBelowCurrent ? <Notice tone="hint" text={texts.goalNotBelow(draft.weightG)} /> : null}
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
          {check.paceMissing ? <Notice tone="hint" text={texts.choosePace} /> : null}
        </View>
      )}

      {forced || form.holding ? null : (
        <View style={styles.section}>
          <ListGroup>
            <ListRow
              title={texts.manualBudget}
              subtitle={form.keepsSuggestion && settings.suggestedBudgetKcal !== null ? texts.suggestionKept(settings.suggestedBudgetKcal) : texts.manualBudgetHint}
              accessory={<Switch label={texts.manualBudget} value={form.manual} onValueChange={(manual) => change({ manual, keepsSuggestion: false })} />}
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
          value={waterTargetMl}
          valueText={litreText(waterTargetMl)}
          {...targetInputLimits.waterTargetMl}
          hint={texts.waterHint}
          onChange={(waterTargetMl) => change({ draft: { ...form.draft, waterTargetMl } })}
        />
        <Stepper
          label={texts.sport}
          value={sportMinutes}
          valueText={texts.sportStep(sportMinutes)}
          {...targetInputLimits.weeklySportTargetMinutes}
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

const styles = StyleSheet.create({
  section: { gap: space[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  actions: { gap: space[2] },
  loading: { minHeight: size.rowMin, justifyContent: 'center', paddingHorizontal: space[4] },
  sheet: { gap: space[4] },
});
