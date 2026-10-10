// PROTOTYP: Drei Designvarianten beantworten die Frage, welche Punkteverteilung,
// Levelkurve und Entwicklungsabfolge über unterschiedliche Wochenverläufe
// motivierend wirkt. Alle Werte sind Designvorschläge, keine belegten Fakten.

const VARIANTS = {
  A: {
    key: "A",
    name: "Kurze, feste Level",
    tagline: "Ein gleichmäßiger Takt: Jedes Level braucht gleich viel.",
    goalPoints: 10,
    dayBonus: 10,
    requirement(level) { return 200; },
    formAt(level) { return level === 1 || level % 10 === 0; },
    formLabel(level) { return level === 1 ? "Momo schlüpft" : `Große Form ${level / 10 + 1}`; },
    explanation: "Maximal 40 Punkte pro Person und Tag. Jede Hälfte braucht immer 200 Punkte. Eine große Entwicklung kommt alle 10 Level.",
    tradeoff: "Sehr leicht zu verstehen, kann aber nach Monaten eintönig werden und erzeugt sehr viele Level."
  },
  B: {
    key: "B",
    name: "Sanft ansteigend",
    tagline: "Schneller Anfang, danach werden die Etappen allmählich länger.",
    goalPoints: 10,
    dayBonus: 10,
    requirement(level) { return Math.min(120 + (level - 1) * 20, 400); },
    formAt(level) { return [1, 4, 8, 13, 19, 26, 34, 43].includes(level); },
    formLabel(level) { return level === 1 ? "Momo schlüpft" : `Große Form ${[1, 4, 8, 13, 19, 26, 34, 43].indexOf(level) + 1}`; },
    explanation: "Maximal 40 Punkte pro Person und Tag. Die erste Hälfte braucht 120 Punkte; der Bedarf steigt je Level um 20 bis maximal 400. Große Formen liegen zunehmend weiter auseinander.",
    tradeoff: "Der Einstieg belohnt schnell und die Kurve hält länger, spätere Level können sich aber zäher anfühlen."
  },
  C: {
    key: "C",
    name: "Entwicklung in Kapiteln",
    tagline: "Sechs unterschiedlich lange Level bilden jeweils eine erkennbare Entwicklungsphase.",
    goalPoints: 10,
    dayBonus: 10,
    requirement(level) { return [120, 160, 200, 240, 280, 320][(level - 1) % 6]; },
    formAt(level) { return level === 1 || (level - 1) % 6 === 0; },
    formLabel(level) { return level === 1 ? "Momo schlüpft" : `Große Form ${Math.floor((level - 1) / 6) + 1}`; },
    explanation: "Maximal 40 Punkte pro Person und Tag. Ein Kapitel hat sechs Level von 120 bis 320 Punkten; danach entwickelt sich Momo groß und die kurze Kurve beginnt erneut.",
    tradeoff: "Große Entwicklungen bleiben regelmäßig erreichbar; der Neustart der Kurve muss als neues Kapitel verständlich erklärt werden."
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

const appState = {
  variant: readVariant(),
  scenario: "everyday",
  weeks: 12
};

function readVariant() {
  const requested = new URLSearchParams(location.search).get("variant")?.toUpperCase();
  return VARIANTS[requested] ? requested : "A";
}

function pointsForDay(completedGoals, variant) {
  return completedGoals * variant.goalPoints + (completedGoals === 3 ? variant.dayBonus : 0);
}

function simulate(variant, scenario, weeks) {
  const state = {
    level: 1,
    philippBank: 0,
    partnerBank: 0,
    totalPhilipp: 0,
    totalPartner: 0,
    completedLevels: 0,
    events: [],
    weekly: []
  };

  const totalDays = weeks * 7;
  for (let day = 0; day < totalDays; day += 1) {
    const pGoals = scenario.philipp[day % scenario.philipp.length];
    const qGoals = scenario.partner[day % scenario.partner.length];
    const pPoints = pointsForDay(pGoals, variant);
    const qPoints = pointsForDay(qGoals, variant);
    state.philippBank += pPoints;
    state.partnerBank += qPoints;
    state.totalPhilipp += pPoints;
    state.totalPartner += qPoints;

    let requirement = variant.requirement(state.level);
    while (state.philippBank >= requirement && state.partnerBank >= requirement) {
      state.philippBank -= requirement;
      state.partnerBank -= requirement;
      state.completedLevels += 1;
      state.level += 1;
      const isForm = variant.formAt(state.level);
      state.events.push({
        day: day + 1,
        week: Math.floor(day / 7) + 1,
        level: state.level,
        type: isForm ? "form" : "change",
        label: isForm ? variant.formLabel(state.level) : "Kleine Veränderung"
      });
      requirement = variant.requirement(state.level);
    }

    if ((day + 1) % 7 === 0) {
      const currentRequirement = variant.requirement(state.level);
      state.weekly.push({
        week: (day + 1) / 7,
        level: state.level,
        philipp: Math.min(state.philippBank / currentRequirement, 1),
        partner: Math.min(state.partnerBank / currentRequirement, 1)
      });
    }
  }

  return state;
}

function formatDays(points, variant) {
  const max = variant.goalPoints * 3 + variant.dayBonus;
  return `${Math.ceil(points / max)} perfekte Tage`;
}

function render() {
  const variant = VARIANTS[appState.variant];
  const scenario = SCENARIOS[appState.scenario];
  const result = simulate(variant, scenario, appState.weeks);
  const requirement = variant.requirement(result.level);
  const nextForms = [];
  for (let level = result.level + 1; nextForms.length < 2 && level < result.level + 60; level += 1) {
    if (variant.formAt(level)) nextForms.push(level);
  }

  document.getElementById("variant-label").textContent = `${variant.key} — ${variant.name}`;
  document.getElementById("app").innerHTML = `
    <section class="variant-intro">
      <div>
        <span class="eyebrow">Variante ${variant.key}</span>
        <h2>${variant.name}</h2>
        <p class="tagline">${variant.tagline}</p>
      </div>
      <div class="formula">
        <strong>${variant.goalPoints}</strong><span>Punkte je Ziel</span>
        <strong>+${variant.dayBonus}</strong><span>Bonus bei 3 von 3</span>
      </div>
    </section>

    <section class="controls panel">
      <div>
        <label for="scenario">Wochenverlauf</label>
        <select id="scenario">
          ${Object.entries(SCENARIOS).map(([key, value]) => `<option value="${key}" ${key === appState.scenario ? "selected" : ""}>${value.name}</option>`).join("")}
        </select>
        <p>${scenario.description}</p>
      </div>
      <fieldset>
        <legend>Zeitraum</legend>
        ${[4, 12, 26, 52].map(weeks => `<button class="period ${weeks === appState.weeks ? "active" : ""}" data-weeks="${weeks}">${weeks} Wochen</button>`).join("")}
      </fieldset>
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
          <p>${result.completedLevels} Levelaufstiege · ${result.events.filter(event => event.type === "form").length} große Entwicklungen</p>
        </div>
      </article>

      <article class="progress-card panel">
        <div class="progress-title"><strong>Aktueller 50/50-Balken</strong><span>${requirement} Punkte je Hälfte</span></div>
        ${personProgress("Philipp", result.philippBank, requirement, "philipp")}
        ${personProgress("Partnerin", result.partnerBank, requirement, "partner")}
        <p class="bank-note">Überschüssige Punkte bleiben erhalten. Sichtbar ist höchstens eine volle Hälfte; der Rest wartet auf das nächste Level.</p>
      </article>
    </section>

    <section class="panel chart-panel">
      <div class="section-heading">
        <div><span class="eyebrow">Verlauf</span><h3>Momos Level über die Zeit</h3></div>
        <div class="legend"><span><i class="dot change"></i>Kleine Veränderung</span><span><i class="dot form"></i>Große Form</span></div>
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
        <span class="eyebrow">Nächste Etappen</span>
        <dl class="metrics">
          <div><dt>Nächstes Level</dt><dd>${requirement} Punkte je Person<br><small>${formatDays(requirement, variant)} ab leerem Balken</small></dd></div>
          <div><dt>Nächste große Formen</dt><dd>${nextForms.length ? nextForms.map(level => `Level ${level}`).join(" und ") : "—"}</dd></div>
          <div><dt>Gesammelte Punkte</dt><dd>${result.totalPhilipp.toLocaleString("de-DE")} / ${result.totalPartner.toLocaleString("de-DE")}<br><small>Philipp / Partnerin</small></dd></div>
        </dl>
      </article>
    </section>

    <details class="state panel">
      <summary>Vollständigen Simulationszustand anzeigen</summary>
      <pre>${escapeHtml(JSON.stringify({ variant: variant.key, scenario: appState.scenario, weeks: appState.weeks, ...result }, null, 2))}</pre>
    </details>
  `;

  document.getElementById("scenario").addEventListener("change", event => {
    appState.scenario = event.target.value;
    render();
  });
  document.querySelectorAll("[data-weeks]").forEach(button => button.addEventListener("click", () => {
    appState.weeks = Number(button.dataset.weeks);
    render();
  }));
}

function personProgress(name, bank, requirement, className) {
  const visible = Math.min(bank, requirement);
  const percent = Math.round(visible / requirement * 100);
  const overflow = Math.max(bank - requirement, 0);
  return `
    <div class="person-progress ${className}">
      <div><strong>${name}</strong><span>${visible} / ${requirement}${overflow ? ` · +${overflow} vorgemerkt` : ""}</span></div>
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
  const points = [{ week: 0, level: 1 }, ...result.weekly].map(point => `${x(point.week)},${y(point.level)}`).join(" ");
  const gridLevels = [...new Set([1, Math.ceil(maxLevel / 2), maxLevel])];
  const grid = gridLevels.map(level => `<g><line x1="${pad.left}" x2="${width - pad.right}" y1="${y(level)}" y2="${y(level)}"/><text x="${pad.left - 8}" y="${y(level) + 4}">${level}</text></g>`).join("");
  const markers = result.events.map(event => `<circle class="${event.type}" cx="${x(event.week)}" cy="${y(event.level)}" r="${event.type === "form" ? 6 : 3}"><title>Woche ${event.week}: ${event.label}, Level ${event.level}</title></circle>`).join("");
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Levelverlauf über ${weeks} Wochen">
    <g class="grid">${grid}</g>
    <polyline points="${points}"/>
    <g class="markers">${markers}</g>
    <text class="axis-label" x="${width / 2}" y="${height - 4}">Wochen</text>
  </svg>`;
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
