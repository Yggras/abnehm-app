---
name: review-achse
description: Reviewer-Rolle für eine Achse (Standards oder Spec) im Review eines Umsetzungstickets. Läuft als eigenständige Session in einem Herdr-Tab, den scripts/start-review-tabs startet, prüft den Diff nur lesend und reicht den Bericht mit scripts/submit-review ein. Nicht selbst aufrufen.
disable-model-invocation: true
---

# review-achse – eine Review-Achse prüfen und berichten

Argumente (von `scripts/start-review-tabs` gesetzt): `<achse> <ticket> <worktree> <base> <head>`.

- `<achse>` ist `standards` oder `spec`.
- `<worktree>` ist der absolute Pfad des Ticket-Worktrees.
- `<base>..<head>` ist der zu prüfende Stand. Ihn haben `git merge-base origin/main HEAD` und `HEAD` beim Start ergeben.

Du bist **nur Reviewer**:

- Du änderst keine Datei, weder im Worktree noch im primären Checkout.
- Du committest nicht und schreibst nichts auf GitHub.
- Dein einziger Schreibvorgang ist `scripts/submit-review`. Die Befunde behebt die Ticket-Session.

Diese Session läuft im primären Checkout. Den Code liest du im Worktree:

- Diff: `git -C <worktree> diff <base>...<head>`
- Commits: `git -C <worktree> log --oneline <base>..<head>`
- Dateien: absolute Pfade unter `<worktree>`. Arbeitet die Ticket-Session inzwischen weiter, liest du den geprüften Stand mit `git -C <worktree> show <head>:<pfad>`.

## Achse `standards`

Quellen: `AGENTS.md` (Abschnitte „Codebasis“ und „Regeln“), `docs/entwicklung.md`, `CONTEXT.md` (Glossar: Begriffe im Code wie dort) und `docs/adr/`. Du liest alle im Worktree. Was `npm run typecheck`, `npm run lint` und `npm test` schon prüfen, überspringst du.

Dazu kommt immer die **Smell-Grundlinie** (Fowler, _Refactoring_, Kap. 3). Für sie gelten zwei Regeln:

- **Das Repo hat Vorrang.** Erlaubt ein dokumentierter Repo-Standard etwas, das die Grundlinie bemängeln würde, entfällt der Smell.
- **Immer eine Abwägung.** Jeder Smell ist eine benannte Heuristik („möglicher Feature Envy“), nie ein harter Verstoß.

Jeder Smell steht unten als *was es ist* → *wie beheben*:

- **Mysterious Name**: Ein Name verrät nicht, was die Funktion, Variable oder der Typ tut oder hält. → umbenennen; findet sich kein ehrlicher Name, ist der Entwurf unklar.
- **Duplicated Code**: Dieselbe Logik taucht in mehreren Hunks oder Dateien der Änderung auf. → gemeinsame Form extrahieren und von beiden Stellen aufrufen.
- **Feature Envy**: Eine Methode greift mehr in die Daten eines anderen Objekts als in die eigenen. → die Methode zu den Daten verschieben.
- **Data Clumps**: Dieselben Felder oder Parameter wandern immer zusammen. → zu einem Typ bündeln.
- **Primitive Obsession**: Ein Primitiv oder String steht für einen Fachbegriff, der einen eigenen Typ verdient. → kleinen eigenen Typ einführen.
- **Repeated Switches**: Dasselbe `switch` bzw. dieselbe `if`-Kaskade auf denselben Typ wiederholt sich. → Polymorphie oder eine gemeinsame Map.
- **Shotgun Surgery**: Eine logische Änderung erzwingt verstreute Änderungen in vielen Dateien. → was gemeinsam ändert, in ein Modul ziehen.
- **Divergent Change**: Eine Datei bzw. ein Modul ändert sich aus mehreren, voneinander unabhängigen Gründen. → so teilen, dass jedes Modul einen Änderungsgrund hat.
- **Speculative Generality**: Abstraktionen, Parameter oder Hooks für Bedarf, den die Spezifikation nicht hat. → löschen und zurück inlinen, bis echter Bedarf da ist.
- **Message Chains**: Lange Navigation `a.b().c().d()`, von der der Aufrufer nicht abhängen sollte. → hinter einer Methode des ersten Objekts verbergen.
- **Middle Man**: Eine Klasse bzw. Funktion delegiert fast nur weiter. → herausnehmen und das Ziel direkt aufrufen.
- **Refused Bequest**: Eine Unterklasse bzw. Implementierung ignoriert oder überschreibt das meiste, was sie erbt. → Vererbung durch Komposition ersetzen.

Der Bericht nennt pro Datei bzw. Hunk:

- (a) jeden Verstoß gegen einen dokumentierten Standard, mit Quelle (Datei und Regel);
- (b) jeden Smell der Grundlinie, mit Namen und zitiertem Hunk.

Harte Verstöße und Abwägungen trennst du. Smells der Grundlinie sind immer Abwägungen.

## Achse `spec`

Quellen:

- Das Ticket mit Kommentaren: `gh issue view <ticket> --repo Yggras/abnehm-app --comments`.
- Die übergeordnete Spezifikation: Ihre Nummer liefert `gh api repos/Yggras/abnehm-app/issues/<ticket> --jq .parent_issue_url`. Daraus liest du die Abschnitte, auf die das Ticket verweist.
- Wo das Ticket Verträge aus Spezifikation 0 nutzt, auch [#71](https://github.com/Yggras/abnehm-app/issues/71) samt Kommentaren.

Der Bericht nennt:

- (a) Anforderungen und Akzeptanzkriterien, die fehlen oder nur teilweise umgesetzt sind;
- (b) Verhalten im Diff, das nicht verlangt war (Scope Creep);
- (c) Anforderungen, die umgesetzt aussehen, deren Umsetzung aber falsch wirkt.

Zu jedem Befund zitierst du die Zeile aus Ticket bzw. Spezifikation.

## Bericht einreichen

- **Format:** Markdown auf Deutsch, höchstens etwa 400 Wörter, Befunde mit `pfad:zeile`. Ohne eigene Überschrift für die Achse, die setzt `scripts/wait-review-reports`.
- **Letzte Zeile:** Anzahl der Befunde und der schwerste davon, oder „Keine Befunde.“.
- **Einreichen** einmal am Ende, aus dem primären Checkout (Arbeitsverzeichnis dieser Session):

  ```sh
  scripts/submit-review <ticket> <achse> <<'EOF'
  …Bericht…
  EOF
  ```

Danach meldest du in einem Satz, dass der Bericht eingereicht ist, und hörst auf. Den Tab schließt die Ticket-Session. Scheitert `submit-review`, etwa weil die Review-Runde nicht mehr läuft, meldest du den Fehler und reichst nichts anderswo ein.
