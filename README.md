# Dietitian Department Tracker

A local web app that syncs live from the "DIETITIAN DEPARTMENT TRACKER" Google
Sheet and lets you look up each person's Gear 2 / Gear 3 / Gear 4 diet plan
(from the DIABETES / THYROID / KIDNEY DIET / GASTRIC-ULCER-ACIDITY templates)
directly in the browser.

## What it does

- **Sheet filter** — tabs across the top for each sheet tab in the spreadsheet
  (DD104, Praveena, Mahalakshmi, Sumithra, Batch Details, Family Member Diet).
  Clicking one loads that sheet's data live from Google Sheets.
- **Search** — type any part of a name, student ID, batch, or coach name to
  filter instantly.
- **Gear 2 / 3 / 4 buttons** on each person — opens the matching diet-plan
  document, auto-picked based on their condition, veg/non-veg/egg preference,
  and language, with dropdowns to override the pick manually if the guess is
  wrong or you want to see an alternate version.
- **Auto-sync** — re-fetches the active sheet from Google every 60s, plus a
  manual "Sync now" button. Data always comes live from the sheet; nothing is
  cached to disk.

## First-time setup

Requires [Node.js](https://nodejs.org) 18+.

```bash
cd server && npm install
cd ../client && npm install
```

### Admin login (Supabase)

The app is gated behind an admin login/signup screen backed by
[Supabase](https://supabase.com) Auth. One-time setup:

1. Create a project at [supabase.com](https://supabase.com) (or use an
   existing one).
2. In the Supabase dashboard, open **SQL Editor -> New query**, paste the
   contents of [`supabase/schema.sql`](supabase/schema.sql), and run it. This
   creates the `diet_tracker` table that admin accounts are stored in (plus a
   trigger that adds a row to it automatically whenever someone signs up),
   and the `diet_patient_overrides` table that per-patient gear replacements
   are saved to.
3. In **Project Settings -> API**, copy:
   - **Project URL** and the **anon public** key into `client/.env` (copy
     `client/.env.example` first) as `VITE_SUPABASE_URL` /
     `VITE_SUPABASE_ANON_KEY`.
   - **Project URL** and the **service_role** key (secret — server only)
     into `server/.env` (copy `server/.env.example` first) as `SUPABASE_URL`
     / `SUPABASE_SERVICE_ROLE_KEY`.
4. Open the app and use the **Sign up** tab to create the first admin
   account. By default Supabase requires confirming the email address before
   you can log in — either click the confirmation link it sends, or turn off
   "Confirm email" under **Authentication -> Providers -> Email** in the
   dashboard for faster internal testing.

Every `/api/*` route requires a signed-in admin, so the server also needs
`server/.env` filled in before the frontend can load any data.

The diet-plan `.docx` files live under `server/content/` (extracted from the
4 zip folders) and are indexed in `server/manifest.json`, but are actually
**served from Supabase Storage** (a private `diet-content` bucket) rather
than local disk — a deployed serverless function has no persistent
filesystem to read them from, and several of these files are 15-20MB, well
past what a function can return directly, so the app hands the browser a
short-lived signed URL to download from instead. If you add or change files
under `server/content/`, rebuild the index and push the changes to storage:

```bash
cd server && npm run build-manifest
node scripts/sync-content-to-storage.js
```

## Running it

**Development** (hot-reload frontend, two terminals):

```bash
# terminal 1
cd server && npm start

# terminal 2
cd client && npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

**Production** (one process, one port):

```bash
cd client && npm run build
cd ../server && npm start
```

Open http://localhost:4000 — the server serves both the API and the built
frontend.

## Deployment (Vercel)

The app is set up to deploy as a single Vercel project: the client builds as
a static site, and `server/index.js` runs as one serverless function (see
[`api/index.js`](api/index.js) and [`vercel.json`](vercel.json)) that Express
routes internally exactly as it does locally.

```bash
npm i -g vercel   # if not already installed
vercel link       # first time only, creates/links the Vercel project
vercel env add VITE_SUPABASE_URL production
vercel env add VITE_SUPABASE_ANON_KEY production
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel --prod
```

Notes:
- `server/content/` and `server/data/` are excluded from the deployment
  (see [`.vercelignore`](.vercelignore)) — the deployed app reads diet-plan
  files from Supabase Storage and patient data from Supabase Postgres, not
  local disk, so neither is needed at runtime.
- The `VITE_*` variables get baked into the client bundle at build time, so
  they must be set *before* running `vercel --prod` (and re-set if they
  ever change, followed by a redeploy).

## Configuration

- `server/sheets.config.json` — which spreadsheet tabs show up as filters.
  Add/remove/rename entries here if tabs in the sheet change. The `name` must
  match the actual tab name in Google Sheets exactly. It currently points at
  a **duplicate** of the live tracker (made for testing this app's changes
  without touching the real one), shared "Anyone with the link can edit" —
  swap the `spreadsheetId` back to the original when you're done testing.
- The spreadsheet must stay shared at least "Anyone with the link can view"
  (reads always go through the server unauthenticated) — and "...can edit"
  if you want TL verification (below) to actually write back to it.

## TL verification

A TL (Team Lead) can sign in and mark a gear's diet plan Verified, plus
leave Diet Accuracy / Diet Quality / Remarks — all from inside the app,
instead of editing the spreadsheet's cells directly. Saving writes straight
into that person's row in the tracker spreadsheet (`server/lib/tlVerificationWriter.js`),
so anyone opening the sheet itself sees the same values.

## Mark Prepared, Effort Goal, Mail Schedule, and the Prep/Verification % report

Any signed-in staff member can click **Mark Prepared** on a person's profile
page once a gear is ready — it writes "Done" into that gear's own
"Preparation status" cell (`server/lib/prepStatusWriter.js`), same idea as TL
verification: an app action instead of editing the sheet by hand.

Both Mark Prepared and a saved TL verification also log **who did it and
when** to a new `diet_effort_log` Supabase table (see
`server/lib/effortLogStore.js`) — neither the sheet nor anything else in this
app tracked that before. Three things in the Dashboard depend on this log:

- **Effort goal** — today's prepared/verified counts per person against the
  program's daily targets (30/day per Team Member, 45/day per Team Leader).
- **Diet preparation % / verification %** — the program's own formulas
  (eligibility from intro-call/blood-report status, "on time" from this log's
  timestamp vs. the gear's Due Date). This only starts filling in once people
  actually use Mark Prepared — diets prepared before this feature existed
  have no timestamp to check "on time" against, and are correctly excluded
  rather than guessed at.
- **Mail schedule** — 1st/2nd mail reminders (in-app only, no email sending)
  based on each student's own "Current Day" crossing the program's Day
  thresholds for that gear.

None of this is scoped to a specific batch — it works on any sheet tab
regardless of name, so it's ready for "DD114 onwards" (or any other batch)
without needing a code change once that tab exists.

**One-time setup required**: run the updated `supabase/schema.sql` in the
Supabase SQL Editor (safe to re-run the whole file — every `create table` is
`if not exists`) to create `diet_effort_log`. Until you do, Mark Prepared and
TL verification still work fine (the sheet write isn't affected), but the
Effort Goal / Mail Schedule / % report sections just show empty state instead
of erroring.

- **Granting TL access**: signup always starts as a plain Employee (same as
  before). A `developer` account promotes someone via the **Team** page
  (sidebar, developer-only) — pick "TL" from their role dropdown.
- **Requires** `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` in `server/.env` (see
  `server/.env.example`) — reading the sheet never needed real credentials,
  but writing to it does. Without this set, the "Save to sheet" button shows
  a clear error instead of failing silently.
- The "TL Verify" button on a person's card only appears once that gear is
  at least Prepared, and only against the default tracker sheet (not a
  "Switch sheet" custom spreadsheet) — TL verification is keyed off Student
  ID, and an unrelated spreadsheet could reuse an ID belonging to a real
  patient in the default tracker.
- "Diet Accuracy (TL)" / "Diet Quality (TL)" are newer columns (see the
  tracker's own "Template" tab) that don't exist on every real sheet tab yet
  — if a tab doesn't have them, that part of the save is silently skipped
  (the request still updates whichever columns *do* exist: TL verification,
  TL Verification Date, TL Remarks).

## Switch sheet

The sidebar's "Switch sheet" button lets anyone point their own view at a
*different* spreadsheet — paste its link and the app reads it the same way
it reads the default tracker (person cards, gear status, BMI, the polished
table fallback for non-person tabs). This is personal per-browser, not a
shared setting — it never changes what other staff see, and "Reset to
default" brings back the real tracker sheet at any time.

It needs a Google Sheets API key to discover a pasted spreadsheet's tab
names (see `server/.env.example` for setup steps) — without one, the button
still opens but shows a clear "not configured" message. The target
spreadsheet needs the same "Anyone with the link can view" sharing as above.

While viewing a non-default spreadsheet, "Mark Call Done" / "Mark Completed"
and weight trends are unavailable by design — those are stored per Student
ID, and an unrelated spreadsheet could reuse an ID that belongs to a real
patient in the default tracker. Status chips still show, derived from that
sheet's own Blood/Prep/TL-verification columns.

## How the diet-plan matching works

Each gear button looks at the person's condition (preferring the coach's
free-text notes for that specific gear, falling back to their general
clinical fields), detects Diabetes / Thyroid / Kidney / BP and whether
Gastric/Ulcer/Acidity is also mentioned, and matches it to the closest
`.docx` template by veg/non-veg/egg and language preference — falling back to
the nearest available variant when an exact match doesn't exist (e.g. no
English version was prepared for a given condition/gear). The viewer's
dropdowns let you override any of these if the auto-detected condition looks
wrong, since the underlying spreadsheet notes are free text typed by many
different coaches.
