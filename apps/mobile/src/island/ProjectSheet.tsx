import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, EnergySymbol, ProgressBar, space, Stepper, Text } from '../design';
import type { IslandProject } from './community-project';
import { ObjectPreview } from './ObjectPreview';
import { projectTexts } from './texts';

// Inhalt des Projekt-Sheets (Spezifikation 4, Abschnitt 8; #208), geöffnet über „Projekt“ in der Leiste und die
// Route `momo` mit `view: 'projekt'`. Es zeigt den eigenen Anteil exakt („Dein Anteil: 12 von 30“, voll „Dein
// Anteil ist voll“) und den gemeinsamen Fortschritt nur als Stufe; exakte Partnerwerte und „Partner fehlt“ gibt
// es nie. „Einzahlen“ zahlt den gewählten Betrag ein, höchstens den Restbedarf des Anteils und die eigene Energie.
// Die Bestätigung steht im Sheet, weil eine Meldung auf dem Gerät hinter dem nativen Sheet läge (Gerätelauf #202).

export type ProjectSheetProps = Readonly<{
  project: IslandProject;
  /** Angezeigte eigene Energie, mindestens 0. */
  energy: number;
  /** Zahlt ein; liefert den eingezahlten Betrag oder `null`, wenn das Gerät ablehnt. */
  onContribute(amount: number): number | null;
}>;

export function ProjectSheet({ project, energy, onContribute }: ProjectSheetProps) {
  const rest = Math.max(project.own.need - project.own.paid, 0);
  const max = Math.min(rest, energy);
  const [chosen, setChosen] = useState<number | null>(null);
  const [contributed, setContributed] = useState<number | null>(null);
  // Ohne eigene Wahl der höchste mögliche Betrag; nach einer Einzahlung höchstens, was noch geht.
  const amount = Math.min(chosen ?? max, max);

  const contribute = () => {
    const paid = onContribute(amount);
    setContributed(paid);
    setChosen(null);
  };

  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <ObjectPreview art={`geruest_${project.stage}`} />
        <View style={styles.title}>
          <Text variant="label" tone="inkMuted">
            {projectTexts.kind[project.kind]}
          </Text>
          <Text variant="title" accessibilityRole="header">
            {project.name}
          </Text>
          <Text tone="inkMuted">{projectTexts.stage(project.stage)}</Text>
        </View>
      </View>
      <Text variant="label" tone="inkMuted">
        {projectTexts.howItWorks}
      </Text>
      {rest === 0 ? (
        <Text variant="bodyStrong">{projectTexts.ownFull}</Text>
      ) : (
        <ProgressBar label={projectTexts.ownShareLabel} value={project.own.paid} target={project.own.need} valueText={projectTexts.ownShare(project.own.paid, project.own.need)} />
      )}
      {contributed !== null && (
        <Text variant="bodyStrong" tone="success" accessibilityLiveRegion="polite">
          {projectTexts.contributed(contributed)}
        </Text>
      )}
      {rest > 0 &&
        (max === 0 ? (
          <View style={styles.note}>
            <EnergySymbol size="sm" />
            <Text variant="label" tone="inkMuted" style={styles.noteText}>
              {projectTexts.noEnergy}
            </Text>
          </View>
        ) : (
          <View style={styles.actions}>
            <Stepper label={projectTexts.amount} value={amount} valueText={projectTexts.amountValue(amount)} min={1} max={max} step={1} onChange={setChosen} />
            <Button block label={projectTexts.contribute} accessibilityLabel={projectTexts.contributeLabel(amount)} onPress={contribute} />
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: space[4] },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  title: { flex: 1, gap: space[1] },
  actions: { gap: space[3] },
  note: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  noteText: { flex: 1 },
});
