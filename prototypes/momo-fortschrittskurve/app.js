// PROTOTYP (Runde 3): Kette Tagesziele → Energie → Bauen → Levelbalken, über bis zu zwei Jahre.
// Momo levelt nur durch selbst verbaute Energie (auch Einzahlung in Gemeinschaftsprojekte),
// siehe Entscheidung „Momos Insel prototypen“ (Issue #28). Gewählt: Preise aus B2 mit dem Tempo aus B3 (= B3).
// Runde 3 prüft drei Mechaniken für die Zeit nach dem siebten Gebiet: endlose Gebiete, Inselkapitel, Aufwerten.
// Alle Zahlen (Energie je Ziel, Levelbedarf, Baukosten, Felder, Gebiete) sind Designvorschläge, nicht belegt.

const FORM_LEVELS = [4, 8, 13, 19, 26, 34, 43]; // große Formen aus Kurve B; jede öffnet ein neues Gebiet
const AREAS_PER_ISLAND = FORM_LEVELS.length;
const LATE_STEP = 6; // nach dem siebten Gebiet: alle 6 Level ein weiteres Gebiet bzw. eine neue Insel
const START_PLANS = [1, 2, 3]; // Startbaupläne je Rolle (Kosten), z. B. Weg/Bank/Hütte bzw. Blume/Busch/Baum
const MAX_PLAN_COST = 24; // Preisdeckel, damit Baupläne nach Level 35 nicht teurer als ein Level werden
const MAX_STAGE = 3; // Aufwerten: Stufe 1 → 2 → 3, kostet das 2- bzw. 3-Fache des Grundpreises

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
    planCost(level) { return Math.min(Math.round(3 + 0.6 * level), MAX_PLAN_COST); },
    explanation: "Levelbedarf wie B1. Ein Bauplan, der mit Level L kommt, kostet etwa 3 + 0,6 × L Energie (Level 10: 9, Level 20: 15, höchstens 24). Die Startbaupläne (1–3 Energie) bleiben für Kleinigkeiten.",
    tradeoff: "Neue Baupläne wirken wertvoller und die Insel füllt sich langsamer. Wer nur das Neueste will, muss mehrere Tage sparen, und solange bewegt sich der Levelbalken nicht."
  },
  B3: {
    key: "B3",
    name: "Gewählt: B2-Preise, B3-Tempo",
    tagline: "Levelbedarf steigt halb so schnell wie bei B1/B2 (höchstens 30); spätere Baupläne kosten mehr.",
    need(level) { return Math.min(10 + level, 30); },
    planCost(level) { return Math.min(Math.round(3 + 0.6 * level), MAX_PLAN_COST); },
    explanation: "Je Hälfte 10 + Level verbaute Energie, höchstens 30 (ab Level 20). Ein Bauplan von Level L kostet etwa 3 + 0,6 × L Energie, höchstens 24. Nutzerentscheidung vom 2026-10-11.",
    tradeoff: "Mehr Freischaltungen pro Jahr bedeuten mehr Inhalte. Ohne Mechanik für die Zeit danach sind die sieben Gebiete bei guten Wochen nach einem Jahr ausgeschöpft."
  }
};

const LATE_MODES = {
  none: {
    name: "Nichts",
    description: "Nach dem siebten Gebiet gibt es nur noch einen Bauplan je Level; der Platz wächst nicht mehr."
  },
  endless: {
    name: "Endlose Gebiete",
    description: `Alle ${LATE_STEP} Level ein weiteres Gebiet als neue Landschaft (+20 Felder) mit einem wiederverwendeten Entdeckungs-Bauplan je Rolle.`
  },
  chapters: {
    name: "Inselkapitel",
    description: `${LATE_STEP} Level nach dem siebten Gebiet entdeckt Momo eine Nachbarinsel: neue Startfelder, Levelbedarf und Preise beginnen wieder klein, die alte Insel bleibt besuchbar.`
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
    description: "Nach einer gemeinsamen Woche pausiert die Partnerin zwei Wochen und steigt dann wieder ein (wiederholt sich alle 4 Wochen).",
    philipp: [3, 2, 3, 2, 3, 2, 3, 3, 2, 3, 2, 3, 2, 3, 3, 2, 3, 2, 3, 2, 3, 3, 2, 3, 2, 3, 2, 3],
    partner: [3, 2, 3, 2, 3, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 3, 2, 3, 3]
  }
};

const STRATEGIES = {
  instant: { name: "Sofort bauen", description: "Baut täglich das neueste Bauwerk, das bezahlbar ist." },
  save: { name: "Auf Neues sparen", description: "Baut nur den neuesten Bauplan und spart so lange darauf." }
};

// Felder je Person (Annahme, nicht belegt): eigene Ecke + Rollenbereich zum Start, jedes Gebiet bringt weitere.
const FIELD_SIZES = {
  tight: { name: "Knapp", start: 30, perArea: 20 },
  roomy: { name: "Großzügig", start: 60, perArea: 40 },
  unlimited: { name: "Unbegrenzt", start: Infinity, perArea: 0 }
};

const appState = {
  variant: readVariant(),
  scenario: "everyday",
  weeks: 104,
  bonus: 1,
  strategy: "instant",
  projectShare: 0,
  lateMode: "none",
  upgrades: 0,
  fieldSize: "tight"
};

function readVariant() {
  const requested = new URLSearchParams(location.search).get("variant")?.toUpperCase();
  return VARIANTS[requested] ? requested : "B3";
}

function energyForDay(goals, bonus) {
  return goals + (goals === 3 ? bonus : 0);
}

function createPerson() {
  return {
    energy: 0, xp: 0, earned: 0, spent: 0, toProject: 0, projectCarry: 0,
    plans: START_PLANS.map(cost => ({ cost, level: 1 })),
    objects: [], buildDays: [], upgradeDays: [], blockedDays: [], upgrades: 0
  };
}

// Ein Tag einer Person: Energie verdienen, Anteil ins Gemeinschaftsprojekt, Rest verbauen bzw. aufwerten.
function playDay(person, earned, day, settings, fields) {
  person.energy += earned;
  person.earned += earned;

  person.projectCarry += earned * settings.projectShare;
  const toProject = Math.min(Math.floor(person.projectCarry), person.energy);
  person.projectCarry -= toProject;
  spend(person, toProject);
  person.toProject += toProject;

  const newest = person.plans[person.plans.length - 1];
  const cheapest = Math.min(...person.plans.map(plan => plan.cost));
  while (true) {
    if (person.objects.length < fields) {
      const plan = settings.strategy === "save"
        ? (person.energy >= newest.cost ? newest : null)
        : [...person.plans].reverse().find(candidate => candidate.cost <= person.energy);
      if (!plan) break;
      spend(person, plan.cost);
      person.objects.push({ cost: plan.cost, stage: 1 });
      person.buildDays.push(day);
      continue;
    }
    // Insel voll: aufwerten, falls eingeschaltet; sonst bleibt die Energie liegen.
    const upgrade = settings.upgrades ? bestUpgrade(person) : null;
    if (!upgrade) {
      if (person.energy >= cheapest) person.blockedDays.push(day);
      break;
    }
    spend(person, upgrade.price);
    upgrade.object.stage += 1;
    person.upgrades += 1;
    person.upgradeDays.push(day);
  }
}

function bestUpgrade(person) {
  let best = null;
  for (const object of person.objects) {
    if (object.stage >= MAX_STAGE) continue;
    const price = object.cost * (object.stage + 1);
    if (price <= person.energy && (!best || price > best.price)) best = { object, price };
  }
  return best;
}

function spend(person, amount) {
  person.energy -= amount;
  person.spent += amount;
  person.xp += amount;
}

function simulate(variant, scenario, settings) {
  const p = createPerson();
  const q = createPerson();
  const FIELDS = FIELD_SIZES[settings.fieldSize];
  const state = { level: 1, island: 1, chapterStart: 1, areasOnIsland: 0, areas: 0, fields: FIELDS.start, fieldSize: FIELDS, events: [], weekly: [] };
  const chapterLevel = () => state.level - state.chapterStart + 1;

  const totalDays = settings.weeks * 7;
  for (let day = 0; day < totalDays; day += 1) {
    playDay(p, energyForDay(scenario.philipp[day % scenario.philipp.length], settings.bonus), day, settings, state.fields);
    playDay(q, energyForDay(scenario.partner[day % scenario.partner.length], settings.bonus), day, settings, state.fields);

    let need = variant.need(chapterLevel());
    while (p.xp >= need && q.xp >= need) {
      p.xp -= need;
      q.xp -= need;
      state.level += 1;
      const event = levelUp(state, variant, settings, chapterLevel(), [p, q]);
      state.events.push({ day: day + 1, week: Math.floor(day / 7) + 1, level: state.level, ...event });
      need = variant.need(chapterLevel());
    }

    if ((day + 1) % 7 === 0) {
      state.weekly.push({ week: (day + 1) / 7, level: state.level });
    }
  }

  return { ...state, philipp: p, partner: q };
}

// Was ein Levelaufstieg freischaltet: immer einen Bauplan je Rolle, dazu ggf. Gebiet oder neue Insel.
function levelUp(state, variant, settings, level, people) {
  const cost = variant.planCost(level);
  const addPlans = costs => people.forEach(person => {
    costs.forEach(planCost => person.plans.push({ cost: planCost, level: state.level }));
  });
  addPlans([cost]);

  const isForm = state.areasOnIsland < AREAS_PER_ISLAND && FORM_LEVELS.includes(level);
  const lastForm = FORM_LEVELS[AREAS_PER_ISLAND - 1];
  const isLate = state.areasOnIsland >= AREAS_PER_ISLAND && level > lastForm && (level - lastForm) % LATE_STEP === 0;

  if (isForm) {
    state.areasOnIsland += 1;
    state.areas += 1;
    state.fields += state.fieldSize.perArea;
    addPlans([cost + 1, cost + 2]);
    return { type: "form", label: `Große Form · Insel ${state.island}, Gebiet ${state.areasOnIsland} · 3 Baupläne je Rolle (${cost}–${cost + 2} ⚡)` };
  }
  if (isLate && settings.lateMode === "endless") {
    state.areasOnIsland += 1;
    state.areas += 1;
    state.fields += state.fieldSize.perArea;
    addPlans([cost]);
    return { type: "form", label: `Neue Landschaft · Gebiet ${state.areasOnIsland} · 2 Baupläne je Rolle, einer davon wiederverwendet (${cost} ⚡)` };
  }
  if (isLate && settings.lateMode === "chapters") {
    state.island += 1;
    state.chapterStart = state.level;
    state.areasOnIsland = 0;
    state.fields += state.fieldSize.start;
    const fresh = START_PLANS.map(planCost => planCost + 1);
    addPlans(fresh);
    return { type: "island", label: `Nachbarinsel ${state.island} entdeckt · ${fieldText(state.fieldSize.start)} neue Felder · Levelbedarf beginnt wieder bei ${variant.need(1)} · 4 Baupläne je Rolle` };
  }
  return { type: "change", label: `Kleine Veränderung · 1 Bauplan je Rolle (${cost} ⚡)` };
}

function countIn(days, from, to) {
  return days.filter(day => day >= from && day < to).length;
}

function recentRate(list, totalDays, windowDays = 28) {
  const from = Math.max(totalDays - windowDays, 0);
  return countIn(list, from, totalDays) / (totalDays - from) * 7;
}

function daysPerLevel(events, totalDays) {
  const recent = events.filter(event => event.day > totalDays - 56);
  if (recent.length < 2) return null;
  return (recent[recent.length - 1].day - recent[0].day) / (recent.length - 1);
}

function firstFullWeek(person, result) {
  // Erste Woche, in der eine Person nicht mehr neu bauen konnte (blockiert oder Aufwerten statt Neubau).
  const day = Math.min(person.blockedDays[0] ?? Infinity, person.upgradeDays[0] ?? Infinity);
  return Number.isFinite(day) ? Math.floor(day / 7) + 1 : null;
}

function render() {
  const variant = VARIANTS[appState.variant];
  const scenario = SCENARIOS[appState.scenario];
  const result = simulate(variant, scenario, appState);
  const totalDays = appState.weeks * 7;
  const need = variant.need(result.level - result.chapterStart + 1);
  const pace = daysPerLevel(result.events, totalDays);
  const levelDays = result.events.map(event => event.day - 1);
  const sinceLast = totalDays - (result.events.at(-1)?.day ?? 0);
  const fullWeeks = [result.philipp, result.partner].map(person => firstFullWeek(person, result)).filter(Boolean);
  const fullAt = fullWeeks.length ? Math.min(...fullWeeks) : null;

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
      ${segmented("Zeitraum", "weeks", [12, 26, 52, 78, 104], value => `${value} Wo.`)}
      ${segmented("Tagesbonus", "bonus", [1, 2], value => `+${value} ⚡`)}
      ${segmented("Ins Gemeinschaftsprojekt", "projectShare", [0, 0.25, 0.5], value => `${Math.round(value * 100)} %`)}
    </section>

    <section class="controls panel late-controls">
      <div>
        ${segmented("Nach dem siebten Gebiet", "lateMode", Object.keys(LATE_MODES), value => LATE_MODES[value].name)}
        <p>${LATE_MODES[appState.lateMode].description}</p>
      </div>
      <div>
        ${segmented("Platz je Person", "fieldSize", Object.keys(FIELD_SIZES), value => FIELD_SIZES[value].name)}
        <p>${appState.fieldSize === "unlimited" ? "Kein Platzlimit: zeigt das reine Tempo ohne Platzproblem." : `${FIELD_SIZES[appState.fieldSize].start} Felder zum Start, ${FIELD_SIZES[appState.fieldSize].perArea} je Gebiet (Annahme, nicht belegt).`}</p>
      </div>
      <div>
        ${segmented("Aufwerten", "upgrades", [0, 1], value => value ? "An" : "Aus")}
        <p>${appState.upgrades
          ? `Ist kein Feld frei, wird Gebautes aufgewertet (z. B. Hütte → Haus → Villa): Stufe 2 kostet das Doppelte, Stufe 3 das Dreifache des Grundpreises. Braucht kein neues Feld.`
          : "Ist kein Feld frei, bleibt Energie im Lager liegen, und der Levelbalken steht still (außer bei Einzahlungen ins Gemeinschaftsprojekt)."}</p>
      </div>
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
          <p>${result.events.length} Levelaufstiege · ${result.areas} Gebiete${result.island > 1 ? ` · Insel ${result.island}` : ""}</p>
          <p>${result.philipp.plans.length} Baupläne je Rolle freigeschaltet</p>
        </div>
      </article>

      <article class="progress-card panel">
        <div class="progress-title"><strong>Aktueller 50/50-Balken</strong><span>${need} verbaute Energie je Hälfte</span></div>
        ${personProgress("Philipp", result.philipp.xp, need, "philipp", result.philipp.energy)}
        ${personProgress("Partnerin", result.partner.xp, need, "partner", result.partner.energy)}
        <p class="bank-note">Der Balken füllt sich nur beim Bauen, Aufwerten und Einzahlen. Überschuss über eine volle Hälfte bleibt für das nächste Level erhalten; ungenutzte Energie im Lager verfällt nie.</p>
      </article>
    </section>

    <section class="panel chart-panel">
      <div class="section-heading">
        <div><span class="eyebrow">Verlauf</span><h3>Momos Level und Freischaltungen</h3></div>
        <div class="legend"><span><i class="dot change"></i>Level: neuer Bauplan</span><span><i class="dot form"></i>Neues Gebiet</span><span><i class="dot island"></i>Neue Insel</span></div>
      </div>
      ${renderChart(result, appState.weeks)}
    </section>

    ${appState.weeks > 52 ? renderYears(result, totalDays) : ""}

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
          <div><dt>Neu bauen pro Woche</dt><dd>${fmt(recentRate(result.philipp.buildDays, totalDays))} / ${fmt(recentRate(result.partner.buildDays, totalDays))}<br><small>Philipp / Partnerin, letzte 4 Wochen</small></dd></div>
          <div><dt>Aufwerten pro Woche</dt><dd>${fmt(recentRate(result.philipp.upgradeDays, totalDays))} / ${fmt(recentRate(result.partner.upgradeDays, totalDays))}<br><small>Philipp / Partnerin, letzte 4 Wochen</small></dd></div>
          <div><dt>Levelaufstiege pro Woche</dt><dd>${fmt(recentRate(levelDays, totalDays))} zuletzt · ${fmt(recentRate(levelDays, totalDays, totalDays))} im Schnitt</dd></div>
        </dl>
      </article>
    </section>

    <section class="detail-grid">
      <article class="panel">
        <span class="eyebrow">Energie</span>
        <dl class="metrics">
          <div><dt>Verdient</dt><dd>${result.philipp.earned} / ${result.partner.earned}<br><small>Philipp / Partnerin</small></dd></div>
          <div><dt>Gebaut</dt><dd>${result.philipp.objects.length} / ${result.partner.objects.length} Objekte<br><small>${result.philipp.upgrades} / ${result.partner.upgrades} Aufwertungen</small></dd></div>
          <div><dt>Ins Gemeinschaftsprojekt</dt><dd>${result.philipp.toProject} / ${result.partner.toProject} Energie</dd></div>
          <div><dt>Im Lager</dt><dd>${result.philipp.energy} / ${result.partner.energy} Energie</dd></div>
        </dl>
      </article>
      <article class="panel">
        <span class="eyebrow">Platz auf der Insel (Annahme)</span>
        <dl class="metrics">
          <div><dt>Felder je Person</dt><dd>${fieldText(result.fields)}<br><small>${fieldText(result.fieldSize.start)} je Insel zum Start + ${result.fieldSize.perArea} je Gebiet</small></dd></div>
          <div><dt>Belegt</dt><dd>${result.philipp.objects.length} / ${result.partner.objects.length} Felder<br><small>Philipp / Partnerin</small></dd></div>
          <div><dt>Erstmals voll</dt><dd>${fullAt ? `Woche ${fullAt}` : "nicht im Zeitraum"}</dd></div>
          <div><dt>Tage blockiert</dt><dd>${new Set(result.philipp.blockedDays).size} / ${new Set(result.partner.blockedDays).size}<br><small>Energie da, aber kein Feld frei und nichts aufzuwerten</small></dd></div>
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
    const value = button.dataset.value;
    appState[button.dataset.key] = Number.isNaN(Number(value)) ? value : Number(value);
    render();
  }));
}

function renderYears(result, totalDays) {
  const year2End = Math.min(totalDays, 728);
  const rows = [
    ["Levelaufstiege", days => countIn(result.events.map(event => event.day - 1), ...days)],
    ["Neue Gebiete", days => countIn(result.events.filter(event => event.type === "form").map(event => event.day - 1), ...days)],
    ["Neue Inseln", days => countIn(result.events.filter(event => event.type === "island").map(event => event.day - 1), ...days)],
    ["Neu gebaut (Philipp / Partnerin)", days => `${countIn(result.philipp.buildDays, ...days)} / ${countIn(result.partner.buildDays, ...days)}`],
    ["Aufgewertet (Philipp / Partnerin)", days => `${countIn(result.philipp.upgradeDays, ...days)} / ${countIn(result.partner.upgradeDays, ...days)}`],
    ["Tage blockiert (Philipp / Partnerin)", days => `${countIn([...new Set(result.philipp.blockedDays)], ...days)} / ${countIn([...new Set(result.partner.blockedDays)], ...days)}`]
  ];
  return `
    <section class="panel milestone-panel">
      <span class="eyebrow">Langzeit</span>
      <h3>Erstes Jahr gegen zweites Jahr</h3>
      <table class="milestones years">
        <thead><tr><th></th><th>Woche 1–52</th><th>Woche 53–${year2End / 7}</th></tr></thead>
        <tbody>${rows.map(([label, count]) => `<tr><td>${label}</td><td>${count([0, 364])}</td><td>${count([364, year2End])}</td></tr>`).join("")}</tbody>
      </table>
    </section>`;
}

function renderChain() {
  return `
    <section class="chain panel" aria-label="Fortschrittskette">
      <div><b>Tagesziele</b><small>3 je Person</small></div><span>→</span>
      <div><b>Energie</b><small>persönlich, verfällt nie</small></div><span>→</span>
      <div><b>Bauen / Aufwerten / Einzahlen</b><small>verbaut eigene Energie</small></div><span>→</span>
      <div><b>Eigene Hälfte</b><small>des 50/50-Balkens</small></div><span>→</span>
      <div><b>Level</b><small>Baupläne, Gebiete, Inseln</small></div>
    </section>`;
}

function segmented(label, key, values, format) {
  return `
    <fieldset>
      <legend>${label}</legend>
      ${values.map(value => `<button class="period ${value === appState[key] ? "active" : ""}" data-key="${key}" data-value="${value}">${format(value)}</button>`).join("")}
    </fieldset>`;
}

function renderMilestones(result) {
  if (!result.events.length) return `<p class="muted">Noch kein Levelaufstieg im Zeitraum.</p>`;
  const special = result.events.filter(event => event.type !== "change");
  const firstLevels = result.events.slice(0, 4);
  const rows = [...new Map([...firstLevels, ...special].map(event => [event.level, event])).values()]
    .sort((a, b) => a.level - b.level);
  return `<table class="milestones">
    <thead><tr><th>Woche</th><th>Tag</th><th>Level</th><th>Was neu ist</th></tr></thead>
    <tbody>${rows.map(event => `<tr class="${event.type}"><td>${event.week}</td><td>${event.day}</td><td>${event.level}</td><td>${event.label}</td></tr>`).join("")}</tbody>
  </table>
  <p class="muted">Gezeigt: die ersten vier Level, alle Gebiete und Inseln. Jedes weitere Level bringt einen Bauplan je Rolle.</p>`;
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
  const maxLevel = Math.max(result.level, 2);
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
  const yearLine = weeks > 52 ? `<g class="year"><line x1="${x(52)}" x2="${x(52)}" y1="${pad.top}" y2="${height - pad.bottom}"/><text x="${x(52) + 6}" y="${pad.top + 4}">Jahr 2</text></g>` : "";
  const markers = result.events.map(event => `<circle class="${event.type}" cx="${x(event.day / 7)}" cy="${y(event.level)}" r="${event.type === "change" ? 3 : 6}"><title>Woche ${event.week}: Level ${event.level} – ${event.label}</title></circle>`).join("");
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Levelverlauf über ${weeks} Wochen">
    <g class="grid">${grid}</g>
    ${yearLine}
    <polyline points="${points}"/>
    <g class="markers">${markers}</g>
    <text class="axis-label" x="${width / 2}" y="${height - 4}">Wochen</text>
  </svg>`;
}

function fmt(value) {
  return value.toFixed(1).replace(".", ",");
}

function fieldText(value) {
  return Number.isFinite(value) ? String(value) : "unbegrenzt";
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
