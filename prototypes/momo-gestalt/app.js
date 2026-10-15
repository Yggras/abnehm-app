// PROTOTYP — wegwerfbar. Drei Momo-Gestalten, switchbar über ?variant=A|B|C.
const variants = {
  A: {
    name: "Keimling",
    claim: "Samenkörper · Blattspross · sichtbares Wachstum",
    subtitle: "Eine weiche Samenform, deren Blattspross mit jeder großen Form üppiger wird.",
    hypothesis: "Die Entwicklung lässt sich über neue Blätter sofort zeigen. Zu prüfen ist, ob Momo dadurch zu stark nach der Rolle Natur aussieht, obwohl Momo beiden gehört.",
    traits: [
      "Birnenförmige Silhouette mit tiefem Schwerpunkt",
      "Asymmetrischer Spross als Erkennungsmerkmal",
      "Wachstum über Blätter, Ranke und Bauchzeichen"
    ],
    stageNotes: {
      egg: "warm gepunktetes Ei",
      l1: "ein junger Spross",
      l4: "zweites Blatt",
      l8: "Blattkranz und Samenmal",
      l13: "kleine Ranke und drei Blätter"
    }
  },
  B: {
    name: "Lagunenling",
    claim: "Seitenflossen · Ringelschwanz · Inselwesen",
    subtitle: "Ein rundes Land-Wasser-Wesen mit weichen Seitenflossen und einem eingerollten Schwanz.",
    hypothesis: "Flossen und Wellenmal binden Momo an die Lagune, ohne eine reale Tierart nachzuzeichnen. Zu prüfen ist, ob die Gestalt an Land selbstverständlich genug wirkt.",
    traits: [
      "Breite Silhouette mit zwei weichen Seitenflossen",
      "Ringelschwanz als Erkennungsmerkmal in der Seitenansicht",
      "Entwicklung über Flossengröße, Wellenmal und Kopfkamm"
    ],
    stageNotes: {
      egg: "warm gepunktetes Ei",
      l1: "kleine Seitenflossen",
      l4: "Flossen öffnen sich",
      l8: "Ringelschwanz und Wellenmal",
      l13: "weicher Kopfkamm"
    }
  },
  C: {
    name: "Kieselgeist",
    claim: "weiche Lagen · lange Fühler · schwebender Schritt",
    subtitle: "Ein frei erfundenes Inselwesen aus versetzten, kieselartigen Rundungen mit zwei beweglichen Fühlern.",
    hypothesis: "Die abstrakte Form gehört weder Bauen noch Natur und kann dadurch beide Rollen verbinden. Zu prüfen ist, ob Gesicht und Fühler in der kleinen Darstellung klar genug bleiben.",
    traits: [
      "Versetzte, breite Silhouette statt Tierkörper",
      "Zwei ungleiche Fühler als Erkennungsmerkmal",
      "Entwicklung über zusätzliche Lagen, Stirnstein und Schulterwirbel"
    ],
    stageNotes: {
      egg: "warm gepunktetes Ei",
      l1: "kurze Fühler",
      l4: "ungleiche lange Fühler",
      l8: "zweite Körperlage und Stirnstein",
      l13: "Schulterwirbel und drei Kieselmale"
    }
  }
};

const stageOrder = ["egg", "l1", "l4", "l8", "l13"];
const stages = {
  egg: { title: "Ei", short: "vor Kopplung" },
  l1: { title: "Geschlüpft", short: "Level 1" },
  l4: { title: "Erste große Form", short: "Level 4" },
  l8: { title: "Zweite große Form", short: "Level 8" },
  l13: { title: "Dritte große Form", short: "Level 13" }
};
const moods = {
  zufrieden: "Zufrieden",
  freut: "Freut sich",
  neugierig: "Neugierig",
  doest: "Döst"
};
const accessories = {
  none: "Ohne",
  flower: "Blüte",
  scarf: "Halstuch",
  shell: "Muschelband"
};

const state = {
  stage: "l8",
  mood: "zufrieden",
  accessory: "none"
};
let uid = 0;
const app = document.querySelector("#app");
const stateOutput = document.querySelector("#state-output");
const label = document.querySelector("#variant-label");

function currentVariant() {
  const value = new URLSearchParams(location.search).get("variant")?.toUpperCase();
  return variants[value] ? value : "A";
}

function face(mood, x = 130, y = 112, scale = 1) {
  const lx = x - 24 * scale;
  const rx = x + 24 * scale;
  const eyeY = y;
  const cheekY = y + 18 * scale;
  const cheeks = `<ellipse cx="${x - 39 * scale}" cy="${cheekY}" rx="${10 * scale}" ry="${6 * scale}" fill="#F48C73" opacity=".55"/><ellipse cx="${x + 39 * scale}" cy="${cheekY}" rx="${10 * scale}" ry="${6 * scale}" fill="#F48C73" opacity=".55"/>`;

  if (mood === "freut" || mood === "begeistert") {
    return `${cheeks}
      <path d="M${lx - 8 * scale} ${eyeY} Q${lx} ${eyeY + 9 * scale} ${lx + 8 * scale} ${eyeY}" fill="none" stroke="#1D3332" stroke-width="${5 * scale}" stroke-linecap="round"/>
      <path d="M${rx - 8 * scale} ${eyeY} Q${rx} ${eyeY + 9 * scale} ${rx + 8 * scale} ${eyeY}" fill="none" stroke="#1D3332" stroke-width="${5 * scale}" stroke-linecap="round"/>
      <ellipse cx="${x}" cy="${y + 30 * scale}" rx="${16 * scale}" ry="${13 * scale}" fill="#1D3332"/>
      <ellipse cx="${x}" cy="${y + 35 * scale}" rx="${8 * scale}" ry="${4 * scale}" fill="#F48C73"/>`;
  }
  if (mood === "neugierig") {
    return `${cheeks}
      <path d="M${lx - 10 * scale} ${eyeY - 16 * scale} Q${lx} ${eyeY - 23 * scale} ${lx + 9 * scale} ${eyeY - 17 * scale}" fill="none" stroke="#1D3332" stroke-width="${3.5 * scale}" stroke-linecap="round"/>
      <path d="M${rx - 9 * scale} ${eyeY - 17 * scale} Q${rx} ${eyeY - 23 * scale} ${rx + 10 * scale} ${eyeY - 16 * scale}" fill="none" stroke="#1D3332" stroke-width="${3.5 * scale}" stroke-linecap="round"/>
      <ellipse cx="${lx}" cy="${eyeY}" rx="${10 * scale}" ry="${14 * scale}" fill="#1D3332"/><ellipse cx="${rx}" cy="${eyeY}" rx="${10 * scale}" ry="${14 * scale}" fill="#1D3332"/>
      <circle cx="${lx - 3 * scale}" cy="${eyeY - 5 * scale}" r="${3.5 * scale}" fill="#fff"/><circle cx="${rx - 3 * scale}" cy="${eyeY - 5 * scale}" r="${3.5 * scale}" fill="#fff"/>
      <ellipse cx="${x}" cy="${y + 31 * scale}" rx="${7 * scale}" ry="${9 * scale}" fill="#1D3332"/>`;
  }
  if (mood === "doest" || mood === "schlaeft") {
    return `${cheeks}
      <path d="M${lx - 9 * scale} ${eyeY} Q${lx} ${eyeY + 7 * scale} ${lx + 9 * scale} ${eyeY}" fill="none" stroke="#1D3332" stroke-width="${4 * scale}" stroke-linecap="round"/>
      <path d="M${rx - 9 * scale} ${eyeY} Q${rx} ${eyeY + 7 * scale} ${rx + 9 * scale} ${eyeY}" fill="none" stroke="#1D3332" stroke-width="${4 * scale}" stroke-linecap="round"/>
      <path d="M${x - 8 * scale} ${y + 29 * scale} Q${x} ${y + 33 * scale} ${x + 8 * scale} ${y + 29 * scale}" fill="none" stroke="#1D3332" stroke-width="${3.5 * scale}" stroke-linecap="round"/>
      <text x="${x + 48 * scale}" y="${y - 22 * scale}" fill="#55625E" font-size="${18 * scale}" font-weight="700">z</text>`;
  }
  return `${cheeks}
    <ellipse cx="${lx}" cy="${eyeY}" rx="${9 * scale}" ry="${12 * scale}" fill="#1D3332"/><ellipse cx="${rx}" cy="${eyeY}" rx="${9 * scale}" ry="${12 * scale}" fill="#1D3332"/>
    <circle cx="${lx - 3 * scale}" cy="${eyeY - 4 * scale}" r="${3 * scale}" fill="#fff"/><circle cx="${rx - 3 * scale}" cy="${eyeY - 4 * scale}" r="${3 * scale}" fill="#fff"/>
    <path d="M${x - 10 * scale} ${y + 27 * scale} Q${x} ${y + 37 * scale} ${x + 10 * scale} ${y + 27 * scale}" fill="none" stroke="#1D3332" stroke-width="${4 * scale}" stroke-linecap="round"/>`;
}

function eggSvg() {
  const id = `egg-${uid++}`;
  return `<svg viewBox="0 0 260 260" role="img" aria-label="Momo wartet im Ei">
    <defs><clipPath id="${id}"><path d="M130 34 C91 34 65 100 67 155 C69 202 94 228 130 228 C166 228 191 202 193 155 C195 100 169 34 130 34Z"/></clipPath></defs>
    <ellipse cx="130" cy="225" rx="61" ry="13" fill="#1D3332" opacity=".16"/>
    <path d="M130 34 C91 34 65 100 67 155 C69 202 94 228 130 228 C166 228 191 202 193 155 C195 100 169 34 130 34Z" fill="#FFEBC4"/>
    <rect x="130" y="20" width="80" height="220" fill="#1D3332" opacity=".08" clip-path="url(#${id})"/>
    <ellipse cx="104" cy="84" rx="15" ry="22" transform="rotate(-24 104 84)" fill="#FFC56E"/>
    <ellipse cx="154" cy="126" rx="19" ry="12" transform="rotate(18 154 126)" fill="#FFC56E"/>
    <ellipse cx="105" cy="173" rx="13" ry="18" transform="rotate(31 105 173)" fill="#FFC56E"/>
    <ellipse cx="112" cy="58" rx="15" ry="9" transform="rotate(-28 112 58)" fill="#fff" opacity=".45"/>
  </svg>`;
}

function arms(mood, leftX = 78, rightX = 182, y = 152) {
  if (mood === "freut" || mood === "begeistert") {
    return `<ellipse cx="${leftX}" cy="${y - 20}" rx="12" ry="31" transform="rotate(-48 ${leftX} ${y - 20})" fill="#FFC56E"/><ellipse cx="${rightX}" cy="${y - 20}" rx="12" ry="31" transform="rotate(48 ${rightX} ${y - 20})" fill="#FFC56E"/>`;
  }
  return `<ellipse cx="${leftX}" cy="${y}" rx="12" ry="29" transform="rotate(18 ${leftX} ${y})" fill="#FFC56E"/><ellipse cx="${rightX}" cy="${y}" rx="12" ry="29" transform="rotate(-18 ${rightX} ${y})" fill="#FFC56E"/>`;
}

function accessorySvg(type, variant) {
  const anchors = {
    A: { headX: 170, headY: 55, neckY: 154 },
    B: { headX: 165, headY: 63, neckY: 158 },
    C: { headX: 169, headY: 67, neckY: 157 }
  }[variant];
  if (type === "flower") {
    const { headX: x, headY: y } = anchors;
    return `<g aria-label="Blüte am Kopf"><circle cx="${x}" cy="${y - 9}" r="9" fill="#F48C73"/><circle cx="${x + 9}" cy="${y}" r="9" fill="#F48C73"/><circle cx="${x}" cy="${y + 9}" r="9" fill="#F48C73"/><circle cx="${x - 9}" cy="${y}" r="9" fill="#F48C73"/><circle cx="${x}" cy="${y}" r="7" fill="#F2B33D"/></g>`;
  }
  if (type === "scarf") {
    const y = anchors.neckY;
    return `<g aria-label="Halstuch"><path d="M87 ${y} Q130 ${y + 18} 173 ${y} L169 ${y + 18} Q130 ${y + 32} 91 ${y + 18}Z" fill="#0E8580"/><path d="M158 ${y + 12} L181 ${y + 46} L160 ${y + 39} L146 ${y + 18}Z" fill="#085B58"/></g>`;
  }
  if (type === "shell") {
    const y = anchors.neckY + 6;
    return `<g aria-label="Muschelband"><path d="M91 ${y} Q130 ${y + 19} 169 ${y}" fill="none" stroke="#C9662B" stroke-width="6" stroke-linecap="round"/><path d="M121 ${y + 13} Q130 ${y + 2} 139 ${y + 13} L136 ${y + 27} Q130 ${y + 33} 124 ${y + 27}Z" fill="#FFFCF6"/><path d="M130 ${y + 10}V${y + 28}M124 ${y + 14}L130 ${y + 28}L136 ${y + 14}" fill="none" stroke="#C9662B" stroke-width="2.5" stroke-linecap="round"/></g>`;
  }
  return "";
}

function conceptA(stage, mood, accessory) {
  const level = { l1: 1, l4: 2, l8: 3, l13: 4 }[stage] || 1;
  const size = { l1: .78, l4: .88, l8: .98, l13: 1.06 }[stage] || .78;
  const id = `a-${uid++}`;
  const body = "M130 48 C96 48 75 77 76 118 C52 130 48 168 65 194 C79 216 101 226 130 226 C159 226 181 216 195 194 C212 168 208 130 184 118 C185 77 164 48 130 48Z";
  const leaves = [
    `<path d="M127 55 C112 39 114 22 132 12 C143 28 141 43 127 55Z" fill="#5FA44A"/>`,
    level >= 2 ? `<path d="M133 55 C145 34 163 31 177 43 C164 59 149 62 133 55Z" fill="#8BCB5E"/>` : "",
    level >= 3 ? `<path d="M128 49 C111 37 96 42 88 57 C104 66 118 62 128 49Z" fill="#8BCB5E"/>` : ""
  ].join("");
  const mark = level >= 3 ? `<path d="M130 167 C113 153 104 169 111 184 C116 196 126 201 130 207 C134 201 144 196 149 184 C156 169 147 153 130 167Z" fill="#FFC56E" opacity=".75"/>` : "";
  const vine = level >= 4 ? `<path d="M183 129 C211 112 222 139 207 151 C197 159 187 151 194 143" fill="none" stroke="#5FA44A" stroke-width="8" stroke-linecap="round"/>` : "";
  return `<defs><clipPath id="${id}"><path d="${body}"/></clipPath></defs>
    <ellipse cx="130" cy="225" rx="67" ry="13" fill="#1D3332" opacity=".16"/>
    <g transform="translate(130 138) scale(${size}) translate(-130 -138)">
      ${vine}${arms(mood, 73, 187, 151)}
      <path d="${body}" fill="#FFC56E"/>
      <rect x="130" y="38" width="90" height="200" fill="#1D3332" opacity=".10" clip-path="url(#${id})"/>
      <ellipse cx="130" cy="177" rx="47" ry="42" fill="#FFEBC4"/>
      ${mark}${leaves}
      <ellipse cx="106" cy="72" rx="17" ry="10" transform="rotate(-28 106 72)" fill="#fff" opacity=".45"/>
      ${face(mood, 130, 112, .92)}
      <ellipse cx="104" cy="218" rx="24" ry="9" fill="#FFC56E"/><ellipse cx="156" cy="218" rx="24" ry="9" fill="#E8AB59"/>
      ${accessorySvg(accessory, "A")}
    </g>`;
}

function conceptB(stage, mood, accessory) {
  const level = { l1: 1, l4: 2, l8: 3, l13: 4 }[stage] || 1;
  const size = { l1: .76, l4: .87, l8: .98, l13: 1.06 }[stage] || .76;
  const id = `b-${uid++}`;
  const body = "M130 57 C91 57 72 81 72 119 C72 137 61 151 66 175 C72 207 96 225 130 225 C164 225 188 207 194 175 C199 151 188 137 188 119 C188 81 169 57 130 57Z";
  const finScale = level === 1 ? .72 : level === 2 ? .9 : 1.08;
  const fins = `<g transform="translate(73 119) scale(${finScale}) translate(-73 -119)"><path d="M75 92 C47 76 29 88 34 112 C38 133 56 145 76 143 C68 126 68 108 75 92Z" fill="#FFEBC4"/></g>
    <g transform="translate(187 119) scale(${finScale}) translate(-187 -119)"><path d="M185 92 C213 76 231 88 226 112 C222 133 204 145 184 143 C192 126 192 108 185 92Z" fill="#F1D59F"/></g>`;
  const tail = level >= 3 ? `<path d="M183 181 C218 170 235 188 224 208 C214 226 187 222 190 205 C193 193 207 193 207 203" fill="none" stroke="#FFC56E" stroke-width="18" stroke-linecap="round"/>` : "";
  const crest = level >= 4 ? `<path d="M106 66 C106 42 116 27 130 18 C144 27 154 42 154 66 C139 59 121 59 106 66Z" fill="#FFEBC4"/><path d="M130 26V57" stroke="#E4B463" stroke-width="4" stroke-linecap="round"/>` : "";
  const wave = level >= 3 ? `<path d="M101 178 Q116 163 130 178 T159 178" fill="none" stroke="#FFC56E" stroke-width="8" stroke-linecap="round"/>` : "";
  return `<defs><clipPath id="${id}"><path d="${body}"/></clipPath></defs>
    <ellipse cx="130" cy="225" rx="70" ry="13" fill="#1D3332" opacity=".16"/>
    <g transform="translate(130 138) scale(${size}) translate(-130 -138)">
      ${tail}${fins}${arms(mood, 75, 185, 159)}
      <path d="${body}" fill="#FFC56E"/>
      <rect x="130" y="45" width="90" height="190" fill="#1D3332" opacity=".10" clip-path="url(#${id})"/>
      <ellipse cx="130" cy="174" rx="51" ry="44" fill="#FFEBC4"/>
      ${wave}${crest}
      <ellipse cx="105" cy="76" rx="18" ry="10" transform="rotate(-26 105 76)" fill="#fff" opacity=".45"/>
      ${face(mood, 130, 112, .94)}
      <ellipse cx="102" cy="218" rx="25" ry="9" fill="#FFC56E"/><ellipse cx="158" cy="218" rx="25" ry="9" fill="#E8AB59"/>
      ${accessorySvg(accessory, "B")}
    </g>`;
}

function conceptC(stage, mood, accessory) {
  const level = { l1: 1, l4: 2, l8: 3, l13: 4 }[stage] || 1;
  const size = { l1: .76, l4: .87, l8: .98, l13: 1.06 }[stage] || .76;
  const id = `c-${uid++}`;
  const body = "M130 61 C91 52 64 78 67 119 C45 138 53 178 79 191 C88 219 109 227 130 219 C151 227 172 219 181 191 C207 178 215 138 193 119 C196 78 169 52 130 61Z";
  const feelerLength = level === 1 ? 18 : level === 2 ? 34 : 43;
  const feelers = `<path d="M105 73 C88 ${63 - feelerLength / 3} 79 ${48 - feelerLength / 3} 88 ${34 - feelerLength / 3} C98 ${20 - feelerLength / 4} 112 ${38 - feelerLength / 4} 107 55" fill="#FFC56E"/>
    <path d="M151 65 C160 ${45 - feelerLength / 4} 181 ${47 - feelerLength / 3} 184 ${28 - feelerLength / 3} C187 ${11 - feelerLength / 4} 204 ${18 - feelerLength / 5} 201 37 C198 58 179 72 158 79" fill="#E8AB59"/>`;
  const layer = level >= 3 ? `<path d="M75 178 C88 191 105 195 130 188 C155 195 172 191 185 178 C181 211 157 228 130 219 C103 228 79 211 75 178Z" fill="#E8AB59" opacity=".5"/>` : "";
  const forehead = level >= 3 ? `<ellipse cx="130" cy="77" rx="13" ry="9" fill="#FFEBC4"/><ellipse cx="126" cy="74" rx="5" ry="3" fill="#fff" opacity=".55"/>` : "";
  const swirls = level >= 4 ? `<path d="M70 154 C39 142 36 172 54 178 C66 182 72 170 63 166" fill="none" stroke="#FFC56E" stroke-width="12" stroke-linecap="round"/><path d="M190 154 C221 142 224 172 206 178 C194 182 188 170 197 166" fill="none" stroke="#E8AB59" stroke-width="12" stroke-linecap="round"/>` : "";
  const marks = level >= 4 ? `<circle cx="113" cy="181" r="6" fill="#FFC56E"/><circle cx="130" cy="187" r="7" fill="#FFC56E"/><circle cx="147" cy="181" r="6" fill="#FFC56E"/>` : "";
  return `<defs><clipPath id="${id}"><path d="${body}"/></clipPath></defs>
    <ellipse cx="130" cy="224" rx="70" ry="13" fill="#1D3332" opacity=".16"/>
    <g transform="translate(130 138) scale(${size}) translate(-130 -138)">
      ${swirls}${feelers}${arms(mood, 72, 188, 154)}
      <path d="${body}" fill="#FFC56E"/>
      <rect x="130" y="46" width="100" height="190" fill="#1D3332" opacity=".10" clip-path="url(#${id})"/>
      ${layer}
      <ellipse cx="130" cy="174" rx="49" ry="38" fill="#FFEBC4"/>
      ${marks}${forehead}
      <ellipse cx="101" cy="78" rx="18" ry="10" transform="rotate(-24 101 78)" fill="#fff" opacity=".45"/>
      ${face(mood, 130, 116, .94)}
      ${accessorySvg(accessory, "C")}
    </g>`;
}

function momoSvg(variant, stage, mood = "zufrieden", accessory = "none") {
  if (stage === "egg") return eggSvg();
  const art = { A: conceptA, B: conceptB, C: conceptC }[variant](stage, mood, accessory);
  const description = `${variants[variant].name}, ${stages[stage].title}, Stimmung ${moods[mood]}`;
  return `<svg viewBox="0 0 260 260" role="img" aria-label="${description}">${art}</svg>`;
}

function islandScene() {
  return `<svg viewBox="0 0 470 470" aria-hidden="true">
    <ellipse cx="235" cy="262" rx="218" ry="130" fill="#3FB7D0"/>
    <ellipse cx="235" cy="274" rx="199" ry="111" fill="#2A93B3" opacity=".28"/>
    <path d="M68 258 L235 161 L402 258 L235 354Z" fill="#B07A48"/>
    <path d="M68 239 L235 142 L402 239 L235 335Z" fill="#8BCB5E"/>
    <path d="M68 239 L235 335 L235 354 L68 258Z" fill="#1D3332" opacity=".12"/>
    <path d="M402 239 L235 335 L235 354 L402 258Z" fill="#1D3332" opacity=".24"/>
    <path d="M92 242 L235 160 L378 242 L235 324Z" fill="#9FD774"/>
    <path d="M108 272 L235 198 L362 272 L235 345Z" fill="#F3D9A4" opacity=".72"/>
    <ellipse cx="121" cy="212" rx="22" ry="16" fill="#5FA44A"/><ellipse cx="347" cy="225" rx="27" ry="19" fill="#5FA44A"/>
    <rect x="115" y="214" width="7" height="35" rx="3" fill="#B07A48"/><rect x="343" y="227" width="8" height="39" rx="3" fill="#B07A48"/>
    <ellipse cx="88" cy="331" rx="24" ry="6" fill="#FFFCF6" opacity=".72"/><ellipse cx="390" cy="176" rx="31" ry="7" fill="#FFFCF6" opacity=".68"/>
  </svg>`;
}

function stageButton(variant, stage) {
  const item = stages[stage];
  const art = momoSvg(variant, stage, "zufrieden", "none");
  return `<button class="stage-option ${state.stage === stage ? "active" : ""}" data-stage="${stage}" aria-pressed="${state.stage === stage}">
    <span class="stage-option__figure">${art}</span>
    <strong>${item.title}</strong><span>${item.short}</span>
  </button>`;
}

function render() {
  const variant = currentVariant();
  const concept = variants[variant];
  const visibleStage = state.stage;
  const visibleMood = visibleStage === "egg" ? "zufrieden" : state.mood;
  const visibleAccessory = visibleStage === "egg" ? "none" : state.accessory;
  const figure = momoSvg(variant, visibleStage, visibleMood, visibleAccessory);
  const previewStage = visibleStage === "egg" ? "l4" : visibleStage;
  const stageLabel = stages[visibleStage];

  app.innerHTML = `<div class="page"><div class="page__inner">
    <header class="page-header">
      <div class="page-header__copy">
        <p class="eyebrow">Prototyp · Runde 1 von 2</p>
        <h1>Welche Grundgestalt soll Momo haben?</h1>
        <p class="lede">Drei bewusst unterschiedliche Silhouetten im Design-System „Lagune“. Wechsle unten zwischen A, B und C; Stimmung, Form und Accessoire lassen sich direkt ausprobieren.</p>
      </div>
      <span class="status-chip">Unbelegte Designvorschläge</span>
    </header>

    <section class="hero-card">
      <div class="island-stage">
        <div class="island-stage__scene">
          ${islandScene()}
          <div class="hero-momo">${figure}</div>
        </div>
        <div class="stage-caption"><strong>${stageLabel.title}</strong><span>${visibleStage === "egg" ? "Momo wartet ohne Kopplung" : `${stageLabel.short} · ${moods[visibleMood]}${visibleAccessory !== "none" ? ` · ${accessories[visibleAccessory]}` : ""}`}</span></div>
      </div>
      <div class="hero-copy">
        <p class="concept-number">Variante ${variant}</p>
        <h2 class="concept-title">${concept.name}</h2>
        <p class="concept-subtitle">${concept.subtitle}</p>
        <p class="hypothesis"><strong>Entwurfshypothese:</strong> ${concept.hypothesis}</p>
        <ul class="traits">${concept.traits.map((trait, index) => `<li><i>${index + 1}</i><span>${trait}</span></li>`).join("")}</ul>
        <div class="controls">
          <div class="control"><span class="control__label">Stimmung</span><div class="segmented">${Object.entries(moods).map(([key, text]) => `<button data-mood="${key}" class="${state.mood === key ? "active" : ""}" ${visibleStage === "egg" ? "disabled" : ""}>${text}</button>`).join("")}</div></div>
          <div class="control"><span class="control__label">Accessoire-Anker prüfen</span><div class="segmented">${Object.entries(accessories).map(([key, text]) => `<button data-accessory="${key}" class="${state.accessory === key ? "active" : ""}" ${visibleStage === "egg" ? "disabled" : ""}>${text}</button>`).join("")}</div></div>
        </div>
      </div>
    </section>

    <div class="content-grid">
      <section class="section-card">
        <h2>Entwicklungsprobe</h2>
        <p class="section-intro">Die erste Runde zeigt nur die ersten drei großen Formen. Nach der Gestaltwahl werden auch Level 19, 26, 34 und 43 ausgearbeitet.</p>
        <div class="stage-grid">${["egg", "l1", "l4", "l8", "l13"].map(stage => stageButton(variant, stage)).join("")}</div>
        <p class="section-intro" style="margin:16px 0 0"><strong>${concept.stageNotes[visibleStage]}</strong> · ${visibleStage === "egg" ? "Das Ei ist in allen Varianten bewusst gleich." : "Form, Licht und Farbwelt bleiben gleich; Größe und Details nehmen zu."}</p>
      </section>

      <section class="section-card">
        <h2>Einsatzprobe</h2>
        <p class="section-intro">Nur ein visueller Größencheck – kein Gerätetest.</p>
        <div class="scale-row">
          <div class="scale-sample">
            <p class="scale-sample__label"><span>„Heute“</span><span>≈ 104 dp</span></p>
            <div class="today-sample"><div class="momo-104">${momoSvg(variant, previewStage, state.mood, state.accessory)}</div></div>
          </div>
          <div class="scale-sample">
            <p class="scale-sample__label"><span>Insel</span><span>≈ ein Feld hoch</span></p>
            <div class="tile-sample"><div class="tile-sample__diamond"></div><div class="momo-tile">${momoSvg(variant, previewStage, "zufrieden", "none")}</div></div>
          </div>
        </div>
      </section>
    </div>

    <section class="decision-card">
      <h2>Deine Rückmeldung für Runde 2</h2>
      <ol>
        <li>Welche Grundgestalt: <strong>A Keimling</strong>, <strong>B Lagunenling</strong> oder <strong>C Kieselgeist</strong>?</li>
        <li>Sollen einzelne Merkmale aus einer anderen Variante übernommen werden?</li>
        <li>Was wirkt zu kindlich, zu tierisch oder in klein zu unklar?</li>
      </ol>
      <p>Danach zeichne ich die gewählte Richtung vollständig: Ei, sieben Stimmungen, alle sieben großen Formen und erster Accessoire-Katalog.</p>
    </section>
  </div></div>`;

  label.textContent = `${variant} — ${concept.name}`;
  stateOutput.textContent = JSON.stringify({ variante: variant, gestalt: concept.name, ...state }, null, 2);
}

function cycle(step) {
  const keys = Object.keys(variants);
  const next = keys[(keys.indexOf(currentVariant()) + step + keys.length) % keys.length];
  const url = new URL(location.href);
  url.searchParams.set("variant", next);
  history.replaceState(null, "", url);
  render();
}

document.addEventListener("click", event => {
  const stage = event.target.closest("[data-stage]");
  if (stage) { state.stage = stage.dataset.stage; render(); return; }
  const mood = event.target.closest("[data-mood]");
  if (mood && !mood.disabled) { state.mood = mood.dataset.mood; render(); return; }
  const accessory = event.target.closest("[data-accessory]");
  if (accessory && !accessory.disabled) { state.accessory = accessory.dataset.accessory; render(); }
});

document.querySelector("#previous").addEventListener("click", () => cycle(-1));
document.querySelector("#next").addEventListener("click", () => cycle(1));
document.addEventListener("keydown", event => {
  if (event.target.closest("input, textarea, [contenteditable]")) return;
  if (event.key === "ArrowLeft") cycle(-1);
  if (event.key === "ArrowRight") cycle(1);
});
document.querySelector("#note-toggle").addEventListener("click", () => {
  const note = document.querySelector("#prototype-note");
  note.classList.toggle("collapsed");
  document.querySelector("#note-toggle").setAttribute("aria-expanded", String(!note.classList.contains("collapsed")));
});

render();
