# AGENTS.md

Anweisungen für alle Coding-Agenten in diesem Repo (Claude Code, pi + OpenAI, …). Diese Datei ist die **einzige Quelle**; `CLAUDE.md` importiert sie nur.

## Projekt

Abnehm-App (iOS + Android) für zwei Personen (Philipp: iPhone, seine Frau: Android + Fitbit): Kalorien-, Wasser-, Sport- und Gewichtstracker, Motivation/Gamification, gegenseitige Unterstützung. App-Sprache: nur Deutsch.

**Aktuelle Phase: Planung.** Ziel ist eine umsetzungsreife V1-Spezifikation. Die Planung läuft als Wayfinder-Karte auf GitHub:
- Karte: [Wayfinder: Abnehm-App V1-Spezifikation](https://github.com/Yggras/abnehm-app/issues/1) (Label `wayfinder:map`)
- Tickets: Sub-Issues der Karte; Abhängigkeiten über GitHubs native „blocked by“-Beziehung
- Recherche-Ergebnisse: `research/<name>.md` auf Branches `research/<name>`

## Regeln

- **Keine unbelegten Aussagen.** Jede Faktenbehauptung braucht eine Quelle (bevorzugt Primärquelle, mit URL). Nicht Belegbares ausdrücklich als „nicht belegt“ kennzeichnen.
- **Selbstständig committen**, ohne nachzufragen.
- **Niemals einen Agenten/eine KI als Co-Author eintragen** – keine `Co-Authored-By`-Zeile, keine KI-Attribution in Commits oder PRs. Gilt auch für Subagenten.
- **Nicht betrachtet (vorerst):** Aufwandsschätzungen und rechtliche Themen (Legal, z. B. DSGVO, Datenschutzerklärung, Lizenzrecht).
- Kommunikation mit dem Nutzer auf Deutsch.

## Harness-neutrale Struktur

- Anweisungen gehören in **diese Datei**, nie nur in `CLAUDE.md` o. Ä.
- Allgemeine Workflow-Skills (u. a. `wayfinder`, `grilling`, `domain-modeling`, `prototype`, `research`) kommen **global** aus `~/.agents/skills/` (von pi direkt gelesen, für Claude Code über Symlinks in `~/.claude/skills/`). Sie werden **nicht** ins Repo kopiert.
- Projektspezifische Skills liegen in **`.agents/skills/<name>/SKILL.md`** (Agent-Skills-Standard; pi liest `.agents/skills/` – [pi-Doku](https://unpkg.com/@earendil-works/pi-coding-agent@0.80.9/README.md)).
- Claude Code liest `.agents/` nicht, folgt aber Symlinks pro Skill-Ordner ([Claude-Code-Doku](https://code.claude.com/docs/en/skills)). Für **jeden** neuen Skill daher einen Symlink anlegen:
  `ln -s ../../.agents/skills/<name> .claude/skills/<name>`
- `CLAUDE.md` enthält nur `@AGENTS.md` (Import, [Claude-Code-Doku](https://code.claude.com/docs/en/memory)).
- Keine harness-spezifischen Config-Dateien als einzige Quelle für Projektwissen.
