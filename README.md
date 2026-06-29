# FIFA World Cup 2026 - Office Predictions

A shared knockout-bracket prediction app for your 11 office groups. Each group submits one bracket from any device, picks are locked centrally, and a live Leaderboard ranks groups by correct picks as matches finish.

## What's in it

- **5-round bracket**: Round of 32 → Round of 16 → Quarter-Finals → Semi-Finals → Final → Champion.
- **Shared storage**: predictions go to Google Sheets (recommended for production) or a local JSON file (for dev).
- **One-submission-per-group**: the server rejects duplicates by group name (case-insensitive).
- **Cross-device**: a group that submits from one laptop sees their entry waiting on any other device once they type the same group name.
- **Leaderboard**: total correct picks per group, refreshes every 60 s, sorts champion picks first when ties.
- **Live match data**: optional integration with football-data.org or api-football via a server-side proxy (your API key stays on the server).
- **Admin panel** (password `admin123`): reset all predictions, enter manual results when the API doesn't have one yet.

---

## 1. Quick start (local development)

Requires **Node 18+**.

```bash
npm install
cp .env.example .env       # PowerShell: Copy-Item .env.example .env
npm start
```

Open <http://localhost:3000>. With the default `.env`, the app:

- Uses `data/predictions.json` for storage (created on first submit, so no setup needed).
- Uses the `mock` football provider, so Live Result Mode produces fake match data without an API key.

You can demo the full submission and leaderboard flow this way before wiring anything to the cloud.

---

## 2. Make it accessible from other devices

### Option A - Same office WiFi (no deploy)

1. On the host laptop, find its LAN IP: `ipconfig` (Windows) or `ifconfig` / `ip a` (Mac/Linux). Look for something like `192.168.x.x`.
2. Run `npm start`. The server already binds to `0.0.0.0`, so other devices on the same WiFi can reach `http://192.168.x.x:3000`.
3. Make sure Windows Firewall / macOS firewall allows incoming connections on port 3000.

Caveat: only works while the host laptop is running and on the same WiFi as everyone.

### Option B - Cloud (Render) - recommended

This is the production path for the office competition.

1. Push this folder to a GitHub repo.
2. Sign up at [render.com](https://render.com) (free, no card).
3. **New > Web Service** > connect your GitHub repo.
4. Settings:
   - **Build command**: `npm install`
   - **Start command**: `node server.js`
   - **Environment**: Node
5. Add environment variables (Render dashboard > Environment):
   - `GOOGLE_SHEET_ID`, `GOOGLE_SA_KEY_BASE64` (see §3)
   - `API_PROVIDER`, `API_KEY` (see §4) - optional
6. Deploy. Render gives you a public URL like `https://wc2026-predictions.onrender.com`. Share that link with all 11 groups.

> Note: Render's free tier sleeps after 15 min of inactivity. The first request after sleep takes ~30 s. Fine for an office competition; if you want zero-sleep, set up a free uptime monitor or upgrade.

---

## 3. Storage: Google Sheets (production)

Once deployed, you want predictions to live somewhere persistent that you can also open in a familiar tool. Google Sheets is the simplest.

### Step 1 - Create the spreadsheet

Create a new Google Sheet (any name). Copy its **Sheet ID** from the URL:

```
https://docs.google.com/spreadsheets/d/THIS_IS_THE_SHEET_ID/edit
```

The server will auto-create two tabs the first time it runs:

- `Predictions` - one row per group with all 31 picks + submission timestamp.
- `Results` - manual admin overrides for matches (when the API doesn't have FT data yet).

You don't have to format anything; headers are written on first use.

### Step 2 - Create a Google service account

1. Go to [Google Cloud Console](https://console.cloud.google.com).
2. Create a project (or use an existing one).
3. Search for **Google Sheets API** > Enable.
4. Go to **APIs & Services > Credentials > Create Credentials > Service Account**.
5. Name it (e.g. `wc2026-bot`). Skip the role assignment (sheet sharing handles permissions).
6. Open the service account > **Keys** tab > **Add Key > Create new key > JSON**. A `.json` file downloads.

### Step 3 - Share the sheet with the service account

Open the JSON key file, copy the `client_email` (looks like `wc2026-bot@your-project.iam.gserviceaccount.com`). Open your Google Sheet > **Share** > paste that email > Editor access > Send.

### Step 4 - Base64-encode the JSON key

The whole JSON file goes into one env var, base64-encoded.

```bash
# macOS / Linux
base64 -i sa-key.json | tr -d '\n'

# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("sa-key.json"))
```

Copy the output. Set the two env vars (in Render dashboard, or in your local `.env`):

```env
GOOGLE_SHEET_ID=...your-sheet-id...
GOOGLE_SA_KEY_BASE64=...the-long-base64-string...
```

Restart the server. You should see in the logs:

```
Storage:  sheets (Sheet abcdefgh...)
```

Submit a prediction from the app. Open the Sheet in your browser - the row is there.

If `GOOGLE_SHEET_ID` is blank, the server falls back to `data/predictions.json` automatically.

---

## 4. Live match data (optional)

By default the server uses the `mock` provider so Live Result Mode demonstrates the UI without a key. To pull real WC 2026 fixtures:

### football-data.org (free tier)

```env
API_PROVIDER=footballdata
API_KEY=your-football-data-token
API_COMPETITION_ID=WC
```

### api-football (api-sports.io)

```env
API_PROVIDER=apifootball
API_KEY=your-api-sports-key
API_COMPETITION_ID=1
API_SEASON=2026
```

Add another provider by writing a handler in `providers` in `server.js` - just two methods (`listMatches`, `getMatch`) returning the normalised shape documented at the top of that file.

### Mapping API match IDs

Each match in the bracket has a stable internal id (`r16_1`, `qf_l1`, ..., `final`). To compare picks against API results, you need to tell the app which provider match id corresponds to which bracket id:

1. Open the app, click **Admin** in the top right.
2. Password: `admin123` (change in `.env` via `ADMIN_PASSWORD`).
3. Paste the provider's match id next to each bracket match > **Save API IDs**.

When a match goes to Full Time on the API, the actual winner is detected, the actual bracket advances, and every group's pick is scored.

---

## 5. Manual result entry (API fallback)

When the API doesn't have a fixture yet, or you just want to enter scores by hand:

1. Admin > **Manual Result Update**.
2. Pick a match, enter home/away scores, status (`FT` to mark complete), and the winner.
3. Save. The row is written to the `Results` tab of the sheet (or to `data/predictions.json` if you're in file mode), and the leaderboard recomputes on its next refresh.

---

## 6. Exports

Top-level buttons below the bracket:

- **Export Predictions (CSV)** - your own group's bracket, one row per match.
- **Export Predictions (JSON)** - full raw object including the API id map.
- **Print / Save as PDF** - print-friendly layout, hides chrome.

Admin gets the same plus an **Export Results CSV** that includes actual vs predicted per match per group.

---

## 7. Resetting

- **Clear Draft** (top of the participant card): clears your in-progress picks on this device. Doesn't touch the server. Useful before your group has submitted.
- **Admin > Reset ALL predictions**: deletes every submission on the server. There's no undo; only the host should run this.

---

## File map

| File              | Purpose                                                                  |
|-------------------|---------------------------------------------------------------------------|
| `index.html`      | UI shell - bracket, participant card, leaderboard, admin modal           |
| `style.css`       | Dark navy tournament theme, bracket connectors, leaderboard styling      |
| `script.js`       | Frontend logic: picks, lock, server sync, leaderboard rendering          |
| `server.js`       | Express server: API proxy, predictions storage adapter, leaderboard      |
| `.env.example`    | Sample config - copy to `.env`                                           |
| `package.json`    | Dependencies (`express`, `dotenv`, `googleapis`)                         |

---

## Security notes

- The football API key only lives in the server's `.env` and is never sent to the browser.
- The service account JSON key is base64-encoded into one env var; treat it like a password. If it leaks, rotate it in Google Cloud Console.
- The admin password defaults to `admin123` and is checked **client-side** for the in-app admin panel and **server-side** for destructive routes (`DELETE /api/predictions`, `POST /api/results`). Change `ADMIN_PASSWORD` in `.env` for anything public-facing.
- The app trusts that group names are honest. If a colleague spoofs another group's name before they submit, that name gets locked. For an honor-system office bracket this is fine; for higher stakes, add per-group passcodes.
