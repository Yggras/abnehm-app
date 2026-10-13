// PROTOTYP — wegwerfbar. Drei Varianten von Hauptbildschirm + Navigation, switchbar über ?variant=A|B|C.
const variants = {
  A: "Momo-Zentrum · Tabs mit +",
  B: "Protokoll zuerst · 3 Tabs",
  C: "Wischseiten · Erfassungsleiste"
};

const MEALS = ["Frühstück", "Mittagessen", "Abendessen", "Snacks"];
const RECENT = [
  { name: "Apfel", amount: 150, unit: "g", kcal: 78 },
  { name: "Vollkornbrot mit Käse", amount: 90, unit: "g", kcal: 245 },
  { name: "Naturjoghurt 3,5 %", amount: 150, unit: "g", kcal: 99 }
];

const initialState = () => ({
  solo: false,
  page: { A: "heute", B: "heute", C: "ich" },
  level: 4,
  me: {
    name: "Philipp",
    budget: 2100,
    meals: {
      "Frühstück": [{ name: "Haferflocken mit Milch", amount: 250, unit: "g", kcal: 420 }],
      "Mittagessen": [{ name: "Linsensuppe", amount: 400, unit: "ml", kcal: 520, photo: true }, { name: "Brötchen", amount: 60, unit: "g", kcal: 160 }],
      "Abendessen": [],
      "Snacks": []
    },
    waterMl: 1000, waterGoal: 1500,
    sportTodayMin: 0, sportWeekMin: 60, sportWeekGoal: 150, sportDays: 3,
    weight: null, lastWeight: 92.4,
    // Samstag = Sporttag im Standard-Wochenplan (Ziele und Onboarding festlegen, #14)
    goals: ["Ernährung erfasst", "Wasserziel", "Sporteinheit"]
  },
  partner: {
    name: "Partnerin",
    goals: [["Ernährung erfasst", true], ["Wasserziel", false], ["Im Kalorienbudget", false]],
    waterPct: 80, sportWeekMin: 90, sportWeekGoal: 150, mealsLogged: 3
  },
  cheersIn: 0,
  sheet: null,
  lastEvent: "Samstag, 10. Oktober · 17:30"
});

let state = initialState();
let toastTimer;
const app = document.querySelector("#app");
const sheetRoot = document.querySelector("#sheet-root");
const stateOutput = document.querySelector("#state-output");
const label = document.querySelector("#variant-label");

function currentVariant() {
  const value = new URLSearchParams(location.search).get("variant")?.toUpperCase();
  return variants[value] ? value : "A";
}

// ---- abgeleitete Werte ----
const eaten = () => MEALS.flatMap(m => state.me.meals[m]).reduce((s, e) => s + e.kcal, 0);
const mealsLogged = () => MEALS.filter(m => state.me.meals[m].length).length;
function goalDone(goal) {
  const me = state.me;
  if (goal === "Ernährung erfasst") return mealsLogged() >= 2;
  if (goal === "Wasserziel") return me.waterMl >= me.waterGoal;
  if (goal === "Sporteinheit") return me.sportTodayMin >= Math.round(me.sportWeekGoal / me.sportDays);
  if (goal === "Gewogen") return me.weight !== null;
  return false;
}
function goalHint(goal) {
  const me = state.me;
  if (goal === "Ernährung erfasst") return `${mealsLogged()} von 2 Mahlzeiten`;
  if (goal === "Wasserziel") return `${fmtL(me.waterMl)} von ${fmtL(me.waterGoal)}`;
  if (goal === "Sporteinheit") return `${me.sportTodayMin} von ${Math.round(me.sportWeekGoal / me.sportDays)} min`;
  return "";
}
const myDone = () => state.me.goals.filter(goalDone).length;
const partnerDone = () => state.partner.goals.filter(g => g[1]).length;
const half = done => Math.min(100, 60 + done * 10 + (done === 3 ? 10 : 0));
const fmtL = ml => `${(ml / 1000).toLocaleString("de-DE", { maximumFractionDigits: 2 })} l`;
const pct = (a, b) => Math.min(100, Math.round((a / b) * 100));

// ---- gemeinsame Bausteine (bewusst klein; Layout gehört der Variante) ----
function momoFigure(size = "big") {
  if (state.solo) return `<div class="momo momo--${size} momo--egg" aria-label="Momo als Ei">🥚</div>`;
  const mood = myDone() === 3 && partnerDone() === 3 ? "✨" : myDone() + partnerDone() > 0 ? "🌟" : "☀️";
  return `<div class="momo momo--${size}"><span>🐲</span><i>${mood}</i></div>`;
}
function levelBar() {
  if (state.solo) return `<div class="levelbar levelbar--egg"><small>Momo wartet als Ei, bis ihr gekoppelt seid.</small></div>`;
  return `<div class="levelbar" aria-label="Momos Levelbalken">
    <div class="levelbar__half"><i style="width:${half(myDone())}%"></i></div>
    <div class="levelbar__half levelbar__half--partner"><i style="width:${half(partnerDone())}%"></i></div>
  </div>
  <div class="levelbar__legend"><span>Du</span><b>Level ${state.level}</b><span>${state.partner.name}</span></div>`;
}
function goalChips(compact = false) {
  return `<ul class="goals ${compact ? "goals--compact" : ""}">${state.me.goals.map(g => `
    <li class="${goalDone(g) ? "done" : ""}"><b>${goalDone(g) ? "✓" : "○"}</b><span>${g}${compact ? "" : `<small>${goalHint(g)}</small>`}</span></li>`).join("")}</ul>`;
}
function kcalRing(size = 132) {
  const used = eaten(), left = state.me.budget - used, p = pct(used, state.me.budget);
  const r = 52, c = 2 * Math.PI * r;
  return `<div class="ring" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="${r}" class="ring__bg"/><circle cx="60" cy="60" r="${r}" class="ring__fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p / 100)}"/></svg>
    <div><b>${left >= 0 ? left : -left}</b><small>${left >= 0 ? "kcal übrig" : "kcal drüber"}</small></div></div>`;
}
function partnerSummary() {
  if (state.solo) return `<div class="partner partner--invite"><b>Noch kein Partner gekoppelt</b><p>Teile einen Einladungscode, dann schlüpft Momo.</p><button data-act="invite">Partner einladen</button></div>`;
  const p = state.partner;
  return `<div class="partner">
    <div class="partner__head"><span class="avatar">P</span><div><b>${p.name}</b><small>${partnerDone()} von 3 Tageszielen</small></div></div>
    <ul class="partner__areas">
      <li>Ernährung · ${p.mealsLogged} Mahlzeiten erfasst</li>
      <li>Wasser · ${p.waterPct} %</li>
      <li>Sport · ${p.sportWeekMin}/${p.sportWeekGoal} min diese Woche</li>
    </ul>
    <div class="partner__actions"><button data-act="cheer">💛 Anfeuern</button><button data-act="nudge">👋 Stupsen</button></div>
  </div>`;
}
function cheerBanner() {
  return state.cheersIn ? `<div class="cheer-in">💛 ${state.partner.name} feuert dich an${state.cheersIn > 1 ? ` (${state.cheersIn}×)` : ""}</div>` : "";
}
function mealList() {
  return MEALS.map(m => {
    const entries = state.me.meals[m];
    const sum = entries.reduce((s, e) => s + e.kcal, 0);
    return `<section class="meal"><header><b>${m}</b><span>${sum ? `${sum} kcal` : ""}</span><button data-act="add-food" data-meal="${m}" aria-label="${m} hinzufügen">+</button></header>
      ${entries.map(e => `<div class="entry"><span>${e.photo ? "📷 " : ""}${e.name}<small>${e.amount} ${e.unit}</small></span><b>${e.kcal}</b></div>`).join("")}</section>`;
  }).join("");
}
function miniTrackers() {
  const me = state.me;
  return `<div class="minis">
    <div class="mini"><span>💧 Wasser</span><b>${fmtL(me.waterMl)}</b><div class="bar"><i style="width:${pct(me.waterMl, me.waterGoal)}%"></i></div><button data-act="water" data-ml="250">+ 250 ml</button></div>
    <div class="mini"><span>🏃 Sport (Woche)</span><b>${me.sportWeekMin} / ${me.sportWeekGoal} min</b><div class="bar"><i style="width:${pct(me.sportWeekMin, me.sportWeekGoal)}%"></i></div><button data-act="open" data-sheet="sport">+ Einheit</button></div>
    <div class="mini"><span>⚖️ Gewicht</span><b>${me.weight ? `${me.weight.toLocaleString("de-DE")} kg` : "nächster Wiegetag: Mo"}</b><div class="bar bar--trend"></div><button data-act="open" data-sheet="weight">Eintragen</button></div>
  </div>`;
}
function placeholder(title, text) {
  return `<section class="placeholder"><h2>${title}</h2><p>${text}</p><p class="placeholder__note">Nicht Teil dieses Prototyps – nur, damit die Navigation greifbar ist.</p></section>`;
}

// ---- Variante A: Momo-Zentrum, 5 Tabs mit mittlerem + ----
function renderA() {
  const page = state.page.A;
  let body;
  if (page === "heute") body = `
    <header class="a-top"><div><p class="eyebrow">Heute · Samstag</p><h1>Hallo Philipp</h1></div><button class="icon" data-act="go" data-page="einstellungen" aria-label="Einstellungen">⚙︎</button></header>
    ${cheerBanner()}
    <section class="a-momo">${momoFigure("big")}${levelBar()}${goalChips()}</section>
    <section class="a-row">${kcalRing(120)}<div class="a-row__side"><p><b>${eaten()}</b> von ${state.me.budget} kcal</p><button class="ghost" data-act="go" data-page="tagebuch">Tagesprotokoll ›</button></div></section>
    ${miniTrackers()}
    ${partnerSummary()}`;
  else if (page === "tagebuch") body = `<header class="a-top"><div><p class="eyebrow">Tagesprotokoll</p><h1>Samstag</h1></div></header>${mealList()}`;
  else if (page === "momo") body = placeholder("Momo", "Großansicht von Momo, Levelgeschichte, Entwicklungsformen, Wochenplan der Momo-Ziele.");
  else if (page === "wir") body = placeholder("Wir", "Partner-Details im freigegebenen Umfang, Verlauf der Anfeuerungen, gemeinsame Challenges.");
  else body = placeholder("Einstellungen", "Ziele, Wochenplan, Sichtbarkeit, Health-Verbindung, Benachrichtigungen, Kopplung.");
  const tab = (id, icon, text) => `<button class="${page === id ? "active" : ""}" data-act="go" data-page="${id}"><i>${icon}</i>${text}</button>`;
  return `<div class="screen a">${'<div class="scroll">' + body + "</div>"}
    <nav class="a-tabs">${tab("heute", "🏠", "Heute")}${tab("tagebuch", "📖", "Protokoll")}<button class="a-plus" data-act="open" data-sheet="menu" aria-label="Erfassen">+</button>${tab("momo", "🐲", "Momo")}${tab("wir", "💞", "Wir")}</nav></div>`;
}

// ---- Variante B: Protokoll zuerst, 3 Tabs, Momo als Abzeichen ----
function renderB() {
  const page = state.page.B;
  let body;
  if (page === "heute") {
    const left = state.me.budget - eaten();
    body = `
    <header class="b-top">
      <div><p class="eyebrow">Samstag, 10. Oktober</p><h1>${left} kcal übrig</h1><div class="bar bar--big"><i style="width:${pct(eaten(), state.me.budget)}%"></i></div><small>${eaten()} gegessen · Budget ${state.me.budget}</small></div>
      <button class="b-badge" data-act="open" data-sheet="momo" aria-label="Momo öffnen">${momoFigure("small")}<span>${state.solo ? "Ei" : `${myDone()}/3`}</span></button>
    </header>
    ${cheerBanner()}
    <div class="b-chips">
      <button data-act="water" data-ml="250">💧 ${fmtL(state.me.waterMl)} <b>+250</b></button>
      <button data-act="open" data-sheet="sport">🏃 ${state.me.sportTodayMin} min <b>+</b></button>
      <button data-act="open" data-sheet="weight">⚖️ <b>Wiegen</b></button>
    </div>
    ${goalChips(true)}
    ${mealList()}
    ${state.solo ? "" : `<button class="b-partner" data-act="go" data-page="wir"><span class="avatar">P</span>${state.partner.name}: ${partnerDone()} von 3 Tageszielen <b>›</b></button>`}`;
  } else if (page === "wir") body = `<header class="b-top"><div><p class="eyebrow">Wir</p><h1>Momo &amp; ${state.partner.name}</h1></div></header><section class="a-momo">${momoFigure("big")}${levelBar()}</section>${partnerSummary()}`;
  else body = placeholder("Fortschritt", "Gewichtstrendlinie, Wochenrückblick Kalorien/Wasser/Sport, Momo-Levelgeschichte.");
  const tab = (id, icon, text) => `<button class="${page === id ? "active" : ""}" data-act="go" data-page="${id}"><i>${icon}</i>${text}</button>`;
  return `<div class="screen b"><div class="scroll">${body}</div>
    <nav class="b-tabs">${tab("heute", "📋", "Heute")}${tab("fortschritt", "📈", "Fortschritt")}${tab("wir", "💞", "Wir")}</nav></div>`;
}

// ---- Variante C: drei Wischseiten (Ich · Momo · Wir) + feste Erfassungsleiste ----
function renderC() {
  const page = state.page.C;
  const pages = { ich: "Ich", momo: "Momo", wir: "Wir" };
  let body;
  if (page === "ich") body = `
    <div class="c-hero">${kcalRing(170)}<p>${eaten()} von ${state.me.budget} kcal</p></div>
    ${goalChips()}
    <details class="c-protocol"><summary>Tagesprotokoll anzeigen</summary>${mealList()}</details>
    ${miniTrackers()}`;
  else if (page === "momo") body = `<section class="c-momo">${momoFigure("huge")}${levelBar()}<p class="c-momo__copy">${state.solo ? "Lade deinen Partner ein, dann schlüpft Momo." : "Jedes erledigte Tagesziel füllt eure Hälfte des Balkens."}</p></section>${goalChips(true)}`;
  else body = `${partnerSummary()}${state.solo ? "" : `<section class="placeholder"><p>Hier später: gemeinsame Challenges, Verlauf der Anfeuerungen.</p></section>`}`;
  return `<div class="screen c">
    <header class="c-top"><div class="c-seg">${Object.entries(pages).map(([id, t]) => `<button class="${page === id ? "active" : ""}" data-act="go" data-page="${id}">${t}</button>`).join("")}</div><button class="icon" aria-label="Einstellungen">⚙︎</button></header>
    ${cheerBanner()}
    <div class="scroll" id="c-scroll">${body}<p class="c-dots">${Object.keys(pages).map(id => id === page ? "●" : "○").join(" ")} · wischen</p></div>
    <nav class="c-dock"><button data-act="open" data-sheet="food">🍽<span>Essen</span></button><button data-act="water" data-ml="250">💧<span>+250 ml</span></button><button data-act="open" data-sheet="sport">🏃<span>Sport</span></button><button data-act="open" data-sheet="weight">⚖️<span>Gewicht</span></button></nav>
  </div>`;
}

// ---- Erfassungs-Sheets (Stub, nichts wird gespeichert) ----
function renderSheet() {
  const s = state.sheet;
  if (!s) return "";
  let inner = "";
  if (s.type === "menu") inner = `<h2>Was möchtest du erfassen?</h2><div class="sheet__grid">
      <button data-act="open" data-sheet="food">🍽<span>Essen</span></button><button data-act="water" data-ml="250">💧<span>+250 ml Wasser</span></button>
      <button data-act="open" data-sheet="sport">🏃<span>Sport</span></button><button data-act="open" data-sheet="weight">⚖️<span>Gewicht</span></button></div>`;
  else if (s.type === "food") inner = `<h2>Zu welcher Mahlzeit?</h2><div class="sheet__list">${MEALS.map(m => `<button data-act="add-food" data-meal="${m}">${m}</button>`).join("")}</div>`;
  else if (s.type === "add") inner = `<h2>${s.meal} hinzufügen</h2><input placeholder="Lebensmittel suchen …" disabled>
      <div class="sheet__grid sheet__grid--two"><button disabled>▥<span>Barcode scannen</span></button><button disabled>📷<span>Foto aufnehmen</span></button></div>
      <p class="eyebrow">Zuletzt verwendet</p><div class="sheet__list">${RECENT.map((r, i) => `<button data-act="review" data-i="${i}">${r.name}<small>${r.amount} ${r.unit} · ${r.kcal} kcal</small></button>`).join("")}</div>`;
  else if (s.type === "review") { const r = RECENT[s.i]; inner = `<h2>${r.name}</h2><p class="review__kcal">${r.kcal} kcal</p><p>${r.amount} ${r.unit} · ${s.meal}</p><button class="primary" data-act="commit-food">Hinzufügen</button>`; }
  else if (s.type === "sport") inner = `<h2>Sporteinheit</h2><div class="sheet__list"><button data-act="sport" data-min="30">Spaziergang · 30 min</button><button data-act="sport" data-min="50">Radfahren · 50 min</button></div><p class="sheet__note">Sportkalorien werden nur angezeigt, nicht aufs Budget gutgeschrieben.</p>`;
  else if (s.type === "weight") inner = `<h2>Gewicht eintragen</h2><p class="review__kcal">${state.me.lastWeight.toLocaleString("de-DE")} kg</p><p>Vorausgefüllt mit dem letzten Wert</p><button class="primary" data-act="weigh">Speichern</button>`;
  else if (s.type === "momo") inner = `<div class="a-momo">${momoFigure("big")}${levelBar()}${goalChips()}</div>`;
  return `<div class="sheet-backdrop" data-act="close"></div><div class="sheet" role="dialog">${inner}<button class="sheet__close" data-act="close">Schließen</button></div>`;
}

// ---- Rendering & Ereignisse ----
function render() {
  const v = currentVariant();
  app.innerHTML = { A: renderA, B: renderB, C: renderC }[v]();
  sheetRoot.innerHTML = renderSheet();
  label.textContent = `${v} — ${variants[v]}`;
  stateOutput.textContent = JSON.stringify({ variante: v, ...state, abgeleitet: { gegessen: eaten(), meineZiele: myDone(), partnerZiele: partnerDone(), meineHälfte: half(myDone()), partnerHälfte: half(partnerDone()) } }, null, 2);
}
function toast(text) {
  const el = document.querySelector("#toast");
  el.textContent = text; el.classList.add("visible");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("visible"), 2200);
}
function afterProgress(before) {
  if (myDone() > before) toast(myDone() === 3 ? "Alle drei Tagesziele! Momo freut sich riesig ✨" : "Tagesziel erledigt – Momo freut sich 🌟");
  if (!state.solo && half(myDone()) === 100 && half(partnerDone()) === 100) {
    state.level += 1; toast(`Levelaufstieg! Momo ist jetzt Level ${state.level} 🎉`);
  }
}

document.addEventListener("click", ev => {
  const el = ev.target.closest("[data-act]");
  if (!el) return;
  const v = currentVariant(), before = myDone(), d = el.dataset;
  switch (d.act) {
    case "go": state.page[v] = d.page; state.sheet = null; break;
    case "open": state.sheet = { type: d.sheet }; break;
    case "close": state.sheet = null; break;
    case "add-food": state.sheet = { type: "add", meal: d.meal }; break;
    case "review": state.sheet = { ...state.sheet, type: "review", i: Number(d.i) }; break;
    case "commit-food": state.me.meals[state.sheet.meal].push({ ...RECENT[state.sheet.i] }); toast(`${RECENT[state.sheet.i].name} → ${state.sheet.meal}`); state.sheet = null; break;
    case "water": state.me.waterMl += Number(d.ml); state.sheet = null; toast(`+${d.ml} ml Wasser`); break;
    case "sport": state.me.sportTodayMin += Number(d.min); state.me.sportWeekMin += Number(d.min); state.sheet = null; toast(`${d.min} min Sport erfasst`); break;
    case "weigh": state.me.weight = state.me.lastWeight; state.sheet = null; toast("Gewicht gespeichert"); break;
    case "cheer": toast(`💛 ${state.partner.name} wurde angefeuert`); break;
    case "nudge": toast(`👋 Freundlicher Stupser an ${state.partner.name} gesendet`); break;
    case "invite": toast("Einladungscode 482 913 – über Teilen-Menü versenden"); break;
  }
  afterProgress(before);
  render();
});

document.querySelectorAll("[data-sim]").forEach(b => b.addEventListener("click", () => {
  const sim = b.dataset.sim;
  if (sim === "partner-goal") { const open = state.partner.goals.find(g => !g[1]); if (open) open[1] = true; state.partner.waterPct = 100; afterProgress(myDone()); }
  if (sim === "cheer-in") state.cheersIn += 1;
  if (sim === "solo") state.solo = !state.solo;
  if (sim === "reset") { const page = state.page; state = initialState(); state.page = page; }
  render();
}));

document.querySelector("#lab-toggle").addEventListener("click", () => {
  const lab = document.querySelector("#lab");
  lab.classList.toggle("collapsed");
  document.querySelector("#lab-toggle").setAttribute("aria-expanded", String(!lab.classList.contains("collapsed")));
});

function cycle(step) {
  const keys = Object.keys(variants);
  const next = keys[(keys.indexOf(currentVariant()) + step + keys.length) % keys.length];
  const url = new URL(location.href); url.searchParams.set("variant", next);
  history.replaceState(null, "", url); state.sheet = null; render();
}
document.querySelector("#previous").addEventListener("click", () => cycle(-1));
document.querySelector("#next").addEventListener("click", () => cycle(1));
document.addEventListener("keydown", e => {
  if (e.target.closest("input, textarea, [contenteditable]")) return;
  if (e.key === "ArrowLeft") cycle(-1);
  if (e.key === "ArrowRight") cycle(1);
});

// Wischgeste nur in Variante C
let touchX = null;
app.addEventListener("touchstart", e => { touchX = e.touches[0].clientX; }, { passive: true });
app.addEventListener("touchend", e => {
  if (currentVariant() !== "C" || touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX, order = ["ich", "momo", "wir"];
  const i = order.indexOf(state.page.C);
  if (Math.abs(dx) > 60) { state.page.C = order[Math.max(0, Math.min(2, i + (dx < 0 ? 1 : -1)))]; render(); }
  touchX = null;
});

render();
