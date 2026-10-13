// PROTOTYP — wegwerfbar. Drei Varianten für Tab „Wir“ und Einstellungen, switchbar über ?variant=A|B|C.
const variants = {
  A: "Überblick · alles Wichtige zuerst",
  B: "Miteinander · Aktivitätsstrom",
  C: "Zwei Welten · Gesundheit & Insel"
};

const initialState = () => ({
  page: "wir",
  settingsPage: "root",
  solo: false,
  proposal: true,
  cheersIn: 1,
  cheersSent: 1,
  challenge: { title: "Gut getrunken", stage: "gut unterwegs", mine: 4, mineGoal: 6, daysLeft: 3 },
  project: { title: "Brücke zum Nordufer", mine: 14, mineGoal: 20, partnerStage: "gut unterwegs" },
  permissions: { calories: true, water: true, sport: true, weight: false, photos: true },
  notifications: { noon: true, noonAt: "13:00", evening: true, eveningAt: "19:00", food: true, water: true, sport: true, weight: true, partner: true, system: false }
});
let state = initialState();
let toastTimer;
const app = document.querySelector("#app");
const sheetRoot = document.querySelector("#sheet-root");
const label = document.querySelector("#variant-label");

function currentVariant() {
  const value = new URLSearchParams(location.search).get("variant")?.toUpperCase();
  return variants[value] ? value : "A";
}
const icon = (symbol, cls = "") => `<span class="round-icon ${cls}">${symbol}</span>`;
const progress = value => `<div class="progress"><i style="width:${value}%"></i></div>`;
const back = title => `<header class="subhead"><button data-act="settings-root" aria-label="Zurück">‹</button><h1>${title}</h1></header>`;

function appHeader(subtitle = "Gemeinsam unterwegs") {
  return `<header class="top"><div><p class="eyebrow">${subtitle}</p><h1>${state.solo ? "Noch zu zweit werden" : "Philipp & Anna"}</h1></div><button class="gear" data-act="settings" aria-label="Einstellungen">⚙︎</button></header>`;
}
function bottomTabs() {
  return `<nav class="tabs"><button>⌂<small>Heute</small></button><button>▤<small>Protokoll</small></button><button class="plus">＋</button><button>🏝️<small>Momo</small></button><button class="active" data-act="wir">♥<small>Wir</small></button></nav>`;
}
function avatar() { return `<span class="avatar">A</span>`; }
function cheerButton(text = "Anna anfeuern") { return `<button class="primary" data-act="cheer">💛 ${text}</button>`; }
function partnerSummary(compact = false) {
  if (state.solo) return `<section class="empty"><div>🥚</div><h2>Momo wartet noch im Ei</h2><p>Lade deinen Partner mit einem einmaligen Code ein. Deine Tracker bleiben auch allein vollständig nutzbar.</p><button class="primary" data-act="invite">Partner einladen</button><button class="quiet" data-act="code">Code eingeben</button></section>`;
  return `<section class="partner-summary ${compact ? "compact" : ""}">
    <div class="partner-title">${avatar()}<div><h2>Anna</h2><p>2 von 3 Tageszielen · zuletzt vor 12 Min.</p></div><span class="online">●</span></div>
    <div class="summary-grid"><div><span>🍽️ Ernährung</span><b>3 Mahlzeiten</b></div><div><span>💧 Wasser</span><b>80 %</b></div><div><span>🏃 Sport</span><b>90 / 150 Min.</b></div><div><span>⚖️ Gewicht</span><b>Privat</b></div></div>
    ${cheerButton()}
  </section>`;
}
function proposal() {
  if (!state.proposal || state.solo) return "";
  return `<section class="proposal"><span>✉️</span><div><b>Anna schlägt eine Challenge vor</b><p>„Aktive Woche“ · Antwort bis morgen, 18:20</p></div><button data-act="proposal-open">Ansehen</button></section>`;
}
function challengeCard() {
  if (state.solo) return "";
  const c = state.challenge;
  return `<section class="card challenge"><div class="card-head"><span>7-TAGE-CHALLENGE</span><button data-act="challenge-detail">Details ›</button></div><h2>💧 ${c.title}</h2><p class="stage">${c.stage}</p>${progress(68)}<div class="split"><span>Du: <b>${c.mine}/${c.mineGoal}</b></span><span>Noch ${c.daysLeft} Tage</span></div><p class="soft">Annas genauer Stand bleibt bei ihr.</p></section>`;
}
function projectCard() {
  if (state.solo) return "";
  const p = state.project;
  return `<section class="card project"><div class="card-head"><span>GEMEINSCHAFTSPROJEKT</span><button data-act="island">Zur Insel ›</button></div><h2>🌉 ${p.title}</h2><div class="roles"><div><span>Dein Bau-Anteil</span>${progress(70)}<b>${p.mine}/${p.mineGoal} Energie</b></div><div><span>Annas Natur-Anteil</span>${progress(55)}<b>${p.partnerStage}</b></div></div><p class="soft">Ohne Frist · Eingezahlte Energie bleibt.</p></section>`;
}
function cheerHistory() {
  if (state.solo) return "";
  return `<section class="card"><div class="card-head"><span>ANFEUERN</span><button data-act="cheer-history">Alle ›</button></div><div class="message in">Anna · 10:14<br><b>Gemeinsam für Momo 🐣</b>${state.cheersIn ? `<button data-act="thanks">Danke ❤️</button>` : ""}</div><div class="message out">Du · gestern<br><b>Du schaffst das! 💪</b></div></section>`;
}

// A: klassischer Überblick mit klaren Arbeitskarten
function renderA() {
  return `${appHeader()}<div class="scroll a">${proposal()}${partnerSummary()}<h3 class="section-title">Gemeinsam</h3>${challengeCard()}${projectCard()}${cheerHistory()}</div>${bottomTabs()}`;
}

// B: sozialer Aktivitätsstrom; Aktionen und Neuigkeiten bestimmen die Hierarchie
function renderB() {
  if (state.solo) return `${appHeader("Miteinander")}<div class="scroll b">${partnerSummary()}</div>${bottomTabs()}`;
  return `${appHeader("Miteinander")}<div class="b-hero"><div>${avatar()}<span class="heart">♥</span><span class="avatar me">P</span></div><h2>Ihr seid heute beide dran</h2><p>4 von 6 Tageszielen sind geschafft</p>${cheerButton("Jetzt anfeuern")}</div><div class="scroll b">${proposal()}<h3 class="section-title">Euer Verlauf</h3><ol class="timeline"><li><i>💛</i><div><b>Anna feuert dich an</b><p>„Gemeinsam für Momo 🐣“ · 10:14</p><button data-act="thanks">Danke ❤️</button></div></li><li><i>💧</i><div><b>Challenge: gut unterwegs</b><p>„Gut getrunken“ · noch 3 Tage</p><button data-act="challenge-detail">Öffnen</button></div></li><li><i>🌉</i><div><b>Die Brücke wächst</b><p>Du hast 4 Energie verbaut · gestern</p><button data-act="island">Zur Insel</button></div></li><li><i>🎉</i><div><b>Challenge geschafft</b><p>„Ernährung im Blick“ · letzte Woche</p><span class="reward">Deko: Picknicktisch</span></div></li></ol></div>${bottomTabs()}`;
}

// C: gemeinsame Inhalte nach Gesundheit und Spielwelt getrennt
function renderC() {
  return `${appHeader("Euer gemeinsamer Raum")}<div class="scroll c">${proposal()}${partnerSummary(true)}${state.solo ? "" : `<div class="world health"><p class="eyebrow">GESUNDHEIT</p><h2>Gemeinsam dranbleiben</h2><p>Zusammenfassungen, Challenge und Anfeuern – ohne Vergleich.</p>${challengeCard()}<button class="secondary" data-act="cheer">💛 Anna anfeuern</button></div><div class="world island"><p class="eyebrow">MOMOS INSEL</p><h2>Euer gemeinsames Zuhause</h2><p>Projektfortschritt und die letzten gemeinsamen Momente.</p>${projectCard()}<div class="island-peek">🏡　🌳　🐲　🌉　🌼</div><button class="secondary" data-act="island">Insel öffnen</button></div>`}</div>${bottomTabs()}`;
}

function settingRow(symbol, title, detail, target, badge = "") {
  return `<button class="setting-row" data-act="settings-page" data-target="${target}">${icon(symbol)}<span><b>${title}</b><small>${detail}</small></span>${badge ? `<em>${badge}</em>` : ""}<i>›</i></button>`;
}
function settingsRoot() {
  return `${back("Einstellungen")}<div class="scroll settings"><section class="account">${icon("P", "profile")}<div><b>Philipp</b><small>philipp@example.de</small></div></section><h3>Dein Plan</h3><section class="list">${settingRow("◎", "Ziele", "Kalorienbudget, Wasser, Sport, Zielgewicht", "goals")}${settingRow("▦", "Wochenplan", "Sporttage, Wiegetag und Momos Tagesziele", "week")}</section><h3>Gemeinsam</h3><section class="list">${settingRow("♥", "Partner & Freigaben", state.solo ? "Nicht gekoppelt" : "Mit Anna gekoppelt", "partner")}${settingRow("🔔", "Benachrichtigungen", "Tages-Check-ins und Partner-Pushes", "notifications", state.notifications.system ? "" : "Aus")}</section><h3>Daten & Konto</h3><section class="list">${settingRow("＋", "Apple Health", "Verbunden · zuletzt vor 8 Min.", "health")}${settingRow("◉", "Konto", "Passwort und Abmelden", "account")}</section><p class="version">Abnehm-App · V1-Prototyp</p></div>`;
}
function toggleRow(key, title, note = "", group = "permissions") {
  const checked = state[group][key];
  return `<label class="toggle-row"><span><b>${title}</b>${note ? `<small>${note}</small>` : ""}</span><input type="checkbox" data-toggle="${key}" data-group="${group}" ${checked ? "checked" : ""}><i></i></label>`;
}
function partnerSettings() {
  if (state.solo) return `${back("Partner & Freigaben")}<div class="scroll settings">${partnerSummary()}</div>`;
  return `${back("Partner & Freigaben")}<div class="scroll settings"><section class="partner-settings-head">${avatar()}<div><b>Mit Anna gekoppelt</b><small>Momo und Insel seit 12. Oktober</small></div></section><p class="info">Anna sieht nur die Zusammenfassungen, die du hier freigibst. Einzelne Einträge bleiben privat.</p><h3>Gesundheitsbereiche</h3><section class="list toggles">${toggleRow("calories", "Ernährung", "Zusammenfassung: erfasste Mahlzeiten")}${toggleRow("water", "Wasser", "Zusammenfassung in Prozent")}${toggleRow("sport", "Sport", "Wochenfortschritt in Minuten")}${toggleRow("weight", "Gewicht", "Nur Trend und Veränderung, nie dein absolutes Gewicht")}</section><h3>Fotos</h3><section class="list toggles">${toggleRow("photos", "Mahlzeitenfotos teilen", "Separat von der Ernährungsfreigabe")}</section><p class="info">Abschalten beendet den Serverzugriff sofort. Bereits gemachte Screenshots kann die App nicht zurückrufen.</p><button class="danger" data-act="unlink">Partnerschaft entkoppeln</button></div>`;
}
function notificationSettings() {
  const n = state.notifications;
  return `${back("Benachrichtigungen")}<div class="scroll settings"><section class="system-status ${n.system ? "ok" : "warn"}"><b>${n.system ? "✓ Systembenachrichtigungen erlaubt" : "Systembenachrichtigungen sind aus"}</b><p>${n.system ? "Die App darf Benachrichtigungen anzeigen." : "Deine Check-ins und Anfeuerungen können gerade nicht angezeigt werden."}</p>${n.system ? "" : `<button data-act="system">In Systemeinstellungen erlauben</button>`}</section><h3>Tages-Check-ins</h3><section class="list toggles">${toggleRow("noon", "Mittags", "Nur wenn etwas hinterherhinkt", "notifications")}<label class="time">Uhrzeit <input type="time" value="${n.noonAt}" ${n.noon ? "" : "disabled"}></label>${toggleRow("evening", "Abends", "Bündelt alles noch Offene", "notifications")}<label class="time">Uhrzeit <input type="time" value="${n.eveningAt}" ${n.evening ? "" : "disabled"}></label></section><h3>In Check-ins berücksichtigen</h3><section class="list toggles">${toggleRow("food", "Ernährung", "", "notifications")}${toggleRow("water", "Wasser", "", "notifications")}${toggleRow("sport", "Sport", "", "notifications")}${toggleRow("weight", "Gewicht", "", "notifications")}</section><h3>Partner</h3><section class="list toggles">${toggleRow("partner", "Partner-Pushes", "Anfeuern, Challenge-Vorschläge und Insel-Meilensteine", "notifications")}</section><p class="info">Keine Ruhezeiten und keine besonderen Wochenendzeiten in V1.</p></div>`;
}
function genericSettings(title) {
  const copy = { goals: "Kalorienbudget, Zielgewicht, Wasser- und Sportziel ändern oder neu berechnen.", week: "Sporttage, Wiegetag und die drei täglichen Momo-Bausteine festlegen.", health: "Verbindung, Berechtigungen und letzter Import aus Apple Health.", account: "Passwort ändern, aktuelle Sitzung abmelden oder alle Sitzungen widerrufen." }[state.settingsPage];
  return `${back(title)}<div class="scroll settings"><section class="empty small"><div>🧩</div><h2>${title}</h2><p>${copy}</p><p class="soft">Für dieses Ticket nur als Navigationsziel dargestellt.</p></section></div>`;
}
function renderSettings() {
  if (state.settingsPage === "root") return settingsRoot();
  if (state.settingsPage === "partner") return partnerSettings();
  if (state.settingsPage === "notifications") return notificationSettings();
  const names = { goals: "Ziele", week: "Wochenplan", health: "Apple Health", account: "Konto" };
  return genericSettings(names[state.settingsPage]);
}
function renderSheet() {
  if (!state.sheet) return "";
  if (state.sheet === "cheer") return `<div class="backdrop" data-act="sheet-close"></div><section class="sheet"><h2>Anna anfeuern</h2><p>Eine feste Nachricht, ohne Bezug auf offene Ziele.</p>${["Du schaffst das! 💪", "Ich denk an dich ❤️", "Stark heute! 🎉", "Gemeinsam für Momo 🐣", "Kleiner Stups: Trink was 💧"].map(x => `<button data-act="cheer-send">${x}</button>`).join("")}<small>${state.cheersSent} von 3 Pushes heute gesendet</small><button class="quiet" data-act="sheet-close">Abbrechen</button></section>`;
  if (state.sheet === "proposal") return `<div class="backdrop" data-act="sheet-close"></div><section class="sheet"><p class="eyebrow">CHALLENGE-VORSCHLAG</p><h2>🏃 Aktive Woche</h2><p>Jeder erfüllt mindestens 80 % seiner geplanten Sporteinheiten. Eure persönlichen Zielwerte bleiben privat.</p><div class="sheet-actions"><button class="quiet" data-act="proposal-decline">Neutral ablehnen</button><button class="primary" data-act="proposal-accept">Annehmen</button></div><small>Der Vorschlag verfällt morgen um 18:20.</small></section>`;
  return "";
}
function render() {
  const v = currentVariant();
  app.innerHTML = state.page === "settings" ? renderSettings() : { A: renderA, B: renderB, C: renderC }[v]();
  sheetRoot.innerHTML = renderSheet();
  label.textContent = `${v} — ${variants[v]}`;
  document.querySelector("#state-output").textContent = JSON.stringify({ variante: v, ...state }, null, 2);
}
function toast(text) { const el = document.querySelector("#toast"); el.textContent = text; el.classList.add("visible"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("visible"), 2200); }

document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const d = el.dataset;
  if (d.act === "settings") { state.page = "settings"; state.settingsPage = "root"; }
  if (d.act === "wir") state.page = "wir";
  if (d.act === "settings-root") { if (state.settingsPage === "root") state.page = "wir"; else state.settingsPage = "root"; }
  if (d.act === "settings-page") state.settingsPage = d.target;
  if (d.act === "cheer") state.sheet = "cheer";
  if (d.act === "cheer-send") { state.cheersSent++; state.sheet = null; toast("Anfeuerung an Anna gesendet 💛"); }
  if (d.act === "thanks") { state.cheersIn = 0; toast("Danke ❤️ an Anna gesendet – ohne Push"); }
  if (d.act === "proposal-open") state.sheet = "proposal";
  if (d.act === "proposal-accept") { state.proposal = false; state.sheet = null; toast("Challenge startet jetzt gemeinsam"); }
  if (d.act === "proposal-decline") { state.proposal = false; state.sheet = null; toast("Vorschlag neutral abgelehnt"); }
  if (d.act === "sheet-close") state.sheet = null;
  if (d.act === "invite") toast("Einladungscode 482 913 · 24 Stunden gültig");
  if (d.act === "code") toast("Eingabe für 6-stelligen Code geöffnet");
  if (d.act === "island") toast("Öffnet den Tab „Momo“");
  if (d.act === "challenge-detail") toast("Zeigt eigenen Stand und groben gemeinsamen Fortschritt");
  if (d.act === "system") toast("Öffnet die Systemeinstellungen");
  if (d.act === "unlink") toast("Vor Entkopplung folgt ein Bestätigungsdialog");
  render();
});
document.addEventListener("change", e => {
  if (!e.target.dataset.toggle) return;
  state[e.target.dataset.group][e.target.dataset.toggle] = e.target.checked; render();
});
document.querySelectorAll("[data-sim]").forEach(b => b.addEventListener("click", () => {
  if (b.dataset.sim === "solo") state.solo = !state.solo;
  if (b.dataset.sim === "proposal") state.proposal = !state.proposal;
  if (b.dataset.sim === "cheer") state.cheersIn += 1;
  if (b.dataset.sim === "reset") state = initialState();
  render();
}));
document.querySelector("#lab-toggle").addEventListener("click", () => { const lab = document.querySelector("#lab"); lab.classList.toggle("collapsed"); });
function cycle(step) { const keys = Object.keys(variants); const next = keys[(keys.indexOf(currentVariant()) + step + keys.length) % keys.length]; const url = new URL(location.href); url.searchParams.set("variant", next); history.replaceState(null, "", url); state.sheet = null; render(); }
document.querySelector("#previous").addEventListener("click", () => cycle(-1));
document.querySelector("#next").addEventListener("click", () => cycle(1));
document.addEventListener("keydown", e => { if (e.target.closest("input, textarea, [contenteditable]")) return; if (e.key === "ArrowLeft") cycle(-1); if (e.key === "ArrowRight") cycle(1); });
render();
