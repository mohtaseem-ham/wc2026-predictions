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
  "Team 10 - GOAL Getters",
  "Team 11 - Shoot w Shouf",
  "Team 12 - Top of the Table",
  "Team 14 - Final Whistle",
  "Team 16 - JoyalAzamRositaZedrickMichael",
  "Team 17 - OthmanIbrahimIreneAngeloFred",
  "Team 18 - MilanSaadLyaMailinDibbah",
  "Team 19 - MostafaDulajNourIfrazEduard",
  "Team 20 - AyaShahadZakiShadyRavi",
  "Team 21 - Manchester United",
  "Team 22 - Liverpool",
  "Team 23 - Al Ahly",
  "Team 31 - The Elite Team",
  "Team 33 - Fortunate",
  "Team 34 - Futurologists",
  "Team 36 - Footy Forecast",
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
// Submission deadline (ms since epoch) - populated from /api/health on boot
let deadlineMs = null;
let deadlineTimer = null;
let deadlinePassedNotified = false;

function isDeadlinePassed() {
  return !!deadlineMs && Date.now() > deadlineMs;
}

/* ---------- 4. Bootstrap ---------- */

document.addEventListener("DOMContentLoaded", () => {
  loadState();
  buildBracketSkeleton();
  bindGlobalUI();
  renderAll();
  // Server-side state: deadline, leaderboard, actuals, prior submission check.
  fetchDeadline();
  fetchLeaderboard();
  fetchLive(); // Pre-populate actuals so the bracket shows real scores immediately
  setInterval(fetchLeaderboard, 60_000);
  setInterval(fetchLive, 60_000);
  if (participant.name) checkForExistingSubmission();
});

/* ---------- 5. Persistence ---------- */

function loadState() {
  predictionPicks = safeParse(localStorage.getItem(STORAGE_KEYS.prediction), {});
  participant     = safeParse(localStorage.getItem(STORAGE_KEYS.participant), { name: "", submittedAt: null });
  apiMap          = safeParse(localStorage.getItem(STORAGE_KEYS.apiMap), {});
  actualPicks     = safeParse(localStorage.getItem(STORAGE_KEYS.actual), {});
  manualResults   = safeParse(localStorage.getItem(STORAGE_KEYS.manualResults), {});

  // Migrate legacy "winner-only" picks (string values) to the new {h,a,w} shape
  // by simply dropping them. We can't infer the scores after the fact.
  let migrated = false;
  for (const id of Object.keys(predictionPicks)) {
    if (typeof predictionPicks[id] === "string") {
      delete predictionPicks[id];
      migrated = true;
    }
  }
  if (migrated) {
    participant.submittedAt = null;
    savePrediction();
    saveParticipant();
  }
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

    // For FT matches use the actual winner for advancement, regardless of
    // what the user picked - so the bracket visually reflects real results.
    let winnerCode = null;
    const live = currentLiveState(id);
    if (live && live.status === "FT" && live.winnerCode) {
      winnerCode = live.winnerCode;
    } else {
      winnerCode = winnerOf(picks[id]);
    }
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

// A match is locked for prediction once it's LIVE/HT/FT - no late submitters
// get to predict it, the card shows the actual score read-only.
function isMatchLocked(matchId) {
  const live = currentLiveState(matchId);
  return !!(live && live.status && live.status !== "NS");
}

/* Helpers for the (home goals, away goals, winner) pick shape */
function winnerOf(pick) {
  if (!pick) return null;
  if (typeof pick === "string") return pick;   // legacy format
  return pick.w || null;
}
function homeOf(pick) {
  if (!pick || typeof pick !== "object") return null;
  return typeof pick.h === "number" ? pick.h : null;
}
function awayOf(pick) {
  if (!pick || typeof pick !== "object") return null;
  return typeof pick.a === "number" ? pick.a : null;
}
function isPickComplete(pick) {
  // A pick only needs an advancing team (.w) to be submittable.
  // Scores are optional - filling them in unlocks the +1 exact-score bonus.
  return !!pick && typeof pick === "object" && !!pick.w;
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
  const wrap = document.createElement("div");
  wrap.className = "match";
  wrap.dataset.matchId = matchId;

  const pick = predictionPicks[matchId];
  const winnerCode = winnerOf(pick);
  const live = currentLiveState(matchId);
  const actualWinner = winnerOf(actualPicks[matchId]);

  // Status classes for live mode coloring
  if (live && live.status === "LIVE") wrap.classList.add("live");
  if (live && live.status === "FT") {
    wrap.classList.add("ft");
    if (winnerCode && actualWinner) {
      wrap.classList.add(winnerCode === actualWinner ? "correct" : "wrong");
    }
  }

  // Two stacked team rows + scores
  wrap.appendChild(renderTeamRow(matchId, "home", teams.home, pick, actualWinner, live));
  wrap.appendChild(renderTeamRow(matchId, "away", teams.away, pick, actualWinner, live));

  // Status pill - always show in live mode; in prediction mode show only for
  // matches that have actually started/finished (so we don't render an
  // unnecessary "Not Started" pill on every card during prediction)
  const showStatusLine = currentMode === "live"
    || (live && live.status && live.status !== "NS");
  if (showStatusLine) {
    const sline = document.createElement("div");
    sline.className = "status-line";

    const statusPill = document.createElement("span");
    statusPill.className = "status-pill";
    let statusLabel = "Not Started";
    if (live && live.status === "LIVE") { statusPill.classList.add("live"); statusLabel = "Live"; }
    else if (live && live.status === "HT") { statusPill.classList.add("ht"); statusLabel = "Half Time"; }
    else if (live && live.status === "FT") { statusPill.classList.add("ft"); statusLabel = "Full Time"; }
    statusPill.textContent = statusLabel;
    sline.appendChild(statusPill);

    if (currentMode === "live" && isPickComplete(pick)) {
      const badge = document.createElement("span");
      badge.className = "result-badge";
      if (!live || live.status !== "FT") {
        badge.classList.add("pending");
        badge.textContent = "Pending";
      } else {
        const pts = scoreMatchClient(pick, live);
        badge.classList.add(pts > 0 ? "correct" : "wrong");
        badge.textContent = `${pts} pt${pts === 1 ? "" : "s"}`;
      }
      sline.appendChild(badge);
    }
    wrap.appendChild(sline);
  }

  return wrap;
}

function renderTeamRow(matchId, slot, team, pick, actualWinnerCode, live) {
  const row = document.createElement("div");
  row.className = "team-row";
  row.dataset.slot = slot;

  if (!team) {
    row.classList.add("placeholder");
    row.innerHTML = `
      <div class="flag" style="background:#1b2a64;"></div>
      <span class="name">TBD</span>
      <input class="score-input" type="number" disabled />
    `;
    return row;
  }

  const locked = !!(live && live.status && live.status !== "NS");
  const winnerCode = winnerOf(pick);
  const isPicked = winnerCode === team.code;
  const isActualWinner = actualWinnerCode === team.code;

  // Visual classes
  if (locked) row.classList.add("locked");
  if (!locked && isPicked) row.classList.add("selected");
  if (!locked && currentMode === "prediction" && winnerCode && !isPicked) row.classList.add("eliminated");
  if (locked && isActualWinner) row.classList.add("actual-winner");
  if (locked && actualWinnerCode && !isActualWinner) row.classList.add("eliminated");

  const actualScore = locked ? (slot === "home" ? live.homeScore : live.awayScore) : null;
  const predScore = slot === "home" ? homeOf(pick) : awayOf(pick);

  // Locked card: show actual score read-only, no inputs, not clickable.
  // For penalty-shootout matches, append the shootout count: "1 (4)".
  if (locked) {
    const pens = slot === "home" ? live.homePens : live.awayPens;
    const showPens = pens != null;
    row.innerHTML = `
      <img class="flag" src="${flagUrl(team.code)}" alt="${escapeHtml(team.name)} flag" loading="lazy" />
      <span class="name">${escapeHtml(team.name)}</span>
      <div class="score-cell">
        <span class="locked-score">${actualScore != null ? actualScore : "-"}</span>${showPens ? `<span class="pen-score">(${pens})</span>` : ""}
      </div>
    `;
    return row;
  }

  // Open for prediction: editable scores + clickable team row
  row.innerHTML = `
    <img class="flag" src="${flagUrl(team.code)}" alt="${escapeHtml(team.name)} flag" loading="lazy" />
    <span class="name">${escapeHtml(team.name)}</span>
    <div class="score-cell">
      <input class="score-input" type="number" inputmode="numeric" min="0" max="20"
             value="${predScore == null ? "" : predScore}" aria-label="Predicted ${slot} goals" />
    </div>
  `;

  row.addEventListener("click", (e) => {
    if (e.target.closest(".score-input")) return;
    onWinnerClick(matchId, team);
  });
  const input = row.querySelector(".score-input");
  input.addEventListener("input", (e) => onScoreInput(matchId, slot, e.target.value));
  input.addEventListener("click", (e) => e.stopPropagation());

  return row;
}

// Client-side scoring (mirrors the server) so the per-match "Pending / N pts" badge
// can render without a round-trip in live mode.
function scoreMatchClient(predicted, actual) {
  if (!predicted || !predicted.w) return 0;
  if (!actual || actual.status !== "FT" || !actual.winnerCode) return 0;
  if (predicted.w !== actual.winnerCode) return 0;
  if (predicted.h != null && predicted.a != null
      && predicted.h === actual.homeScore && predicted.a === actual.awayScore) {
    return 6;
  }
  return 5;
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

function isLocked() {
  // Locked when this user has already submitted OR the global deadline passed.
  return !!participant.submittedAt || isDeadlinePassed();
}

function onWinnerClick(matchId, team) {
  if (currentMode !== "prediction") { toast("Switch to Prediction Mode to make picks."); return; }
  if (isLocked()) { toast("Predictions are locked. Submit was final."); return; }
  if (isMatchLocked(matchId)) { toast("This match has already started - it's no longer predictable."); return; }

  const view = buildBracketView(predictionPicks).view;
  const m = view[matchId];
  if (!m.home || !m.away) return;
  if (m.home.code !== team.code && m.away.code !== team.code) return;

  const existing = predictionPicks[matchId];
  if (winnerOf(existing) === team.code) return; // no-op

  // Preserve any scores the user already typed, just flip the winner
  predictionPicks[matchId] = { h: homeOf(existing), a: awayOf(existing), w: team.code };
  clearDownstreamPicks(matchId, predictionPicks);
  savePrediction();
  refreshSubmitState();
  renderAll();
}

function onScoreInput(matchId, slot, raw) {
  if (currentMode !== "prediction" || isLocked()) return;
  if (isMatchLocked(matchId)) return;
  const view = buildBracketView(predictionPicks).view;
  const m = view[matchId];
  if (!m || !m.home || !m.away) return;

  let n = raw === "" ? null : parseInt(raw, 10);
  if (n != null && (isNaN(n) || n < 0)) return;
  if (n != null && n > 20) n = 20;

  const existing = predictionPicks[matchId] || {};
  const updated = { h: existing.h ?? null, a: existing.a ?? null, w: existing.w || null };
  if (slot === "home") updated.h = n; else updated.a = n;

  // If both scores entered and unequal, auto-set the advancing team to the higher scorer.
  // Equal scores keep the user's existing winner choice (knockout draws need an explicit pick).
  if (typeof updated.h === "number" && typeof updated.a === "number" && updated.h !== updated.a) {
    const inferredWinner = updated.h > updated.a ? m.home.code : m.away.code;
    if (updated.w !== inferredWinner) {
      updated.w = inferredWinner;
      // Downstream may now be invalid since the winner changed
      predictionPicks[matchId] = updated;
      clearDownstreamPicks(matchId, predictionPicks);
      savePrediction();
      refreshSubmitState();
      renderAll();
      return;
    }
  }

  predictionPicks[matchId] = updated;
  savePrediction();
  refreshSubmitState();
  // Don't full re-render on every keystroke - just nudge the submit state
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
  // Submit unlocks when every PREDICTABLE match (NS only) has an advancing
  // team picked. Already-started matches don't count - late submitters get
  // a smaller bracket to fill in.
  const view = buildBracketView(predictionPicks).view;
  let total = 0, picked = 0;
  for (const id of Object.keys(view)) {
    const m = view[id];
    if (!m.home || !m.away) continue;
    if (isMatchLocked(id)) continue;
    total++;
    if (isPickComplete(predictionPicks[id])) picked++;
  }
  const allFilled = total > 0 && picked === total;
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

  // Admin button removed from UI - guard against missing elements
  document.getElementById("openAdmin")?.addEventListener("click", openAdmin);
  document.getElementById("closeAdmin")?.addEventListener("click", closeAdmin);
  document.getElementById("adminLoginBtn")?.addEventListener("click", tryAdminLogin);
  document.getElementById("adminResetAll")?.addEventListener("click", adminResetAll);
  document.getElementById("adminExportAll")?.addEventListener("click", exportPredictionsCSV);
  document.getElementById("adminExportResults")?.addEventListener("click", exportResultsCSV);
  document.getElementById("saveApiMap")?.addEventListener("click", onSaveApiMap);
  document.getElementById("manualSave")?.addEventListener("click", onSaveManualResult);
  document.getElementById("manualMatch")?.addEventListener("change", onManualMatchChange);

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
  document.getElementById("liveBanner")?.classList.toggle("hidden", mode !== "live");
  document.getElementById("scoreboard")?.classList.toggle("hidden", mode !== "live");

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
    // Use the server-merged actuals (live API + manual overrides). No need
    // for the per-browser apiMap any more - the server auto-maps R32
    // matches by team codes.
    const res = await fetch("/api/actuals", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const actuals = data.actuals || {};

    // Store keyed by bracket id directly (no provider id translation needed)
    liveSnapshot = {};
    for (const [matchId, r] of Object.entries(actuals)) {
      liveSnapshot[matchId] = {
        homeScore: r.home,
        awayScore: r.away,
        homePens: r.homePens ?? null,
        awayPens: r.awayPens ?? null,
        status: r.status,
        winnerCode: r.winnerCode,
      };
    }

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
  // Local admin manual results win (legacy localStorage-only path)
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
  // Server-merged actuals (live API + server-side manual overrides),
  // already keyed by bracket id.
  const s = liveSnapshot[matchId];
  if (s) {
    return {
      status: s.status,
      homeScore: s.homeScore,
      awayScore: s.awayScore,
      homePens: s.homePens ?? null,
      awayPens: s.awayPens ?? null,
      winnerCode: s.winnerCode || null,
      source: "server",
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
  // KPI cards were removed - the Leaderboard panel below already shows
  // per-team points/correct/pending. Kept as a no-op so callers don't break.
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

  // Need every PREDICTABLE (NS) match picked before sending. Already-started
  // matches are excluded - late submitters don't have to (and can't) pick them.
  const view = buildBracketView(predictionPicks).view;
  let total = 0, picked = 0;
  for (const id of Object.keys(view)) {
    if (!view[id].home || !view[id].away) continue;
    if (isMatchLocked(id)) continue;
    total++;
    if (isPickComplete(predictionPicks[id])) picked++;
  }
  if (total === 0 || picked !== total) {
    toast("Pick an advancing team for every open match first.");
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
      await checkForExistingSubmission();
      return;
    }
    if (res.status === 423) {
      toast("Predictions are closed. The deadline has passed.");
      await fetchDeadline();
      renderAll();
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
    if (!existing || !existing.hasSubmitted) return;

    // Team has already submitted. Server intentionally does NOT return picks
    // (privacy). If this browser has the matching local lock + draft, great -
    // the lock badge stays. Otherwise (fresh device or different person)
    // reject the selection and reset.
    if (isLocked() && (participant.submittedAt === existing.submittedAt)) {
      return; // Owner viewing their own locked state - nothing to do
    }
    toast(`"${existing.groupName}" has already submitted. Pick a different team.`);
    participant.name = "";
    predictionPicks = {};
    participant.submittedAt = null;
    saveParticipant();
    savePrediction();
    const select = document.getElementById("participantName");
    if (select) select.value = "";
    fetchLeaderboard();
    renderAll();
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

  // Lock the dropdown for any team that has already submitted (except this
  // user's own team, so they still see it selected). Prevents both
  // impersonation and accidental duplicate-submit attempts.
  updateDropdownLocks(board.map((r) => r.groupName));

  // Merge: every team in TEAM_LIST gets a row, even unsubmitted ones.
  const merged = TEAM_LIST.map((name) => {
    const row = byName.get(name);
    return row || { groupName: name, submittedAt: "", points: 0, correct: 0, wrong: 0, pending: 0, _unsubmitted: true };
  });
  // Sort: submitted teams first (by points desc, pending asc), then unsubmitted alphabetically.
  merged.sort((a, b) => {
    if (a._unsubmitted && !b._unsubmitted) return 1;
    if (!a._unsubmitted && b._unsubmitted) return -1;
    if (a._unsubmitted && b._unsubmitted) return a.groupName.localeCompare(b.groupName);
    return b.points - a.points || a.pending - b.pending || a.groupName.localeCompare(b.groupName);
  });

  document.getElementById("leaderboardCount").textContent = board.length;
  document.getElementById("leaderboardDecided").textContent = data.decidedMatches ?? 0;

  tbody.innerHTML = "";
  merged.forEach((row, i) => {
    const tr = document.createElement("tr");
    if (row._unsubmitted) tr.classList.add("unsubmitted");
    const submitted = row.submittedAt ? new Date(row.submittedAt).toLocaleString() : "";
    tr.innerHTML = `
      <td class="col-rank">${row._unsubmitted ? "—" : i + 1}</td>
      <td class="col-group">${escapeHtml(row.groupName)}</td>
      <td class="col-points">${row._unsubmitted ? "—" : `<strong>${row.points}</strong>`}</td>
      <td class="col-correct">${row._unsubmitted ? "—" : row.correct}</td>
      <td class="col-pending">${row._unsubmitted ? "—" : row.pending}</td>
      <td class="col-submitted">${row._unsubmitted ? `<span class="muted">Not submitted yet</span>` : escapeHtml(submitted)}</td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Marks already-submitted teams as disabled in the dropdown so other people
 * can't pick them. The user's own team stays enabled (so the selected option
 * still displays after they've submitted).
 */
function updateDropdownLocks(submittedNames) {
  const select = document.getElementById("participantName");
  if (!select) return;
  const submittedSet = new Set((submittedNames || []).map((n) => n.toLowerCase()));
  const myName = (participant.name || "").trim().toLowerCase();

  for (const opt of select.options) {
    if (!opt.value) continue; // skip the empty placeholder
    const v = opt.value.toLowerCase();
    const isSubmitted = submittedSet.has(v);
    const isMine = v === myName;

    // Strip any previously-appended "(submitted)" suffix
    const baseLabel = opt.textContent.replace(/ \(submitted\)\s*$/, "");

    if (isSubmitted && !isMine) {
      opt.disabled = true;
      opt.textContent = baseLabel + " (submitted)";
    } else {
      opt.disabled = false;
      opt.textContent = baseLabel;
    }
  }

  // Edge case: this device has local draft picks for a team that just got
  // submitted by someone else from another device. Clear the draft so we
  // don't accidentally let them try to overwrite.
  if (myName && submittedSet.has(myName) && !isLocked()) {
    predictionPicks = {};
    participant.name = "";
    savePrediction();
    saveParticipant();
    select.value = "";
    toast("Your team was just submitted from another device. Pick a different team.");
    renderAll();
  }
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

/* =========================================================
 * 20. Submission deadline + live countdown
 *     Pulled from /api/health so the server is the source of truth.
 * ========================================================= */

async function fetchDeadline() {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) return;
    const data = await res.json();
    deadlineMs = Number(data.deadlineMs) || Date.parse(data.deadline);
    if (!deadlineMs || isNaN(deadlineMs)) return;
    startDeadlineCountdown();
  } catch (e) {
    console.warn("fetchDeadline failed:", e);
  }
}

function startDeadlineCountdown() {
  if (deadlineTimer) clearInterval(deadlineTimer);
  updateDeadlineCountdown();
  deadlineTimer = setInterval(updateDeadlineCountdown, 1000);
}

function updateDeadlineCountdown() {
  const banner = document.getElementById("deadlineBanner");
  const countdownEl = document.getElementById("deadlineCountdown");
  const labelEl = document.getElementById("deadlineLabel");
  if (!banner || !countdownEl || !deadlineMs) return;

  // Human-readable label in Dubai time
  if (labelEl) {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Dubai",
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
    labelEl.textContent = fmt.format(new Date(deadlineMs)) + " Dubai";
  }

  const remaining = deadlineMs - Date.now();
  banner.classList.remove("hidden");

  if (remaining <= 0) {
    countdownEl.textContent = "00:00:00";
    banner.classList.add("closed");
    banner.querySelector(".deadline-icon").textContent = "🔒"; // lock
    banner.querySelector(".deadline-headline").textContent = "Predictions are now closed.";
    banner.querySelector(".deadline-sub").textContent = "No new submissions are accepted.";
    if (deadlineTimer) { clearInterval(deadlineTimer); deadlineTimer = null; }
    // Re-render once so dropdown/inputs reflect the locked state
    if (!deadlinePassedNotified) {
      deadlinePassedNotified = true;
      renderAll();
      fetchLeaderboard();
    }
    return;
  }

  const days  = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const mins  = Math.floor((remaining % 3_600_000) / 60_000);
  const secs  = Math.floor((remaining % 60_000) / 1_000);
  const pad = (n) => String(n).padStart(2, "0");
  countdownEl.textContent = days > 0
    ? `${days}d ${pad(hours)}:${pad(mins)}:${pad(secs)}`
    : `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}
