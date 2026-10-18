# Arbeitsordner: `/impeccable document` über die Token-Datei

Beleg zum Akzeptanzkriterium aus [„Fundament · Design-System“ (#95)](https://github.com/Yggras/abnehm-app/issues/95): einmalig `/impeccable document` im Scan-Modus über [`apps/mobile/src/design/tokens.ts`](../../apps/mobile/src/design/tokens.ts).

| Inhalt | Zweck |
| --- | --- |
| `DESIGN.md` | Ergebnis im [DESIGN.md-Format](https://raw.githubusercontent.com/google-labs-code/design.md/main/docs/spec.md): 51 Farben plus 10 Aliase, 11 Textstile, Radien, Abstände und 15 Komponenten-Varianten. **Nicht maßgeblich.** |
| `design.json` | Sidecar von Impeccable mit Schatten, Bewegung und sechs Komponenten-Schnipseln (statt unter `.impeccable/`, das nicht ins Repo kommt) |

Maßgeblich bleiben [`research/design-system.md`](../../research/design-system.md) und die Token-Datei der App; `tokens.test.ts` hält beide deckungsgleich. Ob `DESIGN.md` `research/design-system.md` ablöst, entscheidet der Nutzer (Empfehlung im Pull Request zu #95). Bis dahin liegt sie wie die Momentaufnahme aus #91 ([`spikes/impeccable-review/`](../impeccable-review/README.md)) nur hier, damit es keine zweite Quelle im Repo-Root gibt.

## Entstehung

1. `.claude/skills/impeccable/scripts/impeccable context --target apps/mobile/src/design/tokens.ts` lud `docs/PRODUCT.md` (Plattform `adaptive`); eine `DESIGN.md` gab es nicht.
2. Die Frontmatter erzeugte ein Skript direkt aus den exportierten Tokens (`color`, `type`, `radius`, `space`, `elevation`, `motion`), damit kein Wert abgetippt ist. Die Aliase stammen aus der Spalte „Alias auf …“ von `research/design-system.md`.
3. Die beschreibende Sprache (North Star, Farbnamen, Regeln) stammt aus dem bestätigten Leitbild des Design-Systems, wie schon in #91 ([research/impeccable-review.md › DESIGN.md](../../research/impeccable-review.md#designmd-impeccable-document)). Deshalb gab es keine neue Befragungsrunde.
4. Neu gegenüber #91 sind die tatsächlich gebauten Primitiven (Komponenten-Varianten, Hinweis, Listenzeile, Fortschritt), die Regeln „Energie ist ein Symbol“ und „Mitwachsen“ sowie der Sockelkanten-Adapter.
