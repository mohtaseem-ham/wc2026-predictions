/* =========================================================
 *  FIFA World Cup 2026 - Office Prediction App
 *  Frontend logic (vanilla JS)
 *
 *  Two parallel brackets:
 *   - predictionBracket: user's locked picks
 *   - actualBracket:     winners derived from live API / manual updates
 *
 *  Data flow:
 *   - localStorage keeps participant predictions, actual results
 *     and API match-id map. Backend proxy (server.js) supplies
 *     /api/matches and /api/match/:id from a configurable provider.
 * ========================================================= */

/* ---------- 1. Configuration ---------- */

const FLAG_BASE = "https://flagcdn.com/w80";
const ADMIN_PASSWORD = "admin123";
const POLL_INTERVAL_MS = 60 * 1000;

// All 25 office teams. The Leaderboard shows every team here, even those that
// haven't submitted yet. Names must match the <select> options in index.html.
const TEAM_LIST = [
  "Team 1 - CCM Goats",
  "Team 2 - CCM Kings",
  "Team 3 - Alpha Wolves",
  "Team 4 - Game of Throws",
  "Team 5 - The Eagles",
  "Team 6 - Triple G - Golden Goal Group",
  "Team 7 - FC No Clue",
  "Team 8 - Goal Wallah",
  "Team 9 - The Dominators",
  "Team 10 - The GOAL Getters",
  "Team 11 - Shoot w Shouf",
  "Team 12 - Top of the Table",
  "Team 14 - Final Whistle",
  "Team 16 - JoyalAzamRositaZedrickMichael",
  "Team 17 - OthmanIbrahimIreneAngeloFred",
  "Team 18 - MilanSaadLyaMailinDibbah",
  "Team 19 - MostafaDulajNourIfrazEduard",
  "Team 20",
  "Team 21",
  "Team 22",
  "Team 23",
  "Team 31",
  "Team 33",
  "Team 34",
  "Team 36",
];
const STORAGE_KEYS = {
  prediction: "wc2026_prediction",
  participant: "wc2026_participant",
  apiMap: "wc2026_apiMap",
  actual: "wc2026_actual",
  manualResults: "wc2026_manualResults",
};

/* ---------- 2. Round of 16 definition ---------- */

/**
 * Each match has:
 *   id          - bracket id (also keys storage)
 *   apiMatchId  - mapping into the live provider (admin-editable)
 *   side        - "left" or "right"
 *   round       - "r16" | "qf" | "sf" | "f"
 *   home/away   - { name, code }    (code = ISO 3166-1 alpha-2 for flagcdn)
 *
 * Bracket progression rules (left side):
 *   r16_1 + r16_2 -> qf_l1
 *   r16_3 + r16_4 -> qf_l2
 *   r16_5 + r16_6 -> qf_l3
 *   r16_7 + r16_8 -> qf_l4
 *   qf_l1 + qf_l2 -> sf_l1
 *   qf_l3 + qf_l4 -> sf_l2
 *   sf_l1 + sf_l2 -> f_l
 *   f_l   + f_r   -> champion
 * (mirrored for the right side)
 */
const R16_MATCHES = [
  // ---- LEFT SIDE ----
  { id: "r16_1", side: "left",  home: { name: "Germany",      code: "de"    }, away: { name: "Paraguay",            code: "py"    } },
  { id: "r16_2", side: "left",  home: { name: "France",       code: "fr"    }, away: { name: "Sweden",              code: "se"    } },
  { id: "r16_3", side: "left",  home: { name: "South Africa", code: "za"    }, away: { name: "Canada",              code: "ca"    } },
  { id: "r16_4", side: "left",  home: { name: "Netherlands",  code: "nl"    }, away: { name: "Morocco",             code: "ma"    } },
  { id: "r16_5", side: "left",  home: { name: "Portugal",     code: "pt"    }, away: { name: "Croatia",             code: "hr"    } },
  { id: "r16_6", side: "left",  home: { name: "Spain",        code: "es"    }, away: { name: "Austria",             code: "at"    } },
  { id: "r16_7", side: "left",  home: { name: "USA",          code: "us"    }, away: { name: "Bosnia & Herzegovina",code: "ba"    } },
  { id: "r16_8", side: "left",  home: { name: "Belgium",      code: "be"    }, away: { name: "Senegal",             code: "sn"    } },
  // ---- RIGHT SIDE ----
  { id: "r16_9",  side: "right", home: { name: "Brazil",        code: "br"     }, away: { name: "Japan",      code: "jp" } },
  { id: "r16_10", side: "right", home: { name: "Cote d'Ivoire", code: "ci"     }, away: { name: "Norway",     code: "no" } },
  { id: "r16_11", side: "right", home: { name: "Mexico",        code: "mx"     }, away: { name: "Ecuador",    code: "ec" } },
  { id: "r16_12", side: "right", home: { name: "England",       code: "gb-eng" }, away: { name: "DR Congo",   code: "cd" } },
  { id: "r16_13", side: "right", home: { name: "Argentina",     code: "ar"     }, away: { name: "Cape Verde", code: "cv" } },
  { id: "r16_14", side: "right", home: { name: "Australia",     code: "au"     }, away: { name: "Egypt",      code: "eg" } },
  { id: "r16_15", side: "right", home: { name: "Switzerland",   code: "ch"     }, away: { name: "Algeria",    code: "dz" } },
  { id: "r16_16", side: "right", home: { name: "Colombia",      code: "co"     }, away: { name: "Ghana",      code: "gh" } },
];

/* ---------- 3. State ---------- */

// All matches (r16 + placeholders for later rounds). Built once on init.
let matches = {};
// Two parallel pick stores: { [matchId]: teamCode }
let predictionPicks = {};
let actualPicks = {};
// Manual admin-set results: { [matchId]: { home, away, status, winnerCode } }
let manualResults = {};
// API map: { [matchId]: apiMatchId }
let apiMap = {};
// Live snapshot from /api/matches : { [apiMatchId]: matchSnapshot }
let liveSnapshot = {};
// Participant metadata
let participant = { name: "", submittedAt: null };
// Current mode
let currentMode = "prediction"; // | "live"
// Poll handle
let pollHandle = null;

/* ---------- 4. Bootstrap ---------- */

document.addEventListener("DOMContentLoaded", () => {
  loadState();
  buildBracketSkeleton();
  bindGlobalUI();
  renderAll();
  // Server-side state: leaderboard + check whether this group has already
  // submitted (from another device).
  fetchLeaderboard();
  setInterval(fetchLeaderboard, 60_000);
  if (participant.name) checkForExistingSubmission();
});

/* ---------- 5. Persistence ---------- */

function loadState() {
  predictionPicks = safeParse(localStorage.getItem(STORAGE_KEYS.prediction), {});
  participant     = safeParse(localStorage.getItem(STORAGE_KEYS.participant), { name: "", submittedAt: null });
  apiMap          = safeParse(localStorage.getItem(STORAGE_KEYS.apiMap), {});
  actualPicks     = safeParse(localStorage.getItem(STORAGE_KEYS.actual), {});
  manualResults   = safeParse(localStorage.getItem(STORAGE_KEYS.manualResults), {});
}

function savePrediction()   { localStorage.setItem(STORAGE_KEYS.prediction,   JSON.stringify(predictionPicks)); }
function saveParticipant()  { localStorage.setItem(STORAGE_KEYS.participant,  JSON.stringify(participant)); }
function saveApiMap()       { localStorage.setItem(STORAGE_KEYS.apiMap,       JSON.stringify(apiMap)); }
function saveActual()       { localStorage.setItem(STORAGE_KEYS.actual,       JSON.stringify(actualPicks)); }
function saveManualResults(){ localStorage.setItem(STORAGE_KEYS.manualResults,JSON.stringify(manualResults)); }

function safeParse(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

/* ---------- 6. Build the matches map (r16 + placeholders) ---------- */

function buildBracketSkeleton() {
  matches = {};

  // R16 matches from config
  for (const m of R16_MATCHES) {
    matches[m.id] = { ...m, round: "r16" };
  }

  // Placeholder rounds: QF (4 per side), SF (2 per side), F (semis - 1 per side),
  // and a single FINAL match in the centre that feeds the Champion.
  const placeholders = [
    ["qf_l1", "left"], ["qf_l2", "left"], ["qf_l3", "left"], ["qf_l4", "left"],
    ["qf_r1", "right"], ["qf_r2", "right"], ["qf_r3", "right"], ["qf_r4", "right"],
    ["sf_l1", "left"], ["sf_l2", "left"],
    ["sf_r1", "right"], ["sf_r2", "right"],
    ["f_l",   "left"], ["f_r",   "right"],
    ["final", "center"],
  ];
  for (const [id, side] of placeholders) {
    let round;
    if (id === "final") round = "final";
    else if (id.startsWith("qf")) round = "qf";
    else if (id.startsWith("sf")) round = "sf";
    else round = "f";
    matches[id] = { id, side, round, home: null, away: null };
  }
}

/* ---------- 7. Bracket progression rules ---------- */

/**
 * For any given matchId, returns the next match { id, slot } where the winner advances.
 * slot is "home" or "away". Final winners go to the champion box.
 */
function nextSlotFor(matchId) {
  const map = {
    // LEFT R16 -> QF
    r16_1: { id: "qf_l1", slot: "home" }, r16_2: { id: "qf_l1", slot: "away" },
    r16_3: { id: "qf_l2", slot: "home" }, r16_4: { id: "qf_l2", slot: "away" },
    r16_5: { id: "qf_l3", slot: "home" }, r16_6: { id: "qf_l3", slot: "away" },
    r16_7: { id: "qf_l4", slot: "home" }, r16_8: { id: "qf_l4", slot: "away" },
    // LEFT QF -> SF
    qf_l1: { id: "sf_l1", slot: "home" }, qf_l2: { id: "sf_l1", slot: "away" },
    qf_l3: { id: "sf_l2", slot: "home" }, qf_l4: { id: "sf_l2", slot: "away" },
    // LEFT SF -> F
    sf_l1: { id: "f_l", slot: "home" }, sf_l2: { id: "f_l", slot: "away" },

    // RIGHT R16 -> QF
    r16_9:  { id: "qf_r1", slot: "home" }, r16_10: { id: "qf_r1", slot: "away" },
    r16_11: { id: "qf_r2", slot: "home" }, r16_12: { id: "qf_r2", slot: "away" },
    r16_13: { id: "qf_r3", slot: "home" }, r16_14: { id: "qf_r3", slot: "away" },
    r16_15: { id: "qf_r4", slot: "home" }, r16_16: { id: "qf_r4", slot: "away" },
    // RIGHT QF -> SF
    qf_r1: { id: "sf_r1", slot: "home" }, qf_r2: { id: "sf_r1", slot: "away" },
    qf_r3: { id: "sf_r2", slot: "home" }, qf_r4: { id: "sf_r2", slot: "away" },
    // RIGHT SF -> F
    sf_r1: { id: "f_r", slot: "home" }, sf_r2: { id: "f_r", slot: "away" },

    // SEMI-FINALS -> FINAL (one match per side feeds into the centre Final)
    f_l: { id: "final", slot: "home" },
    f_r: { id: "final", slot: "away" },
    // FINAL -> CHAMPION
    final: { id: "champion", slot: "home" },
  };
  return map[matchId] || null;
}

/* ---------- 8. Propagation through bracket ---------- */

/**
 * Given a picks object ({matchId: teamCode}) and the seed R16 matches,
 * compute the team that should occupy every slot for QF/SF/F.
 * Returns a new "view" of matches with teams filled in.
 */
function buildBracketView(picks) {
  // Start with a deep-ish copy of the matches map (only teams change)
  const view = {};
  for (const id of Object.keys(matches)) view[id] = { ...matches[id] };

  // Reset placeholder teams (everything past R16)
  for (const id of Object.keys(view)) {
    if (id.startsWith("qf") || id.startsWith("sf") || id.startsWith("f_") || id === "final") {
      view[id].home = null;
      view[id].away = null;
    }
  }

  // Walk through r16 -> qf -> sf -> f (semis) -> final in deterministic order
  const order = [
    "r16_1","r16_2","r16_3","r16_4","r16_5","r16_6","r16_7","r16_8",
    "r16_9","r16_10","r16_11","r16_12","r16_13","r16_14","r16_15","r16_16",
    "qf_l1","qf_l2","qf_l3","qf_l4","qf_r1","qf_r2","qf_r3","qf_r4",
    "sf_l1","sf_l2","sf_r1","sf_r2",
    "f_l","f_r",
    "final",
  ];

  let champion = null;
  for (const id of order) {
    const m = view[id];
    if (!m.home || !m.away) continue;
    const winnerCode = picks[id];
    if (!winnerCode) continue;
    const winnerTeam =
      m.home.code === winnerCode ? m.home :
      m.away.code === winnerCode ? m.away : null;
    if (!winnerTeam) continue;
    const next = nextSlotFor(id);
    if (!next) continue;
    if (next.id === "champion") { champion = winnerTeam; continue; }
    view[next.id][next.slot] = winnerTeam;
  }

  return { view, champion };
}

/* ---------- 9. Rendering ---------- */

function renderAll() {
  renderParticipantArea();
  renderBracket();
  renderScoreboard();
  renderLiveBanner();
}

function renderBracket() {
  // Bracket view in prediction mode shows prediction picks; in live mode shows actual picks
  // but we always overlay prediction selection markers.
  const showActual = currentMode === "live";
  const { view: predView, champion: predChamp } = buildBracketView(predictionPicks);
  const { view: actView,  champion: actChamp  } = buildBracketView(actualPicks);

  // For each round on each side, render the matches in order.
  // For r16/qf/sf we wrap consecutive pairs of matches in a .pair container
  // so CSS can draw the bracket lines between them. The final round (one match
  // per side) is rendered directly.
  const rounds = ["r16", "qf", "sf", "f"];
  const sides  = ["left", "right"];
  for (const side of sides) {
    for (const round of rounds) {
      const container = document.getElementById(`${round}-${side}`);
      container.innerHTML = "";
      const ids = matchIdsFor(round, side);
      const pickTeams = (id) => (showActual ? actView[id] : predView[id]);

      if (round === "f") {
        for (const id of ids) container.appendChild(renderMatchCard(id, pickTeams(id)));
        continue;
      }

      for (let i = 0; i < ids.length; i += 2) {
        const pair = document.createElement("div");
        pair.className = "pair";
        for (let j = 0; j < 2 && (i + j) < ids.length; j++) {
          const id = ids[i + j];
          pair.appendChild(renderMatchCard(id, pickTeams(id)));
        }
        container.appendChild(pair);
      }
    }
  }

  // Render the Final match into the centre column (above the Champion box)
  const finalContainer = document.getElementById("final-center");
  if (finalContainer) {
    finalContainer.innerHTML = "";
    const finalTeams = showActual ? actView["final"] : predView["final"];
    finalContainer.appendChild(renderMatchCard("final", finalTeams));
  }

  // Champion
  const championBox = document.getElementById("championBox");
  const champEl = document.getElementById("championTeam");
  champEl.textContent = predChamp ? predChamp.name : "?";
  championBox.classList.toggle("won", !!predChamp);

  const actualEl = document.getElementById("championActual");
  const actualName = document.getElementById("championActualName");
  if (showActual && actChamp) {
    actualName.textContent = actChamp.name;
    actualEl.classList.remove("hidden");
  } else {
    actualEl.classList.add("hidden");
  }
}

function matchIdsFor(round, side) {
  if (round === "r16") {
    return side === "left"
      ? ["r16_1","r16_2","r16_3","r16_4","r16_5","r16_6","r16_7","r16_8"]
      : ["r16_9","r16_10","r16_11","r16_12","r16_13","r16_14","r16_15","r16_16"];
  }
  if (round === "qf") {
    return side === "left" ? ["qf_l1","qf_l2","qf_l3","qf_l4"]
                            : ["qf_r1","qf_r2","qf_r3","qf_r4"];
  }
  if (round === "sf") {
    return side === "left" ? ["sf_l1","sf_l2"] : ["sf_r1","sf_r2"];
  }
  if (round === "f") {
    return side === "left" ? ["f_l"] : ["f_r"];
  }
  return [];
}

function renderMatchCard(matchId, teams) {
  const m = matches[matchId];
  const wrap = document.createElement("div");
  wrap.className = "match";
  wrap.dataset.matchId = matchId;

  // Pull info from current view (teams) and from data layers
  const home = teams.home;
  const away = teams.away;
  const pick = predictionPicks[matchId];                // participant prediction
  const actualWinner = actualPicks[matchId];            // actual winner code
  const live = currentLiveState(matchId);               // { status, homeScore, awayScore, winnerCode }

  // Status classes
  if (live && live.status === "LIVE") wrap.classList.add("live");
  if (live && live.status === "FT") {
    wrap.classList.add("ft");
    if (pick && actualWinner) {
      if (pick === actualWinner) wrap.classList.add("correct");
      else wrap.classList.add("wrong");
    }
  }

  // Build team rows
  const row = document.createElement("div");
  row.className = "match-row";

  row.appendChild(renderTeam(matchId, "home", home, pick, actualWinner));
  const vs = document.createElement("div");
  vs.className = "vs";
  vs.textContent = "VS";
  row.appendChild(vs);
  row.appendChild(renderTeam(matchId, "away", away, pick, actualWinner));

  wrap.appendChild(row);

  // Status / score line (only shown in live mode or if there is live/manual data)
  if (currentMode === "live" || live) {
    const sline = document.createElement("div");
    sline.className = "score-line";
    const scoreText = document.createElement("span");
    scoreText.className = "score";
    if (live && (live.homeScore !== null && live.homeScore !== undefined)) {
      scoreText.textContent = `${live.homeScore} - ${live.awayScore}`;
    } else {
      scoreText.textContent = "- vs -";
    }
    sline.appendChild(scoreText);

    const statusPill = document.createElement("span");
    statusPill.className = "status-pill";
    let statusLabel = "Not Started";
    if (live && live.status === "LIVE") { statusPill.classList.add("live"); statusLabel = "Live"; }
    else if (live && live.status === "HT") { statusPill.classList.add("ht"); statusLabel = "Half Time"; }
    else if (live && live.status === "FT") { statusPill.classList.add("ft"); statusLabel = "Full Time"; }
    statusPill.textContent = statusLabel;
    sline.appendChild(statusPill);

    // Result badge: only show in live mode when participant has a prediction
    if (currentMode === "live" && pick) {
      const badge = document.createElement("span");
      badge.className = "result-badge";
      if (!live || live.status !== "FT") {
        badge.classList.add("pending");
        badge.textContent = "Pending";
      } else if (pick === actualWinner) {
        badge.classList.add("correct");
        badge.textContent = "Correct";
      } else {
        badge.classList.add("wrong");
        badge.textContent = "Wrong";
      }
      sline.appendChild(badge);
    }
    wrap.appendChild(sline);
  }

  return wrap;
}

function renderTeam(matchId, slot, team, pickedCode, actualCode) {
  const el = document.createElement("div");
  el.className = "team" + (slot === "away" ? " right" : "");
  if (!team) {
    el.classList.add("placeholder");
    el.innerHTML = `<div class="flag" style="background:#1b2a64;"></div><span class="name">TBD</span>`;
    return el;
  }

  const isPicked = pickedCode === team.code;
  const isActualWinner = actualCode === team.code;
  // Eliminated: if a sibling is picked OR actual winner declared
  const matchPick = pickedCode;
  const isSibling = matchPick && matchPick !== team.code;
  if (currentMode === "prediction" && isSibling) el.classList.add("eliminated");
  if (isPicked) el.classList.add("selected");
  if (currentMode === "live" && isActualWinner) el.classList.add("actual-winner");
  if (currentMode === "live" && actualCode && actualCode !== team.code) el.classList.add("eliminated");

  el.innerHTML = `
    <img class="flag" src="${flagUrl(team.code)}" alt="${escapeHtml(team.name)} flag" loading="lazy" />
    <span class="name">${escapeHtml(team.name)}</span>
  `;

  el.addEventListener("click", () => onTeamClick(matchId, team));
  return el;
}

function flagUrl(code) {
  return `${FLAG_BASE}/${code}.png`;
}

function escapeHtml(s) {
  return (s + "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/* ---------- 10. Picking / locking ---------- */

function isLocked() { return !!participant.submittedAt; }

function onTeamClick(matchId, team) {
  if (currentMode !== "prediction") {
    toast("Switch to Prediction Mode to make picks.");
    return;
  }
  if (isLocked()) {
    toast("Predictions are locked. Submit was final.");
    return;
  }
  // Make sure the team is currently part of this match (placeholder slots reject)
  const view = buildBracketView(predictionPicks).view;
  const m = view[matchId];
  if (!m.home || !m.away) return; // not ready yet (waiting on previous round pick)
  if (m.home.code !== team.code && m.away.code !== team.code) return;

  // Set / replace pick. When replacing, blow away any downstream picks because
  // the rest of the bracket may no longer be valid.
  if (predictionPicks[matchId] !== team.code) {
    predictionPicks[matchId] = team.code;
    clearDownstreamPicks(matchId, predictionPicks);
    savePrediction();
    refreshSubmitState();
    renderAll();
  }
}

function clearDownstreamPicks(matchId, picksRef) {
  // BFS through nextSlotFor chain and clear any downstream picks made
  let queue = [matchId];
  const visited = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const nxt = nextSlotFor(id);
    if (!nxt || nxt.id === "champion") continue;
    if (picksRef[nxt.id]) delete picksRef[nxt.id];
    queue.push(nxt.id);
  }
}

function refreshSubmitState() {
  const nameOk = !!document.getElementById("participantName").value.trim();
  // Need a pick for every match in the bracket (R16 + downstream that have teams)
  const view = buildBracketView(predictionPicks).view;
  let total = 0, picked = 0;
  for (const id of Object.keys(view)) {
    const m = view[id];
    if (!m.home || !m.away) continue;
    total++;
    if (predictionPicks[id]) picked++;
  }
  const allFilled = total === 31 && picked === 31; // 16 + 8 + 4 + 2 + 1 (final) = 31
  document.getElementById("submitPredictions").disabled = isLocked() || !nameOk || !allFilled;
}

/* ---------- 11. Participant area & locking ---------- */

function renderParticipantArea() {
  const nameInput = document.getElementById("participantName");
  nameInput.value = participant.name || "";
  nameInput.disabled = isLocked();

  const lockBadge = document.getElementById("lockBadge");
  const lockText = document.getElementById("lockText");
  if (isLocked()) {
    lockBadge.classList.remove("hidden");
    const d = new Date(participant.submittedAt);
    lockText.textContent = `Locked by ${participant.name} - ${d.toLocaleString()}`;
  } else {
    lockBadge.classList.add("hidden");
  }
  // Post-submit "where does it go?" banner mirrors the lock state.
  const info = document.getElementById("postSubmitInfo");
  if (info) info.classList.toggle("hidden", !isLocked());
  refreshSubmitState();
}

/* ---------- 12. Global UI ---------- */

let groupCheckTimer = null;
function bindGlobalUI() {
  document.getElementById("participantName").addEventListener("input", (e) => {
    if (isLocked()) return;
    participant.name = e.target.value.trim();
    saveParticipant();
    refreshSubmitState();
    // Debounced server check: if this group already submitted from another
    // device, adopt that submission and lock the UI.
    clearTimeout(groupCheckTimer);
    groupCheckTimer = setTimeout(checkForExistingSubmission, 600);
  });

  document.getElementById("submitPredictions").addEventListener("click", submitToServer);

  document.getElementById("refreshLeaderboard")?.addEventListener("click", fetchLeaderboard);

  document.getElementById("resetLocal").addEventListener("click", () => {
    if (!confirm("Reset YOUR predictions? This will not affect actual results.")) return;
    predictionPicks = {};
    participant = { name: participant.name, submittedAt: null };
    savePrediction();
    saveParticipant();
    renderAll();
  });

  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchMode(btn.dataset.mode));
  });

  document.getElementById("openAdmin").addEventListener("click", openAdmin);
  document.getElementById("closeAdmin").addEventListener("click", closeAdmin);
  document.getElementById("adminLoginBtn").addEventListener("click", tryAdminLogin);
  document.getElementById("adminResetAll").addEventListener("click", adminResetAll);
  document.getElementById("adminExportAll").addEventListener("click", exportPredictionsCSV);
  document.getElementById("adminExportResults").addEventListener("click", exportResultsCSV);
  document.getElementById("saveApiMap").addEventListener("click", onSaveApiMap);
  document.getElementById("manualSave").addEventListener("click", onSaveManualResult);
  document.getElementById("manualMatch").addEventListener("change", onManualMatchChange);

  document.getElementById("exportCSV").addEventListener("click", exportPredictionsCSV);
  document.getElementById("exportJSON").addEventListener("click", exportPredictionsJSON);
  document.getElementById("printBracket").addEventListener("click", () => window.print());
}

/* ---------- 13. Mode switching & polling ---------- */

function switchMode(mode) {
  currentMode = mode;
  document.querySelectorAll(".mode-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
  });
  document.getElementById("liveBanner").classList.toggle("hidden", mode !== "live");
  document.getElementById("scoreboard").classList.toggle("hidden", mode !== "live");

  if (mode === "live") startPolling();
  else stopPolling();

  renderAll();
}

function startPolling() {
  // Immediate fetch
  fetchLive();
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = setInterval(fetchLive, POLL_INTERVAL_MS);
}
function stopPolling() {
  if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
}

async function fetchLive() {
  setApiStatus("fetching...");
  try {
    const res = await fetch("/api/matches", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Expect: { matches: [ { id, homeName, awayName, homeScore, awayScore, status, winnerName, winnerCode } ] }
    liveSnapshot = {};
    (data.matches || []).forEach((m) => { liveSnapshot[String(m.id)] = m; });

    // Recompute actual bracket from live + manual results
    rebuildActualPicks();
    saveActual();
    setApiStatus(`ok - ${new Date().toLocaleTimeString()}`);
  } catch (err) {
    console.warn("Live fetch failed:", err);
    setApiStatus("unavailable - use Admin > Manual Result");
  }
  renderAll();
}

function setApiStatus(text) {
  const el = document.getElementById("apiStatus");
  if (el) el.textContent = `API: ${text}`;
}

/* ---------- 14. Actual results aggregation ---------- */

/**
 * Returns the "current" live state for a bracket matchId:
 *   { status, homeScore, awayScore, winnerCode }
 * Combines:
 *   1. manualResults[matchId]  (admin override, highest priority)
 *   2. liveSnapshot[apiMap[matchId]]
 */
function currentLiveState(matchId) {
  const manual = manualResults[matchId];
  if (manual) {
    return {
      status: manual.status,
      homeScore: manual.home,
      awayScore: manual.away,
      winnerCode: manual.status === "FT" ? manual.winnerCode : null,
      source: "manual",
    };
  }
  const apiId = apiMap[matchId];
  if (apiId && liveSnapshot[String(apiId)]) {
    const s = liveSnapshot[String(apiId)];
    // The proxy emits winnerCode when status is FT. If not, try to infer from names.
    let winnerCode = s.winnerCode || null;
    if (!winnerCode && s.status === "FT" && s.homeScore != null && s.awayScore != null) {
      const m = matches[matchId];
      if (m && m.home && m.away) {
        if (s.homeScore > s.awayScore) winnerCode = m.home.code;
        else if (s.awayScore > s.homeScore) winnerCode = m.away.code;
      }
    }
    return {
      status: s.status,
      homeScore: s.homeScore,
      awayScore: s.awayScore,
      winnerCode,
      source: "api",
    };
  }
  return null;
}

/**
 * Rebuilds actualPicks for the whole bracket using live + manual data.
 * Walks r16 -> qf -> sf -> f, only sets a pick if the source match has an FT winner.
 */
function rebuildActualPicks() {
  actualPicks = {};
  // First, set any r16 winners with finished data
  const order = [
    "r16_1","r16_2","r16_3","r16_4","r16_5","r16_6","r16_7","r16_8",
    "r16_9","r16_10","r16_11","r16_12","r16_13","r16_14","r16_15","r16_16",
    "qf_l1","qf_l2","qf_l3","qf_l4","qf_r1","qf_r2","qf_r3","qf_r4",
    "sf_l1","sf_l2","sf_r1","sf_r2",
    "f_l","f_r",
    "final",
  ];
  for (const id of order) {
    const live = currentLiveState(id);
    if (live && live.status === "FT" && live.winnerCode) {
      actualPicks[id] = live.winnerCode;
    }
  }
}

/* ---------- 15. Scoreboard ---------- */

function renderScoreboard() {
  if (currentMode !== "live") return;
  let total = 0, correct = 0, wrong = 0, pending = 0;
  for (const id of Object.keys(predictionPicks)) {
    total++;
    const live = currentLiveState(id);
    const pick = predictionPicks[id];
    if (!live || live.status !== "FT" || !live.winnerCode) { pending++; continue; }
    if (live.winnerCode === pick) correct++; else wrong++;
  }
  document.getElementById("statTotal").textContent = total;
  document.getElementById("statCorrect").textContent = correct;
  document.getElementById("statWrong").textContent = wrong;
  document.getElementById("statPending").textContent = pending;
  const acc = total === 0 ? 0 : Math.round((correct / total) * 100);
  document.getElementById("statAccuracy").textContent = `${acc}%`;
}

function renderLiveBanner() {
  if (currentMode !== "live") return;
  document.getElementById("liveBannerText").textContent =
    `Live Result Mode - fetching scores every ${POLL_INTERVAL_MS / 1000}s`;
}

/* ---------- 16. Admin panel ---------- */

function openAdmin() {
  document.getElementById("adminModal").classList.remove("hidden");
  // Always show login on open
  document.getElementById("adminLogin").classList.remove("hidden");
  document.getElementById("adminBody").classList.add("hidden");
  document.getElementById("adminPassword").value = "";
  document.getElementById("adminLoginError").classList.add("hidden");
}
function closeAdmin() { document.getElementById("adminModal").classList.add("hidden"); }

function tryAdminLogin() {
  const pw = document.getElementById("adminPassword").value;
  if (pw === ADMIN_PASSWORD) {
    document.getElementById("adminLogin").classList.add("hidden");
    document.getElementById("adminBody").classList.remove("hidden");
    renderAdminApiMap();
    renderAdminManualForm();
  } else {
    document.getElementById("adminLoginError").classList.remove("hidden");
  }
}

async function adminResetAll() {
  if (!confirm("Reset ALL predictions on the SERVER for every group? This cannot be undone.")) return;
  try {
    const res = await fetch("/api/predictions", {
      method: "DELETE",
      headers: { "x-admin-pw": "admin123" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.warn("Server reset failed:", e);
    toast("Server reset failed. Local state was still cleared.");
  }
  predictionPicks = {};
  actualPicks = {};
  manualResults = {};
  participant = { name: "", submittedAt: null };
  savePrediction(); saveActual(); saveManualResults(); saveParticipant();
  toast("All data reset (server + this device).");
  renderAll();
  fetchLeaderboard();
}

function renderAdminApiMap() {
  const wrap = document.getElementById("apiMapList");
  wrap.innerHTML = "";
  // Only show R16 matches and later "set" rounds (later rounds rarely have stable api ids yet)
  const ids = Object.keys(matches).sort();
  for (const id of ids) {
    const m = matches[id];
    const label = matchLabel(m);
    const row = document.createElement("div");
    row.className = "api-map-row";
    row.innerHTML = `
      <div class="id">${id}</div>
      <div class="label">${escapeHtml(label)}</div>
      <input type="text" data-id="${id}" placeholder="API match id" value="${apiMap[id] ? escapeHtml(apiMap[id]) : ""}" />
      <div class="muted" style="font-size:11px;">Round: ${m.round.toUpperCase()}</div>
    `;
    wrap.appendChild(row);
  }
}

function onSaveApiMap() {
  const inputs = document.querySelectorAll("#apiMapList input");
  apiMap = {};
  inputs.forEach((inp) => {
    const v = inp.value.trim();
    if (v) apiMap[inp.dataset.id] = v;
  });
  saveApiMap();
  toast("API map saved.");
  if (currentMode === "live") fetchLive();
}

function renderAdminManualForm() {
  const sel = document.getElementById("manualMatch");
  sel.innerHTML = "";
  Object.values(matches).forEach((m) => {
    if (!m.home || !m.away) return;
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.id} - ${matchLabel(m)}`;
    sel.appendChild(opt);
  });
  onManualMatchChange();
}

function onManualMatchChange() {
  const id = document.getElementById("manualMatch").value;
  const winnerSel = document.getElementById("manualWinner");
  winnerSel.innerHTML = "";
  const m = matches[id];
  if (!m || !m.home || !m.away) return;
  const empty = document.createElement("option");
  empty.value = ""; empty.textContent = "-- winner --";
  winnerSel.appendChild(empty);
  for (const t of [m.home, m.away]) {
    const opt = document.createElement("option");
    opt.value = t.code;
    opt.textContent = t.name;
    winnerSel.appendChild(opt);
  }
  // Pre-populate from any existing manual result
  const cur = manualResults[id];
  document.getElementById("manualHome").value = cur ? cur.home : "";
  document.getElementById("manualAway").value = cur ? cur.away : "";
  document.getElementById("manualStatus").value = cur ? cur.status : "NS";
  document.getElementById("manualWinner").value = cur ? (cur.winnerCode || "") : "";
}

function onSaveManualResult() {
  const id = document.getElementById("manualMatch").value;
  const home = parseInt(document.getElementById("manualHome").value, 10);
  const away = parseInt(document.getElementById("manualAway").value, 10);
  const status = document.getElementById("manualStatus").value;
  const winnerCode = document.getElementById("manualWinner").value;
  if (!id) return;
  if (status === "FT" && !winnerCode) { toast("Pick a winner for Full Time."); return; }
  manualResults[id] = {
    home: isNaN(home) ? null : home,
    away: isNaN(away) ? null : away,
    status,
    winnerCode: status === "FT" ? winnerCode : null,
  };
  saveManualResults();
  rebuildActualPicks();
  saveActual();
  toast("Manual result saved.");
  renderAll();
}

function matchLabel(m) {
  if (!m.home || !m.away) return `${m.round.toUpperCase()} placeholder`;
  return `${m.home.name} vs ${m.away.name}`;
}

/* ---------- 17. Exports ---------- */

function exportPredictionsCSV() {
  const rows = [["match_id","round","home","away","prediction","submitted_by","submitted_at"]];
  const view = buildBracketView(predictionPicks).view;
  for (const id of Object.keys(view)) {
    const m = view[id];
    if (!m.home || !m.away) continue;
    const pickCode = predictionPicks[id];
    const pickName =
      !pickCode ? "" :
      m.home.code === pickCode ? m.home.name :
      m.away.code === pickCode ? m.away.name : "";
    rows.push([
      id, m.round, m.home.name, m.away.name, pickName,
      participant.name || "", participant.submittedAt || "",
    ]);
  }
  downloadCSV(rows, `wc2026_predictions_${slug(participant.name)||"anon"}.csv`);
}

function exportPredictionsJSON() {
  const out = {
    participant,
    predictions: predictionPicks,
    apiMap,
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  triggerDownload(blob, `wc2026_predictions_${slug(participant.name)||"anon"}.json`);
}

function exportResultsCSV() {
  const rows = [["match_id","round","home","away","home_score","away_score","status","actual_winner","prediction","result"]];
  const predView = buildBracketView(predictionPicks).view;
  const actView  = buildBracketView(actualPicks).view;
  for (const id of Object.keys(predView)) {
    const m = predView[id];
    if (!m.home || !m.away) continue;
    const live = currentLiveState(id) || {};
    const actM = actView[id];
    const pickCode = predictionPicks[id];
    const pickName =
      !pickCode ? "" :
      m.home.code === pickCode ? m.home.name :
      m.away.code === pickCode ? m.away.name : "";
    const actualName =
      !actualPicks[id] ? "" :
      actM.home && actM.home.code === actualPicks[id] ? actM.home.name :
      actM.away && actM.away.code === actualPicks[id] ? actM.away.name : "";
    const result =
      !pickCode ? "no-pick" :
      !actualPicks[id] ? "pending" :
      actualPicks[id] === pickCode ? "correct" : "wrong";
    rows.push([
      id, m.round, m.home.name, m.away.name,
      live.homeScore ?? "", live.awayScore ?? "",
      live.status ?? "NS",
      actualName, pickName, result,
    ]);
  }
  downloadCSV(rows, "wc2026_results.csv");
}

function downloadCSV(rows, filename) {
  const csv = rows.map((r) =>
    r.map((cell) => {
      const s = String(cell ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")
  ).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, filename);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}

function slug(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/* ---------- 18. Toast ---------- */

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2400);
}

/* =========================================================
 * 19. Server-side group predictions + leaderboard
 *     Centralised storage lives in server.js (Google Sheets OR local JSON).
 * ========================================================= */

/**
 * Submit this group's locked picks to the server. The server enforces
 * one-submission-per-group-name (case-insensitive); 409 on duplicates.
 */
async function submitToServer() {
  if (isLocked()) return;
  const name = (participant.name || "").trim();
  if (!name) { toast("Enter a group name first."); return; }

  // Need all 31 picks made before we send anything
  const view = buildBracketView(predictionPicks).view;
  let total = 0, picked = 0;
  for (const id of Object.keys(view)) {
    if (!view[id].home || !view[id].away) continue;
    total++;
    if (predictionPicks[id]) picked++;
  }
  if (total !== 31 || picked !== 31) {
    toast("Pick a winner for every match (including the Final) first.");
    return;
  }

  const btn = document.getElementById("submitPredictions");
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Submitting...";
  try {
    const res = await fetch("/api/predictions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupName: name, picks: predictionPicks }),
    });
    if (res.status === 409) {
      const data = await res.json().catch(() => ({}));
      toast(data.error || `Group "${name}" already submitted.`);
      // Reflect that lock locally by re-fetching whatever the server has.
      await checkForExistingSubmission();
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    participant.submittedAt = new Date().toISOString();
    saveParticipant();
    toast("Submitted! Picks are now visible on the Leaderboard.");
    renderAll();
    fetchLeaderboard();
  } catch (err) {
    console.warn("Submit failed:", err);
    toast("Could not save to the server. Check your connection and try again.");
  } finally {
    btn.textContent = originalLabel;
    refreshSubmitState();
  }
}

/**
 * Asks the server if this group name already has a submitted bracket.
 * If yes, adopt the picks and lock the UI - so a group that submitted
 * from a different device sees their entry waiting for them here too.
 */
async function checkForExistingSubmission() {
  const name = (participant.name || "").trim();
  if (!name) return;
  try {
    const res = await fetch(`/api/predictions?group=${encodeURIComponent(name)}`);
    if (!res.ok) return;
    const data = await res.json();
    const existing = data.prediction;
    if (existing && existing.picks) {
      predictionPicks = { ...existing.picks };
      participant.submittedAt = existing.submittedAt || new Date().toISOString();
      savePrediction();
      saveParticipant();
      renderAll();
    }
  } catch (e) {
    console.warn("checkForExistingSubmission failed:", e);
  }
}

/**
 * Fetch + render the leaderboard. Called on bootstrap, every 60s after that,
 * and immediately after a successful submit.
 */
async function fetchLeaderboard() {
  try {
    const res = await fetch("/api/leaderboard");
    if (!res.ok) return;
    const data = await res.json();
    renderLeaderboard(data);
  } catch (e) {
    console.warn("fetchLeaderboard failed:", e);
  }
}

function renderLeaderboard(data) {
  const tbody = document.getElementById("leaderboardBody");
  if (!tbody) return;
  const board = data.leaderboard || [];
  const byName = new Map(board.map((r) => [r.groupName, r]));

  // Merge: every TEAM_LIST entry gets a row. Submitted teams show their stats,
  // unsubmitted teams show "Not submitted" in the champion cell.
  const merged = TEAM_LIST.map((name) => {
    const row = byName.get(name);
    return row || { groupName: name, submittedAt: "", championPick: "", total: 0, correct: 0, wrong: 0, pending: 0, _unsubmitted: true };
  });
  // Sort: submitted teams first (by correct desc, pending asc), then unsubmitted alphabetically
  merged.sort((a, b) => {
    if (a._unsubmitted && !b._unsubmitted) return 1;
    if (!a._unsubmitted && b._unsubmitted) return -1;
    if (a._unsubmitted && b._unsubmitted) return a.groupName.localeCompare(b.groupName);
    return b.correct - a.correct || a.pending - b.pending || a.groupName.localeCompare(b.groupName);
  });

  document.getElementById("leaderboardCount").textContent = board.length;
  document.getElementById("leaderboardDecided").textContent = data.decidedMatches ?? 0;

  tbody.innerHTML = "";
  merged.forEach((row, i) => {
    const tr = document.createElement("tr");
    if (row._unsubmitted) tr.classList.add("unsubmitted");
    const champion = row._unsubmitted
      ? `<span class="muted">Not submitted yet</span>`
      : escapeHtml(teamNameByCode(row.championPick) || row.championPick || "—");
    const submitted = row.submittedAt ? new Date(row.submittedAt).toLocaleString() : "";
    tr.innerHTML = `
      <td class="col-rank">${row._unsubmitted ? "—" : i + 1}</td>
      <td class="col-group">${escapeHtml(row.groupName)}</td>
      <td class="col-correct">${row._unsubmitted ? "—" : `<strong>${row.correct}</strong>`}</td>
      <td class="col-pending">${row._unsubmitted ? "—" : row.pending}</td>
      <td class="col-champion">${champion}</td>
      <td class="col-submitted">${escapeHtml(submitted)}</td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Looks up a team's display name by its country code, scanning the
 * known R16 matchups. Used for showing "Champion Pick" cells without
 * making participants stare at country codes.
 */
function teamNameByCode(code) {
  if (!code) return null;
  for (const m of R16_MATCHES) {
    if (m.home.code === code) return m.home.name;
    if (m.away.code === code) return m.away.name;
  }
  return null;
}
