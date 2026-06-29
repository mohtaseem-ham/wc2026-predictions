/* =========================================================
 * WC 2026 Predictions - Backend / API Proxy + Storage
 *
 * What this server does:
 *   1) Hides the football live-score API key behind /api/matches.
 *   2) Stores group predictions centrally so all 11 office groups can
 *      submit from any device and a shared leaderboard is computed.
 *
 * Endpoints:
 *   GET    /api/health
 *   GET    /api/matches                -> live matches via configured provider
 *   GET    /api/match/:apiMatchId
 *   GET    /api/predictions[?group=X]  -> all groups' predictions, or one
 *   POST   /api/predictions            -> { groupName, picks } - locks group
 *   DELETE /api/predictions            -> admin reset (header x-admin-pw)
 *   GET    /api/leaderboard            -> ranked groups by correct picks
 *   GET    /api/results                -> manual/known results
 *   POST   /api/results                -> admin manual result (x-admin-pw)
 *
 * Storage adapter picks based on env:
 *   GOOGLE_SHEET_ID + GOOGLE_SA_KEY_BASE64 set -> Google Sheets
 *   Otherwise                                  -> data/predictions.json
 *
 * Add real providers by writing a handler in `providers` below.
 * ========================================================= */

const path = require("path");
const fs = require("fs");
const express = require("express");
require("dotenv").config();

const PORT = parseInt(process.env.PORT, 10) || 3000;
const PROVIDER = (process.env.API_PROVIDER || "mock").toLowerCase();
const API_KEY = process.env.API_KEY || "";
const API_BASE_URL = process.env.API_BASE_URL || "";
const API_COMPETITION_ID = process.env.API_COMPETITION_ID || "";
const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS, 10) || 30_000;

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || "";
const GOOGLE_SA_KEY_BASE64 = process.env.GOOGLE_SA_KEY_BASE64 || "";
const PREDICTIONS_SHEET_NAME = process.env.PREDICTIONS_SHEET_NAME || "Predictions";
const RESULTS_SHEET_NAME = process.env.RESULTS_SHEET_NAME || "Results";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const PREDICTIONS_FILE = path.join(__dirname, "data", "predictions.json");

// Stable column order for the predictions sheet (also used by file adapter)
const MATCH_ORDER = [
  "r16_1","r16_2","r16_3","r16_4","r16_5","r16_6","r16_7","r16_8",
  "r16_9","r16_10","r16_11","r16_12","r16_13","r16_14","r16_15","r16_16",
  "qf_l1","qf_l2","qf_l3","qf_l4","qf_r1","qf_r2","qf_r3","qf_r4",
  "sf_l1","sf_l2","sf_r1","sf_r2",
  "f_l","f_r",
  "final",
];
const PREDICTIONS_HEADER = ["group_name", "submitted_at", "champion_pick", ...MATCH_ORDER];
const RESULTS_HEADER     = ["match_id", "home_score", "away_score", "status", "winner_code", "updated_at"];

/* ----------------- Scoring (5/3/1/0) -----------------
 * Each pick is { h, a, w }:  predicted home goals, away goals, advancing team.
 * Each actual result is { home, away, status, winnerCode }.
 *   5 pts  - exact score
 *   3 pts  - right result (W/D/L) AND right goal difference
 *   1 pt   - right result only
 *   0 pts  - otherwise
 * --------------------------------------------------- */
function scoreMatch(pred, actual) {
  if (!pred || pred.h == null || pred.a == null) return 0;
  if (!actual || actual.status !== "FT" || actual.home == null || actual.away == null) return 0;
  if (pred.h === actual.home && pred.a === actual.away) return 5;
  const predRes = Math.sign(pred.h - pred.a);
  const actRes  = Math.sign(actual.home - actual.away);
  if (predRes !== actRes) return 0;
  const predDiff = Math.abs(pred.h - pred.a);
  const actDiff  = Math.abs(actual.home - actual.away);
  return predDiff === actDiff ? 3 : 1;
}

/* Pick (de)serialisation for the Sheets cell format: "2-1/de" */
function serializePick(p) {
  if (!p || p.h == null || p.a == null || !p.w) return "";
  return `${p.h}-${p.a}/${p.w}`;
}
function parsePick(cell) {
  if (!cell) return null;
  const m = String(cell).match(/^(\d+)-(\d+)\/(.+)$/);
  if (!m) return null;
  return { h: parseInt(m[1], 10), a: parseInt(m[2], 10), w: m[3] };
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

/* ----------------- In-memory cache ----------------- */
const cache = new Map(); // key -> { ts, data }
function cacheGet(key) {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
  return v.data;
}
function cacheSet(key, data) { cache.set(key, { ts: Date.now(), data }); }

/* ----------------- Normalised match shape -----------------
 * {
 *   id:         string,         // provider match id
 *   homeName:   string,
 *   awayName:   string,
 *   homeCode:   string|null,    // ISO alpha-2 if provider supplies; nullable
 *   awayCode:   string|null,
 *   homeScore:  number|null,
 *   awayScore:  number|null,
 *   status:     "NS" | "LIVE" | "HT" | "FT",
 *   winnerName: string|null,
 *   winnerCode: string|null,
 *   utcDate:    string|null
 * }
 * --------------------------------------------------- */

/* ----------------- Provider registry ----------------- */
const providers = {
  /**
   * MOCK provider - no key, randomized scores. Use to demo the UI.
   * Generates 16 mock matches with ids "wc-r16-1" .. "wc-r16-16".
   */
  mock: {
    async listMatches() {
      const teams = [
        ["Germany","de","Paraguay","py"],["France","fr","Sweden","se"],
        ["South Africa","za","Canada","ca"],["Netherlands","nl","Morocco","ma"],
        ["Portugal","pt","Croatia","hr"],["Spain","es","Austria","at"],
        ["USA","us","Bosnia & Herzegovina","ba"],["Belgium","be","Senegal","sn"],
        ["Brazil","br","Japan","jp"],["Cote d'Ivoire","ci","Norway","no"],
        ["Mexico","mx","Ecuador","ec"],["England","gb-eng","DR Congo","cd"],
        ["Argentina","ar","Cape Verde","cv"],["Australia","au","Egypt","eg"],
        ["Switzerland","ch","Algeria","dz"],["Colombia","co","Ghana","gh"],
      ];
      const statuses = ["NS","NS","LIVE","HT","FT","FT"];
      return teams.map(([h, hc, a, ac], i) => {
        const status = statuses[i % statuses.length];
        const homeScore = status === "NS" ? null : Math.floor(Math.random() * 4);
        const awayScore = status === "NS" ? null : Math.floor(Math.random() * 4);
        let winnerCode = null, winnerName = null;
        if (status === "FT") {
          if (homeScore > awayScore) { winnerCode = hc; winnerName = h; }
          else if (awayScore > homeScore) { winnerCode = ac; winnerName = a; }
          else { // mock tie-break -> home wins
            winnerCode = hc; winnerName = h;
          }
        }
        return {
          id: `wc-r16-${i + 1}`,
          homeName: h, awayName: a,
          homeCode: hc, awayCode: ac,
          homeScore, awayScore, status,
          winnerName, winnerCode,
          utcDate: null,
        };
      });
    },
    async getMatch(id) {
      const all = await this.listMatches();
      return all.find((m) => m.id === id) || null;
    },
  },

  /**
   * football-data.org v4.  Free tier is rate-limited.
   *   Auth header: X-Auth-Token
   *   Competition: "WC" or "FIFA"
   */
  footballdata: {
    async listMatches() {
      const base = API_BASE_URL || "https://api.football-data.org/v4";
      const comp = API_COMPETITION_ID || "WC";
      const res = await fetch(`${base}/competitions/${comp}/matches?stage=LAST_16`, {
        headers: { "X-Auth-Token": API_KEY },
      });
      if (!res.ok) throw new Error(`football-data error ${res.status}`);
      const json = await res.json();
      return (json.matches || []).map(normaliseFootballData);
    },
    async getMatch(id) {
      const base = API_BASE_URL || "https://api.football-data.org/v4";
      const res = await fetch(`${base}/matches/${id}`, {
        headers: { "X-Auth-Token": API_KEY },
      });
      if (!res.ok) throw new Error(`football-data error ${res.status}`);
      const json = await res.json();
      return normaliseFootballData(json);
    },
  },

  /**
   * api-football (RapidAPI / api-sports.io).
   *   Header: x-apisports-key  (api-sports.io)
   *           x-rapidapi-key + x-rapidapi-host (RapidAPI)
   */
  apifootball: {
    async listMatches() {
      const base = API_BASE_URL || "https://v3.football.api-sports.io";
      const league = API_COMPETITION_ID || "1"; // 1 = World Cup in api-football
      const season = process.env.API_SEASON || "2026";
      const res = await fetch(`${base}/fixtures?league=${league}&season=${season}`, {
        headers: { "x-apisports-key": API_KEY },
      });
      if (!res.ok) throw new Error(`api-football error ${res.status}`);
      const json = await res.json();
      return (json.response || []).map(normaliseApiFootball);
    },
    async getMatch(id) {
      const base = API_BASE_URL || "https://v3.football.api-sports.io";
      const res = await fetch(`${base}/fixtures?id=${id}`, {
        headers: { "x-apisports-key": API_KEY },
      });
      if (!res.ok) throw new Error(`api-football error ${res.status}`);
      const json = await res.json();
      const item = (json.response || [])[0];
      return item ? normaliseApiFootball(item) : null;
    },
  },

  /**
   * SportMonks Football (PLACEHOLDER - fill in once you've picked a plan).
   */
  sportmonks: {
    async listMatches() { throw new Error("SportMonks adapter not implemented yet."); },
    async getMatch() { throw new Error("SportMonks adapter not implemented yet."); },
  },
};

/* ----------------- Provider helpers ----------------- */

function normaliseFootballData(m) {
  const status = mapStatusFootballData(m.status);
  const home = m.homeTeam || {};
  const away = m.awayTeam || {};
  const homeScore = pickScoreFootballData(m, "home");
  const awayScore = pickScoreFootballData(m, "away");
  let winnerName = null, winnerCode = null;
  if (status === "FT") {
    if (homeScore != null && awayScore != null) {
      if (homeScore > awayScore) { winnerName = home.name; winnerCode = toIso2(home.tla || home.name); }
      else if (awayScore > homeScore) { winnerName = away.name; winnerCode = toIso2(away.tla || away.name); }
    }
  }
  return {
    id: String(m.id),
    homeName: home.name, awayName: away.name,
    homeCode: toIso2(home.tla || home.name),
    awayCode: toIso2(away.tla || away.name),
    homeScore, awayScore, status,
    winnerName, winnerCode,
    utcDate: m.utcDate || null,
  };
}
function mapStatusFootballData(s) {
  switch (s) {
    case "IN_PLAY": return "LIVE";
    case "PAUSED":  return "HT";
    case "FINISHED": case "AWARDED": return "FT";
    default: return "NS";
  }
}
function pickScoreFootballData(m, side) {
  // Prefer fullTime if present, else current
  const ft = m.score?.fullTime?.[side];
  if (ft != null) return ft;
  return m.score?.[side] ?? null;
}

function normaliseApiFootball(item) {
  const fixture = item.fixture || {};
  const teams = item.teams || {};
  const goals = item.goals || {};
  const status = mapStatusApiFootball(fixture.status?.short);
  let winnerCode = null, winnerName = null;
  if (status === "FT" && goals.home != null && goals.away != null) {
    if (goals.home > goals.away) { winnerName = teams.home?.name; winnerCode = toIso2(teams.home?.name); }
    else if (goals.away > goals.home) { winnerName = teams.away?.name; winnerCode = toIso2(teams.away?.name); }
  }
  return {
    id: String(fixture.id),
    homeName: teams.home?.name, awayName: teams.away?.name,
    homeCode: toIso2(teams.home?.name),
    awayCode: toIso2(teams.away?.name),
    homeScore: goals.home ?? null, awayScore: goals.away ?? null,
    status, winnerName, winnerCode,
    utcDate: fixture.date || null,
  };
}
function mapStatusApiFootball(s) {
  if (!s) return "NS";
  if (["1H","2H","ET","P","LIVE"].includes(s)) return "LIVE";
  if (s === "HT") return "HT";
  if (["FT","AET","PEN"].includes(s)) return "FT";
  return "NS";
}

/**
 * Best-effort country-name -> ISO alpha-2 mapping, covering the 32
 * teams the bracket actually uses. Returns null on unknown.
 * Extend this as you add more competitions.
 */
const NAME_TO_ISO = {
  "germany": "de", "paraguay": "py", "france": "fr", "sweden": "se",
  "south africa": "za", "canada": "ca", "netherlands": "nl", "morocco": "ma",
  "portugal": "pt", "croatia": "hr", "spain": "es", "austria": "at",
  "united states": "us", "usa": "us", "us": "us",
  "bosnia and herzegovina": "ba", "bosnia & herzegovina": "ba", "bosnia": "ba",
  "belgium": "be", "senegal": "sn",
  "brazil": "br", "japan": "jp",
  "ivory coast": "ci", "cote d'ivoire": "ci", "côte d'ivoire": "ci",
  "norway": "no", "mexico": "mx", "ecuador": "ec",
  "england": "gb-eng", "dr congo": "cd", "democratic republic of the congo": "cd",
  "argentina": "ar", "cape verde": "cv",
  "australia": "au", "egypt": "eg",
  "switzerland": "ch", "algeria": "dz",
  "colombia": "co", "ghana": "gh",
};
function toIso2(nameOrTla) {
  if (!nameOrTla) return null;
  const lower = String(nameOrTla).toLowerCase().trim();
  if (NAME_TO_ISO[lower]) return NAME_TO_ISO[lower];
  // try tla->iso heuristic: nope, just return null
  return null;
}

/* ----------------- Routes ----------------- */

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    provider: PROVIDER,
    hasKey: !!API_KEY || PROVIDER === "mock",
    competitionId: API_COMPETITION_ID || null,
  });
});

app.get("/api/matches", async (_req, res) => {
  const cached = cacheGet("matches");
  if (cached) return res.json({ matches: cached, cached: true });
  try {
    const handler = providers[PROVIDER];
    if (!handler) return res.status(500).json({ error: `Unknown provider: ${PROVIDER}` });
    if (PROVIDER !== "mock" && !API_KEY) {
      return res.status(500).json({ error: "API_KEY not set in .env (or use API_PROVIDER=mock)" });
    }
    const matches = await handler.listMatches();
    cacheSet("matches", matches);
    res.json({ matches, cached: false });
  } catch (err) {
    console.error("[/api/matches] failed:", err);
    res.status(502).json({ error: "Upstream error", detail: String(err.message || err) });
  }
});

app.get("/api/match/:id", async (req, res) => {
  const key = `match:${req.params.id}`;
  const cached = cacheGet(key);
  if (cached) return res.json({ match: cached, cached: true });
  try {
    const handler = providers[PROVIDER];
    if (!handler) return res.status(500).json({ error: `Unknown provider: ${PROVIDER}` });
    const match = await handler.getMatch(req.params.id);
    if (!match) return res.status(404).json({ error: "Match not found" });
    cacheSet(key, match);
    res.json({ match, cached: false });
  } catch (err) {
    console.error("[/api/match] failed:", err);
    res.status(502).json({ error: "Upstream error", detail: String(err.message || err) });
  }
});

/* ============================================================
 *  Predictions storage adapter
 *  Two backends with the same surface area:
 *    listPredictions()       -> [{ groupName, submittedAt, championPick, picks }]
 *    savePrediction(g, p)    -> { ok, alreadyExists? }
 *    resetAll()              -> { ok }
 *    listManualResults()     -> { matchId: { home, away, status, winnerCode } }
 *    setManualResult(id, r)  -> { ok }
 * ============================================================ */

const usingSheets = !!(GOOGLE_SHEET_ID && GOOGLE_SA_KEY_BASE64);
const storage = usingSheets ? makeSheetsAdapter() : makeFileAdapter();

function makeFileAdapter() {
  const dir = path.dirname(PREDICTIONS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  function read() {
    if (!fs.existsSync(PREDICTIONS_FILE)) return { predictions: [], results: {} };
    try { return JSON.parse(fs.readFileSync(PREDICTIONS_FILE, "utf8")); }
    catch { return { predictions: [], results: {} }; }
  }
  function write(d) { fs.writeFileSync(PREDICTIONS_FILE, JSON.stringify(d, null, 2)); }
  return {
    backend: "file",
    async listPredictions() {
      // picks shape: { matchId: { h, a, w } }
      return read().predictions.map((p) => ({
        groupName: p.groupName,
        submittedAt: p.submittedAt,
        championPick: p.picks?.final?.w || "",
        picks: p.picks || {},
      }));
    },
    async savePrediction(groupName, picks) {
      const d = read();
      const exists = d.predictions.find(
        (p) => p.groupName.toLowerCase() === groupName.toLowerCase()
      );
      if (exists) return { ok: false, alreadyExists: true };
      d.predictions.push({ groupName, picks, submittedAt: new Date().toISOString() });
      write(d);
      return { ok: true };
    },
    async resetAll() { write({ predictions: [], results: {} }); return { ok: true }; },
    async listManualResults() { return read().results || {}; },
    async setManualResult(matchId, r) {
      const d = read();
      d.results = d.results || {};
      d.results[matchId] = {
        home: r.home == null || r.home === "" ? null : Number(r.home),
        away: r.away == null || r.away === "" ? null : Number(r.away),
        status: r.status || "NS",
        winnerCode: r.status === "FT" ? (r.winnerCode || null) : null,
        updatedAt: new Date().toISOString(),
      };
      write(d);
      return { ok: true };
    },
  };
}

function makeSheetsAdapter() {
  const { google } = require("googleapis");
  let creds;
  try {
    creds = JSON.parse(Buffer.from(GOOGLE_SA_KEY_BASE64, "base64").toString("utf8"));
  } catch (e) {
    throw new Error("GOOGLE_SA_KEY_BASE64 is not valid base64 JSON. See .env.example.");
  }
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  async function ensureSheet(sheetName, header) {
    // Try to read row 1; if missing/empty, write header. If the tab itself
    // doesn't exist, batchUpdate to add it then write the header.
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${sheetName}!1:1`,
      });
      const existing = (res.data.values && res.data.values[0]) || [];
      if (existing.length === 0) await writeHeader(sheetName, header);
    } catch (_e) {
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: GOOGLE_SHEET_ID,
          resource: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
        });
      } catch { /* tab may already exist; ignore */ }
      await writeHeader(sheetName, header);
    }
  }
  async function writeHeader(sheetName, header) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [header] },
    });
  }

  return {
    backend: "sheets",
    async listPredictions() {
      await ensureSheet(PREDICTIONS_SHEET_NAME, PREDICTIONS_HEADER);
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${PREDICTIONS_SHEET_NAME}!A2:AZ10000`,
      });
      const rows = res.data.values || [];
      return rows
        .filter((r) => r[0])
        .map((r) => {
          // Each match cell is "h-a/w" (e.g. "2-1/de").
          const picks = {};
          MATCH_ORDER.forEach((id, i) => {
            const parsed = parsePick(r[3 + i]);
            if (parsed) picks[id] = parsed;
          });
          return {
            groupName: r[0],
            submittedAt: r[1] || "",
            championPick: r[2] || "",
            picks,
          };
        });
    },
    async savePrediction(groupName, picks) {
      await ensureSheet(PREDICTIONS_SHEET_NAME, PREDICTIONS_HEADER);
      const all = await this.listPredictions();
      const exists = all.find(
        (p) => p.groupName.toLowerCase() === groupName.toLowerCase()
      );
      if (exists) return { ok: false, alreadyExists: true };
      const row = [
        groupName,
        new Date().toISOString(),
        picks?.final?.w || "",
        ...MATCH_ORDER.map((id) => serializePick(picks[id])),
      ];
      await sheets.spreadsheets.values.append({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${PREDICTIONS_SHEET_NAME}!A1`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [row] },
      });
      return { ok: true };
    },
    async resetAll() {
      await ensureSheet(PREDICTIONS_SHEET_NAME, PREDICTIONS_HEADER);
      await sheets.spreadsheets.values.clear({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${PREDICTIONS_SHEET_NAME}!A2:AZ10000`,
      });
      return { ok: true };
    },
    async listManualResults() {
      await ensureSheet(RESULTS_SHEET_NAME, RESULTS_HEADER);
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${RESULTS_SHEET_NAME}!A2:F10000`,
      });
      const rows = res.data.values || [];
      const out = {};
      for (const r of rows) {
        if (!r[0]) continue;
        out[r[0]] = {
          home: r[1] === "" || r[1] == null ? null : Number(r[1]),
          away: r[2] === "" || r[2] == null ? null : Number(r[2]),
          status: r[3] || "NS",
          winnerCode: r[4] || null,
          updatedAt: r[5] || "",
        };
      }
      return out;
    },
    async setManualResult(matchId, r) {
      await ensureSheet(RESULTS_SHEET_NAME, RESULTS_HEADER);
      // Look up existing row index by match_id
      const lookup = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${RESULTS_SHEET_NAME}!A:A`,
      });
      const ids = (lookup.data.values || []).map((row) => row[0]);
      const row = [
        matchId,
        r.home == null || r.home === "" ? "" : Number(r.home),
        r.away == null || r.away === "" ? "" : Number(r.away),
        r.status || "NS",
        r.status === "FT" ? (r.winnerCode || "") : "",
        new Date().toISOString(),
      ];
      const existingIdx = ids.findIndex((id, i) => i > 0 && id === matchId);
      if (existingIdx >= 0) {
        const rowNumber = existingIdx + 1; // 1-indexed
        await sheets.spreadsheets.values.update({
          spreadsheetId: GOOGLE_SHEET_ID,
          range: `${RESULTS_SHEET_NAME}!A${rowNumber}`,
          valueInputOption: "RAW",
          requestBody: { values: [row] },
        });
      } else {
        await sheets.spreadsheets.values.append({
          spreadsheetId: GOOGLE_SHEET_ID,
          range: `${RESULTS_SHEET_NAME}!A1`,
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: [row] },
        });
      }
      return { ok: true };
    },
  };
}

/* ----------------- Predictions routes ----------------- */

app.get("/api/predictions", async (req, res) => {
  try {
    const all = await storage.listPredictions();
    const group = (req.query.group || "").toString().trim();
    const adminPw = req.headers["x-admin-pw"] || "";
    const isAdmin = adminPw && adminPw === ADMIN_PASSWORD;

    // Group-scoped fetch: only return submission metadata, NEVER the picks.
    // The submitting browser already holds picks in its own localStorage; we
    // refuse to hand them back over the wire so a different device or person
    // cannot retrieve another team's picks by typing their team name.
    if (group) {
      const match = all.find((p) => p.groupName.toLowerCase() === group.toLowerCase());
      return res.json({
        prediction: match
          ? { groupName: match.groupName, submittedAt: match.submittedAt, hasSubmitted: true }
          : null,
      });
    }

    // Bulk list: admins (with the password header) see everything;
    // public callers only get group names + submission times.
    if (isAdmin) {
      return res.json({ predictions: all, count: all.length, backend: storage.backend });
    }
    res.json({
      predictions: all.map((p) => ({ groupName: p.groupName, submittedAt: p.submittedAt })),
      count: all.length,
    });
  } catch (e) {
    console.error("[/api/predictions GET]", e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/predictions", async (req, res) => {
  try {
    const { groupName, picks } = req.body || {};
    if (!groupName || typeof groupName !== "string") {
      return res.status(400).json({ error: "groupName is required" });
    }
    if (!picks || typeof picks !== "object") {
      return res.status(400).json({ error: "picks object is required" });
    }
    const result = await storage.savePrediction(groupName.trim(), picks);
    if (!result.ok && result.alreadyExists) {
      return res
        .status(409)
        .json({ error: `Group "${groupName}" has already submitted. Submissions are locked.` });
    }
    res.json({ ok: true, groupName: groupName.trim() });
  } catch (e) {
    console.error("[/api/predictions POST]", e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.delete("/api/predictions", async (req, res) => {
  if ((req.headers["x-admin-pw"] || "") !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    await storage.resetAll();
    res.json({ ok: true });
  } catch (e) {
    console.error("[/api/predictions DELETE]", e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

/* ----------------- Results routes (manual overrides) ----------------- */

app.get("/api/results", async (_req, res) => {
  try {
    const results = await storage.listManualResults();
    res.json({ results });
  } catch (e) {
    console.error("[/api/results GET]", e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/results", async (req, res) => {
  if ((req.headers["x-admin-pw"] || "") !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const { matchId, home, away, status, winnerCode } = req.body || {};
    if (!matchId) return res.status(400).json({ error: "matchId required" });
    await storage.setManualResult(matchId, { home, away, status, winnerCode });
    res.json({ ok: true });
  } catch (e) {
    console.error("[/api/results POST]", e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

/* ----------------- Leaderboard ----------------- */

app.get("/api/leaderboard", async (_req, res) => {
  try {
    const [all, results] = await Promise.all([
      storage.listPredictions(),
      storage.listManualResults(),
    ]);
    const decidedMatches = Object.values(results).filter((r) => r && r.status === "FT").length;

    const board = all.map((p) => {
      let points = 0, correct = 0, wrong = 0, pending = 0;
      for (const matchId of MATCH_ORDER) {
        const pick = p.picks?.[matchId];
        if (!pick || pick.h == null || pick.a == null) continue;
        const actual = results[matchId];
        if (!actual || actual.status !== "FT") { pending++; continue; }
        const pts = scoreMatch(pick, actual);
        points += pts;
        if (pts > 0) correct++; else wrong++;
      }
      return {
        groupName: p.groupName,
        submittedAt: p.submittedAt,
        points,
        correct,
        wrong,
        pending,
      };
    });
    board.sort((a, b) =>
      b.points - a.points ||
      a.pending - b.pending ||
      a.groupName.localeCompare(b.groupName)
    );
    // NOTE: we intentionally do NOT return per-team championPick or per-match picks
    // - the Leaderboard is public, and other teams should not see anyone's picks.
    res.json({ leaderboard: board, decidedMatches });
  } catch (e) {
    console.error("[/api/leaderboard]", e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

/* Fallback to index.html for any other route (SPA-style) */
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`WC 2026 Predictions server listening on http://localhost:${PORT}`);
  console.log(`Provider: ${PROVIDER}${API_KEY ? " (key loaded)" : " (no key)"}`);
  console.log(`Storage:  ${storage.backend}${storage.backend === "file" ? ` (${PREDICTIONS_FILE})` : ` (Sheet ${GOOGLE_SHEET_ID.slice(0, 8)}...)`}`);
});
