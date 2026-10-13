// PROTOTYP — Drei Varianten, switchbar über ?variant=A|B|C.
const variants = {
  A: "Momo – gemeinsames Wesen",
  B: "Expedition – gemeinsamer Weg",
  C: "Sammelalbum – persönliche Level"
};

const initialState = () => ({
  day: 4,
  philipp: { successes: 2, misses: 1, today: "offen" },
  partnerin: { successes: 3, misses: 0, today: "offen" },
  encouragements: 1,
  petEnergy: 68,
  routeSteps: 5,
  xp: 65,
  repairTokens: 1,
  lastEvent: "Ihr startet gemeinsam in Tag 4."
});

let state = initialState();
let toastTimer;
const app = document.querySelector("#app");
const stateOutput = document.querySelector("#state-output");
const label = document.querySelector("#variant-label");

function currentVariant() {
  const value = new URLSearchParams(location.search).get("variant")?.toUpperCase();
  return variants[value] ? value : "A";
}

function personLabel(person) {
  return person === "philipp" ? "Philipp" : "Deine Partnerin";
}

function reaction() {
  const statuses = [state.philipp.today, state.partnerin.today];
  if (statuses.every(value => value === "geschafft")) return "duo";
  if (statuses.includes("geschafft")) return "success";
  if (statuses.includes("verpasst")) return "miss";
  return "open";
}

function petMood() {
  const mood = reaction();
  if (mood === "duo") return { emoji: "🐲", spark: "✨", title: "Momo strahlt!", copy: "Euer gemeinsamer Tag gibt extra Energie." };
  if (mood === "success") return { emoji: "🐲", spark: "🌟", title: "Momo freut sich mit euch", copy: "Jeder kleine Schritt zählt für euer Team." };
  if (mood === "miss") return { emoji: "🐲", spark: "🌱", title: "Momo wartet auf morgen", copy: "Nichts geht verloren. Ein neuer Tag ist ein neuer Versuch." };
  return { emoji: "🐲", spark: "☀️", title: "Momo ist neugierig", copy: "Wie wird euer heutiger Tag?" };
}

function todayIcon(status) {
  return status === "geschafft" ? "✓" : status === "verpasst" ? "↻" : "·";
}

function renderPet() {
  const mood = petMood();
  return `
    <section class="phone-page pet-page">
      <header><p class="eyebrow">Euer Begleiter · Tag ${state.day}</p><h1>Hallo von Momo</h1><p class="subhead">Ihr kümmert euch gemeinsam um ein Wesen. Fortschritt macht es lebendig; verpasste Ziele werden nicht bestraft.</p></header>
      <div class="pet-scene">
        <div class="pet-halo"></div>
        <div class="pet ${reaction() === "miss" ? "muted" : ""}">${mood.emoji}</div>
        <div class="pet-spark">${mood.spark}</div>
      </div>
      <div class="pet-status">
        <strong>${mood.title}</strong><span>${mood.copy}</span>
        <div class="energy"><i style="width:${state.petEnergy}%"></i></div>
        <small>${state.petEnergy} Energie · bei 100 entwickelt sich Momo weiter</small>
      </div>
      <div class="contributions">
        <div class="contribution"><span>Philipp heute</span><b>${todayIcon(state.philipp.today)} ${state.philipp.today}</b></div>
        <div class="contribution"><span>Partnerin heute</span><b>${todayIcon(state.partnerin.today)} ${state.partnerin.today}</b></div>
      </div>
    </section>`;
}

function renderRoute() {
  const milestones = [
    [2, "Startlager", "Gemeinsam begonnen"],
    [5, "Waldlichtung", "Aktueller Abschnitt"],
    [8, "Bergsee", "3 Beiträge entfernt"],
    [12, "Gipfelpicknick", "Gemeinsame Wochenbelohnung"]
  ];
  const progress = Math.min(100, Math.round(state.routeSteps / 12 * 100));
  const stops = milestones.map(([at, title, copy]) => {
    const klass = state.routeSteps >= at ? "done" : state.routeSteps + 3 >= at ? "current" : "";
    return `<div class="stop ${klass}"><div class="stop__dot">${state.routeSteps >= at ? "✓" : at}</div><div><b>${title}</b><p>${copy}</p></div></div>`;
  }).join("");
  const routeMessage = reaction() === "miss"
    ? "Heute kein Schritt? Eure erreichte Strecke bleibt. Morgen geht es hier weiter."
    : reaction() === "duo"
      ? "Duo-Bonus: Ihr habt heute zusammen zwei Wegstücke geschafft."
      : "Jeder erreichte Tagesbeitrag bewegt euch beide vorwärts.";
  return `
    <section class="phone-page route-page">
      <header><p class="eyebrow">Expedition · Tag ${state.day}</p><h1>12 Schritte zum Gipfel</h1><p class="subhead">Eine kurze gemeinsame Challenge macht aus einzelnen Erfolgen eine sichtbare Reise.</p></header>
      <div class="route-map" style="--progress:${progress}%">
        <div class="route-line"></div>${stops}
      </div>
      <div class="team-row">
        <div class="hiker"><span>Philipp beigetragen</span><b>🥾 ${state.philipp.successes}</b></div>
        <div class="hiker"><span>Partnerin beigetragen</span><b>🥾 ${state.partnerin.successes}</b></div>
      </div>
      <p class="route-note">${routeMessage}</p>
    </section>`;
}

function renderCollection() {
  const level = 1 + Math.floor(state.xp / 100);
  const withinLevel = state.xp % 100;
  const unlocked = Math.min(6, 2 + Math.floor(state.xp / 35));
  const cards = [
    ["🌿", "Erster Schritt"], ["💧", "Wasserwirbel"], ["🥕", "Bunt gegessen"],
    ["👟", "In Bewegung"], ["⚖️", "Drangeblieben"], ["🌈", "Duo-Woche"]
  ].map(([icon, title], index) => `<div class="collectible ${index >= unlocked ? "locked" : ""}"><i>${index >= unlocked ? "?" : icon}</i><b>${title}</b></div>`).join("");
  const copy = reaction() === "miss"
    ? `Die Serie darf Pause machen. ${state.repairTokens} Joker schützt euren bisherigen Fortschritt.`
    : "Erreichte Alltagsziele geben XP; besondere Karten erinnern an Meilensteine.";
  return `
    <section class="phone-page collection-page">
      <header><p class="eyebrow">Euer Sammelalbum · Tag ${state.day}</p><h1>Kleine Siege, bleibende Karten</h1><p class="subhead">Persönlicher Fortschritt steht vorn; gemeinsame Wochen schalten seltene Erinnerungen frei.</p></header>
      <div class="level-strip">
        <div class="level-badge"><b>${level}</b></div>
        <div class="level-copy"><strong>Team-Level ${level}</strong><span>${withinLevel} / 100 XP bis Level ${level + 1}</span><div class="xp-bar"><i style="width:${withinLevel}%"></i></div></div>
        <div class="coin">🛟 ${state.repairTokens}</div>
      </div>
      <div class="cards-title"><h2>Entdeckte Karten</h2><span>${unlocked} von 6</span></div>
      <div class="card-grid">${cards}</div>
      <div class="duo-card"><div class="duo-card__top"><div><strong>${reaction() === "miss" ? "Kein Neustart bei null" : "Nächste Duo-Karte"}</strong><p>${copy}</p></div><div class="stamp">${state.philipp.successes + state.partnerin.successes}/8</div></div></div>
    </section>`;
}

function render() {
  const variant = currentVariant();
  app.innerHTML = variant === "A" ? renderPet() : variant === "B" ? renderRoute() : renderCollection();
  label.textContent = `${variant} — ${variants[variant]}`;
  stateOutput.textContent = JSON.stringify(state, null, 2);
}

function showToast(message) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 1800);
}

function record(person, result) {
  const current = state[person].today;
  if (current === "geschafft") {
    state[person].successes -= 1;
    state.petEnergy = Math.max(0, state.petEnergy - 8);
    state.routeSteps = Math.max(0, state.routeSteps - 1);
    state.xp = Math.max(0, state.xp - 15);
  } else if (current === "verpasst") {
    state[person].misses -= 1;
  }

  state[person].today = result === "success" ? "geschafft" : "verpasst";
  if (result === "success") {
    state[person].successes += 1;
    state.petEnergy = Math.min(100, state.petEnergy + 8);
    state.routeSteps = Math.min(12, state.routeSteps + 1);
    state.xp += 15;
    state.lastEvent = `${personLabel(person)} hat das Tagesziel geschafft.`;
    showToast(`🎉 ${personLabel(person)}: Ziel geschafft`);
  } else {
    state[person].misses += 1;
    state.lastEvent = `${personLabel(person)} hat das Tagesziel verpasst; Fortschritt bleibt erhalten.`;
    showToast("Morgen ist ein neuer Versuch — nichts geht verloren.");
  }
  render();
}

function cycle(direction) {
  const keys = Object.keys(variants);
  const index = keys.indexOf(currentVariant());
  const variant = keys[(index + direction + keys.length) % keys.length];
  const url = new URL(location.href);
  url.searchParams.set("variant", variant);
  history.replaceState({}, "", url);
  render();
}

document.addEventListener("click", event => {
  const button = event.target.closest("button[data-event]");
  if (!button) return;
  const action = button.dataset.event;
  if (action === "success" || action === "miss") record(button.dataset.person, action);
  if (action === "nudge") {
    state.encouragements += 1;
    state.lastEvent = "Ein aufmunterndes Herz wurde gesendet.";
    showToast("💛 Anfeuerung gesendet — ohne Punktedruck");
    render();
  }
  if (action === "next") {
    state.day += 1;
    state.philipp.today = "offen";
    state.partnerin.today = "offen";
    state.petEnergy = Math.max(20, state.petEnergy - 3);
    state.lastEvent = `Tag ${state.day} beginnt; alle bisherigen Erfolge bleiben.`;
    render();
  }
  if (action === "reset") {
    state = initialState();
    render();
  }
});

document.querySelector("#lab-toggle").addEventListener("click", () => {
  const lab = document.querySelector("#lab");
  lab.classList.toggle("collapsed");
  document.querySelector("#lab-toggle").setAttribute("aria-expanded", String(!lab.classList.contains("collapsed")));
});
document.querySelector("#previous").addEventListener("click", () => cycle(-1));
document.querySelector("#next").addEventListener("click", () => cycle(1));
document.addEventListener("keydown", event => {
  const tag = document.activeElement?.tagName;
  if (["INPUT", "TEXTAREA"].includes(tag) || document.activeElement?.isContentEditable) return;
  if (event.key === "ArrowLeft") cycle(-1);
  if (event.key === "ArrowRight") cycle(1);
});
window.addEventListener("popstate", render);
render();
