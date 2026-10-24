# Product

<!-- impeccable:product-schema 1 -->

<!-- Produktkontext für den Skill Impeccable (`/impeccable init`, Ticket #91). Diese Datei verweist auf die maßgeblichen Quellen, statt sie abzuschreiben: Begriffe stehen nur in CONTEXT.md, Gestaltung nur in research/design-system.md, Verhalten in den Spezifikationen 0–5. -->

## Platform

adaptive

## Users

Genau zwei bekannte Personen, ein Paar ([AGENTS.md](../AGENTS.md)):

- **Philipp** – iPhone SE (3. Generation) mit Fitbit Sense 2, deren Daten über Google Health nach Apple Health kommen. Er steuert und testet die Entwicklung ([Karte](https://github.com/Yggras/abnehm-app/issues/1), [Spike Health-Hintergrund](../spikes/health-hintergrund/RESULTS.md)).
- **Seine Frau** – Android (Zielgerät Fairphone 6, Android 16) mit Fitbit, Daten über Health Connect ([Spike Insel-Rendering](../spikes/insel-rendering/RESULTS.md)). In Entwürfen heißt sie mit Platzhalternamen „Anna“. Entwickelt und geprüft wird auf Android seit 24.10.2026 mit einem Samsung Galaxy A34 (SM-A346B) statt des Fairphone 6 (Nutzerentscheidung, [Entwicklung](entwicklung.md)).

Beide wollen gemeinsam abnehmen und sich gegenseitig unterstützen, ohne einander zu kontrollieren. Sie erfassen mehrmals täglich kurz, oft unterwegs und einhändig. Weitere Zielgruppen gibt es in V1 nicht; die Architektur soll eine spätere Veröffentlichung nicht verbauen.

## Product Purpose

„Gemeinsam leichter“ ([#70](https://github.com/Yggras/abnehm-app/issues/70)) verbindet Kalorien-, Wasser-, Sport- und Gewichtstracker mit einem gemeinsamen Spiel um das Wesen Momo und seine Insel. Erfolg heißt: Beide erfassen regelmäßig und ermutigen einander ohne Druck. Häufiges Self-Monitoring und Partner-Ermutigung sind laut Studienlage die stärksten Hebel ([#7](https://github.com/Yggras/abnehm-app/issues/7)).

## Positioning

Ein gemeinsames Wesen und eine gemeinsame Insel wachsen nur aus den erfüllten Tageszielen beider Personen. Es gibt keine Strafe, keinen Verlust, keinen Vergleich und keine klassischen Streaks ([#12](https://github.com/Yggras/abnehm-app/issues/12), [#26](https://github.com/Yggras/abnehm-app/issues/26)). Einen direkten Wettbewerber mit dieser Kombination hat die Recherche nicht belegt ([#17](https://github.com/Yggras/abnehm-app/issues/17)).

## Operating Context

- Die App ist offline-first: Eigenes Erfassen und Bauen funktionieren ohne Netz ([#35](https://github.com/Yggras/abnehm-app/issues/35)).
- Trainings und Gewicht kommen zusätzlich aus Apple Health bzw. Health Connect. Grundweg ist der Import beim Öffnen der App ([Spezifikation 3](https://github.com/Yggras/abnehm-app/issues/86)).
- Erinnerungen: höchstens zwei gebündelte Tages-Check-ins und seltene Server-Pushes ([Spezifikation 5](https://github.com/Yggras/abnehm-app/issues/87)).
- Verteilung: privat über TestFlight und Play Internal Testing ([#8](https://github.com/Yggras/abnehm-app/issues/8)).

## Capabilities and Constraints

- Funktionsumfang und Verhalten: [Spezifikationen 0–5](https://github.com/Yggras/abnehm-app/issues/1) („Spezifikationen“ auf der Karte).
- Fachbegriffe: ausschließlich [CONTEXT.md](../CONTEXT.md).
- Stack: Expo (React Native, TypeScript), eigenes Hono-Backend ([#10](https://github.com/Yggras/abnehm-app/issues/10), [#11](https://github.com/Yggras/abnehm-app/issues/11), [#41](https://github.com/Yggras/abnehm-app/issues/41)).
- Nur Deutsch. Ausgeschlossen sind öffentlicher Store-Release, KI-Coach, Dunkelmodus und die Bedienung der Insel ohne Sehen (Karte, „Out of scope“).

## Brand Commitments

- Name „Gemeinsam leichter“ und Momo-Umarmungs-Icon ([#70](https://github.com/Yggras/abnehm-app/issues/70)).
- Momo ist der Lagunenling ([#69](https://github.com/Yggras/abnehm-app/issues/69)).
- Das visuelle System ist „Lagune“ in heller Fassung. Maßgeblich ist [research/design-system.md](../research/design-system.md); Werte nicht hierher kopieren.
- Ton: Du-Form, freundlich, ohne Schuld- und Verlust-Framing ([research/design-system.md › Sprache und Ton](../research/design-system.md#sprache-und-ton)).

## Evidence on Hand

- Recherchen unter `research/`, Prototypen unter `prototypes/`, Gerätemessungen unter `spikes/`.
- Echte Nutzungsdaten, Interviews oder Testimonials gibt es nicht und dürfen nicht erfunden werden. Beispieldaten in Entwürfen sind erfunden.

## Product Principles

1. Einfache, intuitive Bedienung und Motivation entscheiden jede Frage (Leitprinzip der Karte).
2. Miteinander, nie gegeneinander: Der Partner sieht nur grobe, freigegebene Zusammenfassungen und nie das absolute Gewicht ([#22](https://github.com/Yggras/abnehm-app/issues/22), [#43](https://github.com/Yggras/abnehm-app/issues/43)).
3. Wohlwollend statt wertend: Es gibt keinen Druck zum Weniger-Essen und keine Erinnerung wegen des Kalorienbudgets. Bei Risiken schützt der Sicherheits-Check ([#14](https://github.com/Yggras/abnehm-app/issues/14), [#37](https://github.com/Yggras/abnehm-app/issues/37)).
4. Erfassen geht sofort, Korrigieren über „Rückgängig“, ehrliche Korrekturen kosten keine Energie ([#35](https://github.com/Yggras/abnehm-app/issues/35), [#38](https://github.com/Yggras/abnehm-app/issues/38)).

## Accessibility & Inclusion

**Nicht im V1-Umfang** ([Folgeticket #249](https://github.com/Yggras/abnehm-app/issues/249)): WCAG 2.2 AA, übertragen auf Mobil-Apps, sowie Screenreader, Schriftfaktor 2,0, Mindest-Trefferflächen, Kontrast-Audit und reduzierte Bewegung sind kein V1-Abnahmekriterium oder Merge-Gate. Bereits implementierte Hilfen bleiben bestehen; sie werden nicht gezielt entfernt. Die bisherigen Zielwerte sind für die Zeit nach V1 in [research/design-system.md › Barrierefreiheit](../research/design-system.md#barrierefreiheit) dokumentiert. Visuelle Design-`critique`, funktionale Tests und Sicherheitsnachweise bleiben V1-Umfang.
