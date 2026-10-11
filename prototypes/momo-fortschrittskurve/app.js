// PROTOTYP (Runde 2): Kette Tagesziele → Energie → Bauen → Levelbalken.
// Momo levelt nur durch selbst verbaute Energie (auch Einzahlung in Gemeinschaftsprojekte),
// siehe Entscheidung „Momos Insel prototypen“ (Issue #28). Kurve B aus Runde 1 ist die Ausgangsrichtung.
// Alle Zahlen (Energie je Ziel, Levelbedarf, Baukosten, Felder, Gebiete) sind Designvorschläge, nicht belegt.

const FORM_LEVELS = [4, 8, 13, 19, 26, 34, 43]; // große Formen aus Kurve B; jede öffnet ein neues Gebiet
const START_PLANS = [1, 2, 3]; // Startbaupläne je Rolle (Kosten), z. B. Weg/Bank/Hütte bzw. Blume/Busch/Baum

const VARIANTS = {
  B1: {
    key: "B1",
    name: "Kurve B, kleine feste Preise",
    tagline: "Kurve B direkt übertragen; neue Baupläne bleiben immer billig (1–6 Energie).",
    need(level) { return Math.min(10 + 2 * level, 40); },
    planCost(level) { return 1 + (level % 6); },
    explanation: "Je Hälfte 10 + 2 × Level verbaute Energie, höchstens 40 (ab Level 15). Jedes Level schaltet einen Bauplan je Rolle frei, der zwischen 1 und 6 Energie kostet. Jede große Form öffnet ein Gebiet mit zwei Entdeckungs-Bauplänen je Rolle.",
    tradeoff: "Man baut fast täglich etwas, aber neue Baupläne fühlen sich nicht größer an, und die Insel füllt sich sehr schnell."
  },
  B2: {
    key: "B2",
    name: "Kurve B, Preise wachsen mit",
    tagline: "Gleiche Levelkurve, aber spätere Baupläne kosten mehr; man baut seltener, dafür Größeres.",
    need(level) { return Math.min(10 + 2 * level, 40); },
    planCost(level) { return Math.round(3 + 0.6 * level); },
    explanation: "Levelbedarf wie B1. Ein Bauplan, der mit Level L kommt, kostet etwa 3 + 0,6 × L Energie (Level 10: 9, Level 20: 15). Die Startbaupläne (1–3 Energie) bleiben für Kleinigkeiten.",
    tradeoff: "Neue Baupläne wirken wertvoller und die Insel füllt sich langsamer. Wer nur das Neueste will, muss mehrere Tage sparen, und solange bewegt sich der Levelbalken nicht."
  },
  B3: {
    key: "B3",
    name: "Kurve B flacher, Preise wachsen mit",
    tagline: "Wie B2, aber der Levelbedarf steigt nur halb so schnell (höchstens 30).",
    need(level) { return Math.min(10 + level, 30); },
    planCost(level) { return Math.round(3 + 0.6 * level); },
    explanation: "Je Hälfte 10 + Level verbaute Energie, höchstens 30 (ab Level 20). Preise wie B2. Dadurch kommen Level, Baupläne und Gebiete auch später noch zügig.",
    tradeoff: "Mehr Freischaltungen pro Jahr bedeuten mehr Inhalte, die gezeichnet werden müssen. Die großen Formen und Gebiete sind früher erreicht und danach ausgeschöpft."
  }
};

const SCENARIOS = {
  together: {
    name: "Gute gemeinsame Woche",
    description: "Beide erfüllen meistens zwei oder drei Tagesziele.",
    philipp: [3, 3, 2, 3, 2, 3, 3],
    partner: [3, 2, 3, 3, 2, 3, 3]
  },
  everyday: {
    name: "Normaler, gemischter Alltag",
    description: "Gute Tage, Teilfortschritt und einzelne Aussetzer wechseln sich ab.",
    philipp: [3, 2, 2, 1, 3, 2, 0],
    partner: [2, 3, 1, 2, 2, 0, 3]
  },
  uneven: {
    name: "Ungleicher Verlauf",
    description: "Philipp ist sehr aktiv, die Partnerin kommt deutlich langsamer voran.",
    philipp: [3, 3, 3, 2, 3, 3, 3],
    partner: [1, 0, 2, 0, 1, 0, 2]
  },
  pause: {
    name: "Pause und Wiedereinstieg",
    description: "Nach einer gemeinsamen Woche pausiert die Partnerin zwei Wochen und steigt dann wieder ein.",
    philipp: [3, 2, 3, 2, 3, 2, 3, 3, 2, 3, 2, 3, 2, 3, 3, 2, 3, 2, 3, 2, 3, 3, 2, 3, 2, 3, 2, 3],
    partner: [3, 2, 3, 2, 3, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 3, 2, 3, 3]
  }
};

const STRATEGIES = {
  instant: { name: "Sofort bauen", description: "Baut täglich das neueste Bauwerk, das bezahlbar ist." },
  save: { name: "Auf Neues sparen", description: "Baut nur den neuesten Bauplan und spart so lange darauf." }
};

// Felder (Annahme, nicht belegt): eigene Ecke + Rollenbereich zum Start, jedes Gebiet bringt weitere.
const FIELDS = { start: 30, perArea: 20 };

const appState = {
  variant: readVariant(),
  scenario: "everyday",
  weeks: 12,
  bonus: 1,
  strategy: "instant",
  projectShare: 0
};

function readVariant() {
  const requested = new URLSearchParams(location.search).get("variant")?.toUpperCase();
  return VARIANTS[requested] ? requested : "B1";
}

function energyForDay(goals, bonus) {
  return goals + (goals === 3 ? bonus : 0);
}

function createPerson() {
  return {
    energy: 0, xp: 0, earned: 0, spent: 0, toProject: 0, builds: 0, projectCarry: 0,
    plans: START_PLANS.map(cost => ({ cost, level: 1 })), buildDays: []
  };
}

// Ein Tag einer Person: Energie verdienen, Anteil ins Gemeinschaftsprojekt, Rest verbauen.
function playDay(person, earned, day, settings) {
  person.energy += earned;
  person.earned += earned;

  person.projectCarry += earned * settings.projectShare;
  const toProject = Math.min(Math.floor(person.projectCarry), person.energy);
  person.projectCarry -= toProject;
  spend(person, toProject);
  person.toProject += toProject;

  const newest = person.plans[person.plans.length - 1];
  while (true) {
    const plan = settings.strategy === "save"
      ? (person.energy >= newest.cost ? newest : null)
      : [...person.plans].reverse().find(candidate => candidate.cost <= person.energy);
    if (!plan) break;
    spend(person, plan.cost);
    person.builds += 1;
    person.buildDays.push(day);
  }
}

function spend(person, amount) {
  person.energy -= amount;
  person.spent += amount;
  person.xp += amount;
}

function simulate(variant, scenario, settings) {
  const p = createPerson();
  const q = createPerson();
  const state = { level: 1, areas: 0, events: [], weekly: [] };

  const totalDays = settings.weeks * 7;
  for (let day = 0; day < totalDays; day += 1) {
    playDay(p, energyForDay(scenario.philipp[day % scenario.philipp.length], settings.bonus), day, settings);
    playDay(q, energyForDay(scenario.partner[day % scenario.partner.length], settings.bonus), day, settings);

    let need = variant.need(state.level);
    while (p.xp >= need && q.xp >= need) {
      p.xp -= need;
      q.xp -= need;
      state.level += 1;
      const cost = variant.planCost(state.level);
      const isForm = FORM_LEVELS.includes(state.level);
      for (const person of [p, q]) {
        person.plans.push({ cost, level: state.level });
        if (isForm) {
          // Entdeckung im neuen Gebiet: zwei zusätzliche Baupläne je Rolle
          person.plans.push({ cost: cost + 1, level: state.level }, { cost: cost + 2, level: state.level });
        }
        person.plans.sort((a, b) => a.level - b.level || a.cost - b.cost);
      }
      if (isForm) state.areas += 1;
      state.events.push({
        day: day + 1,
        week: Math.floor(day / 7) + 1,
        level: state.level,
        type: isForm ? "form" : "change",
        label: isForm
          ? `Große Form ${FORM_LEVELS.indexOf(state.level) + 2} · Gebiet ${state.areas} offen · 3 Baupläne je Rolle (${cost}–${cost + 2} ⚡)`
          : `Kleine Veränderung · 1 Bauplan je Rolle (${cost} ⚡)`
      });
      need = variant.need(state.level);
    }

    if ((day + 1) % 7 === 0) {
      state.weekly.push({ week: (day + 1) / 7, level: state.level });
    }
  }

  const fields = FIELDS.start + FIELDS.perArea * state.areas;
  return { ...state, philipp: p, partner: q, fields };
}

function recentRate(list, totalDays, windowDays = 28) {
  const from = Math.max(totalDays - windowDays, 0);
  const days = totalDays - from;
  return list.filter(day => day >= from).length / days * 7;
}

function daysPerLevel(events, totalDays) {
  const recent = events.filter(event => event.day > totalDays - 56);
  if (recent.length < 2) return null;
  return (recent[recent.length - 1].day - recent[0].day) / (recent.length - 1);
}

function render() {
  const variant = VARIANTS[appState.variant];
  const scenario = SCENARIOS[appState.scenario];
  const result = simulate(variant, scenario, appState);
  const totalDays = appState.weeks * 7;
  const need = variant.need(result.level);
  const nextForm = FORM_LEVELS.find(level => level > result.level);
  const pace = daysPerLevel(result.events, totalDays);
  const levelDays = result.events.map(event => event.day - 1);
  const fullAt = fieldsFullWeek(result);
  const sinceLast = totalDays - (result.events.at(-1)?.day ?? 0);

  document.getElementById("variant-label").textContent = `${variant.key} — ${variant.name}`;
  document.getElementById("app").innerHTML = `
    <section class="variant-intro">
      <div>
        <span class="eyebrow">Variante ${variant.key}</span>
        <h2>${variant.name}</h2>
        <p class="tagline">${variant.tagline}</p>
      </div>
      <div class="formula">
        <strong>1</strong><span>Energie je Tagesziel</span>
        <strong>+${appState.bonus}</strong><span>Tagesbonus bei 3 von 3</span>
        <strong>${variant.need(1)}→${variant.need(60)}</strong><span>verbaute Energie je Hälfte</span>
      </div>
    </section>

    ${renderChain()}

    <section class="controls panel">
      <div>
        <label for="scenario">Wochenverlauf</label>
        <select id="scenario">
          ${Object.entries(SCENARIOS).map(([key, value]) => `<option value="${key}" ${key === appState.scenario ? "selected" : ""}>${value.name}</option>`).join("")}
        </select>
        <p>${scenario.description}</p>
      </div>
      <div>
        <label for="strategy">Bauverhalten (beide)</label>
        <select id="strategy">
          ${Object.entries(STRATEGIES).map(([key, value]) => `<option value="${key}" ${key === appState.strategy ? "selected" : ""}>${value.name}</option>`).join("")}
        </select>
        <p>${STRATEGIES[appState.strategy].description}</p>
      </div>
      ${segmented("Zeitraum", "weeks", [4, 12, 26, 52], value => `${value} Wo.`)}
      ${segmented("Tagesbonus", "bonus", [1, 2], value => `+${value} ⚡`)}
      ${segmented("Ins Gemeinschaftsprojekt", "projectShare", [0, 0.25, 0.5], value => `${Math.round(value * 100)} %`)}
    </section>

    <section class="result-grid">
      <article class="momo-card panel">
        <div class="momo" aria-hidden="true">
          <div class="momo__ears"><i></i><i></i></div>
          <div class="momo__face"><b>•</b><span>ᴗ</span><b>•</b></div>
        </div>
        <div>
          <span class="eyebrow">Nach ${appState.weeks} Wochen</span>
          <h3>Level ${result.level}</h3>
          <p>${result.events.length} Levelaufstiege · ${result.areas} von ${FORM_LEVELS.length} Gebieten offen</p>
          <p>${result.philipp.plans.length} Baupläne je Rolle freigeschaltet</p>
        </div>
      </article>

      <article class="progress-card panel">
        <div class="progress-title"><strong>Aktueller 50/50-Balken</strong><span>${need} verbaute Energie je Hälfte</span></div>
        ${personProgress("Philipp", result.philipp.xp, need, "philipp", result.philipp.energy)}
        ${personProgress("Partnerin", result.partner.xp, need, "partner", result.partner.energy)}
        <p class="bank-note">Der Balken füllt sich nur beim Bauen und Einzahlen. Überschuss über eine volle Hälfte bleibt für das nächste Level erhalten; ungenutzte Energie im Lager verfällt nie.</p>
      </article>
    </section>

    <section class="panel chart-panel">
      <div class="section-heading">
        <div><span class="eyebrow">Verlauf</span><h3>Momos Level und Freischaltungen</h3></div>
        <div class="legend"><span><i class="dot change"></i>Level: neuer Bauplan</span><span><i class="dot form"></i>Große Form: neues Gebiet</span></div>
      </div>
      ${renderChart(result, appState.weeks)}
    </section>

    <section class="detail-grid">
      <article class="panel">
        <span class="eyebrow">So funktioniert es</span>
        <p class="large-copy">${variant.explanation}</p>
        <p class="tradeoff"><strong>Spannung:</strong> ${variant.tradeoff}</p>
      </article>
      <article class="panel">
        <span class="eyebrow">Tempo zuletzt</span>
        <dl class="metrics">
          <div><dt>Tage je Level</dt><dd>${pace ? `≈ ${fmt(pace)} Tage` : "unter 2 Aufstiege in 8 Wochen"}<br><small>Durchschnitt der letzten 8 Wochen · letzter Aufstieg vor ${sinceLast} Tagen</small></dd></div>
          <div><dt>Bauen pro Woche</dt><dd>${fmt(recentRate(result.philipp.buildDays, totalDays))} / ${fmt(recentRate(result.partner.buildDays, totalDays))}<br><small>Philipp / Partnerin, letzte 4 Wochen</small></dd></div>
          <div><dt>Levelaufstiege pro Woche</dt><dd>${fmt(recentRate(levelDays, totalDays))} zuletzt · ${fmt(recentRate(levelDays, totalDays, totalDays))} im Schnitt<br><small>je Aufstieg mindestens 1 neuer Bauplan je Rolle</small></dd></div>
          <div><dt>Nächste große Form</dt><dd>${nextForm ? `Level ${nextForm} (Gebiet ${result.areas + 1})` : "alle Gebiete offen"}</dd></div>
        </dl>
      </article>
    </section>

    <section class="detail-grid">
      <article class="panel">
        <span class="eyebrow">Energie</span>
        <dl class="metrics">
          <div><dt>Verdient</dt><dd>${result.philipp.earned} / ${result.partner.earned}<br><small>Philipp / Partnerin</small></dd></div>
          <div><dt>Gebaut</dt><dd>${result.philipp.builds} / ${result.partner.builds} Objekte<br><small>${result.philipp.spent - result.philipp.toProject} / ${result.partner.spent - result.partner.toProject} Energie</small></dd></div>
          <div><dt>Ins Gemeinschaftsprojekt</dt><dd>${result.philipp.toProject} / ${result.partner.toProject} Energie</dd></div>
          <div><dt>Im Lager</dt><dd>${result.philipp.energy} / ${result.partner.energy} Energie</dd></div>
        </dl>
      </article>
      <article class="panel">
        <span class="eyebrow">Platz auf der Insel (Annahme)</span>
        <dl class="metrics">
          <div><dt>Felder je Person</dt><dd>${result.fields}<br><small>${FIELDS.start} zum Start + ${FIELDS.perArea} je Gebiet</small></dd></div>
          <div><dt>Belegt</dt><dd>${pct(result.philipp.builds, result.fields)} / ${pct(result.partner.builds, result.fields)}<br><small>Philipp / Partnerin</small></dd></div>
          <div><dt>Insel voll</dt><dd>${fullAt ? `ab Woche ${fullAt}` : "nicht im Zeitraum"}<br><small>danach fehlt Platz zum Bauen, solange es kein Abreißen oder Aufwerten gibt</small></dd></div>
        </dl>
      </article>
    </section>

    <section class="panel milestone-panel">
      <span class="eyebrow">Freischaltungen</span>
      <h3>Was wann dazukommt</h3>
      ${renderMilestones(result)}
    </section>

    <details class="state panel">
      <summary>Vollständigen Simulationszustand anzeigen</summary>
      <pre>${escapeHtml(JSON.stringify({ settings: appState, ...result }, null, 2))}</pre>
    </details>
  `;

  document.getElementById("scenario").addEventListener("change", event => {
    appState.scenario = event.target.value;
    render();
  });
  document.getElementById("strategy").addEventListener("change", event => {
    appState.strategy = event.target.value;
    render();
  });
  document.querySelectorAll("[data-key]").forEach(button => button.addEventListener("click", () => {
    appState[button.dataset.key] = Number(button.dataset.value);
    render();
  }));
}

function renderChain() {
  return `
    <section class="chain panel" aria-label="Fortschrittskette">
      <div><b>Tagesziele</b><small>3 je Person</small></div><span>→</span>
      <div><b>Energie</b><small>persönlich, verfällt nie</small></div><span>→</span>
      <div><b>Bauen / Einzahlen</b><small>verbaut eigene Energie</small></div><span>→</span>
      <div><b>Eigene Hälfte</b><small>des 50/50-Balkens</small></div><span>→</span>
      <div><b>Level</b><small>Baupläne, Gebiete</small></div>
    </section>`;
}

function segmented(label, key, values, format) {
  return `
    <fieldset>
      <legend>${label}</legend>
      ${values.map(value => `<button class="period ${value === appState[key] ? "active" : ""}" data-key="${key}" data-value="${value}">${format(value)}</button>`).join("")}
    </fieldset>`;
}

function fieldsFullWeek(result) {
  // Erste Woche, in der eine Person mehr Objekte gebaut hat, als ihr bis dahin Felder offenstehen.
  const areaDays = result.events.filter(event => event.type === "form").map(event => event.day - 1);
  const weeks = [result.philipp, result.partner].map(person => {
    const index = person.buildDays.findIndex((day, i) =>
      i + 1 > FIELDS.start + FIELDS.perArea * areaDays.filter(areaDay => areaDay <= day).length);
    return index === -1 ? null : Math.floor(person.buildDays[index] / 7) + 1;
  }).filter(Boolean);
  return weeks.length ? Math.min(...weeks) : null;
}

function renderMilestones(result) {
  if (!result.events.length) return `<p class="muted">Noch kein Levelaufstieg im Zeitraum.</p>`;
  const forms = result.events.filter(event => event.type === "form");
  const firstLevels = result.events.slice(0, 6);
  const rows = [...new Map([...firstLevels, ...forms].map(event => [event.level, event])).values()]
    .sort((a, b) => a.level - b.level);
  return `<table class="milestones">
    <thead><tr><th>Woche</th><th>Tag</th><th>Level</th><th>Was neu ist</th></tr></thead>
    <tbody>${rows.map(event => `<tr class="${event.type}"><td>${event.week}</td><td>${event.day}</td><td>${event.level}</td><td>${event.label}</td></tr>`).join("")}</tbody>
  </table>
  <p class="muted">Gezeigt: die ersten sechs Level und alle großen Formen. Jedes weitere Level bringt einen Bauplan je Rolle.</p>`;
}

function personProgress(name, xp, need, className, stored) {
  const visible = Math.min(xp, need);
  const percent = Math.round(visible / need * 100);
  const overflow = Math.max(xp - need, 0);
  return `
    <div class="person-progress ${className}">
      <div><strong>${name}</strong><span>${visible} / ${need}${overflow ? ` · +${overflow} vorgemerkt` : ""} · ${stored} ⚡ im Lager</span></div>
      <div class="bar"><i style="width:${percent}%"></i></div>
    </div>`;
}

function renderChart(result, weeks) {
  const width = 900;
  const height = 230;
  const pad = { left: 38, right: 18, top: 20, bottom: 30 };
  const maxLevel = Math.max(...result.weekly.map(point => point.level), 2);
  const x = week => pad.left + (week / weeks) * (width - pad.left - pad.right);
  const y = level => height - pad.bottom - ((level - 1) / Math.max(maxLevel - 1, 1)) * (height - pad.top - pad.bottom);
  const steps = [{ week: 0, level: 1 }];
  for (const event of result.events) {
    steps.push({ week: event.day / 7, level: event.level - 1 }, { week: event.day / 7, level: event.level });
  }
  steps.push({ week: weeks, level: result.level });
  const points = steps.map(point => `${x(point.week)},${y(point.level)}`).join(" ");
  const gridLevels = [...new Set([1, Math.ceil(maxLevel / 2), maxLevel])];
  const grid = gridLevels.map(level => `<g><line x1="${pad.left}" x2="${width - pad.right}" y1="${y(level)}" y2="${y(level)}"/><text x="${pad.left - 8}" y="${y(level) + 4}">${level}</text></g>`).join("");
  const markers = result.events.map(event => `<circle class="${event.type}" cx="${x(event.day / 7)}" cy="${y(event.level)}" r="${event.type === "form" ? 6 : 3}"><title>Woche ${event.week}: Level ${event.level} – ${event.label}</title></circle>`).join("");
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Levelverlauf über ${weeks} Wochen">
    <g class="grid">${grid}</g>
    <polyline points="${points}"/>
    <g class="markers">${markers}</g>
    <text class="axis-label" x="${width / 2}" y="${height - 4}">Wochen</text>
  </svg>`;
}

function fmt(value) {
  return value.toFixed(1).replace(".", ",");
}

function pct(value, total) {
  return `${Math.round(value / total * 100)} %`;
}

function switchVariant(direction) {
  const keys = Object.keys(VARIANTS);
  const current = keys.indexOf(appState.variant);
  appState.variant = keys[(current + direction + keys.length) % keys.length];
  const url = new URL(location.href);
  url.searchParams.set("variant", appState.variant);
  history.replaceState({}, "", url);
  render();
}

function escapeHtml(value) {
  return value.replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}

document.getElementById("previous").addEventListener("click", () => switchVariant(-1));
document.getElementById("next").addEventListener("click", () => switchVariant(1));
document.addEventListener("keydown", event => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
  if (event.key === "ArrowLeft") switchVariant(-1);
  if (event.key === "ArrowRight") switchVariant(1);
});

render();
