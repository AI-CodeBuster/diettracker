-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Creates the admin-accounts table ("diet_tracker") backing this app's login/signup,
-- plus a trigger that auto-populates it whenever someone signs up via Supabase Auth.

create table if not exists public.diet_tracker (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'employee',
  created_at timestamptz not null default now()
);

alter table public.diet_tracker enable row level security;

-- The app's client never talks to Supabase directly for this table — every
-- read/write goes through the server's own API, which uses the
-- service_role key and so bypasses RLS entirely. Deliberately no policies
-- at all here: with RLS enabled and no matching policy, Postgres denies by
-- default, so a signed-up user's own session can't read or write the admin
-- roster (or anyone else's row, or even their own) by calling Supabase's
-- REST API directly with the public anon key. `role` now gates real
-- permissions (see the developer-only checks in server/lib/roles.js), so an
-- "update your own row" policy would let a user promote themselves to
-- 'developer' directly against the REST API — there used to be one here
-- when `role` was purely cosmetic; it's gone now that it isn't.

-- Mirrors auth.users into diet_tracker on signup, so every account exists
-- here without extra client-side code (and can't be skipped by a signup
-- call that never runs it). developer@gmail.com is the one seeded developer
-- account (see server/lib/roles.js for what that role can do) — everyone
-- else who signs up is a plain 'employee'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.diet_tracker (id, email, full_name, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    case when new.email = 'developer@gmail.com' then 'developer' else 'employee' end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfills for accounts created under older versions of this trigger —
-- harmless no-ops if nothing matches.
update public.diet_tracker set role = 'developer' where email = 'developer@gmail.com' and role <> 'developer';
update public.diet_tracker set role = 'employee' where role = 'admin';

-- Per-patient gear replacement overrides (a coach's saved food swaps),
-- replacing the local server/data/patients/*.json files that used to back
-- this — a serverless deploy (Vercel) has no persistent local disk.
create table if not exists public.diet_patient_overrides (
  person_key text not null,
  gear int not null,
  manifest_id text,
  replacements jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (person_key, gear)
);

-- RLS enabled with no policies at all: only the server's service_role key
-- (which bypasses RLS) can touch this table. See the comment above
-- diet_tracker's RLS setup — the client never reaches this table directly,
-- so there's no "authenticated" policy to grant here, and none should be
-- added without the app itself needing that direct-access path.
alter table public.diet_patient_overrides enable row level security;

-- Per-patient recipe swaps made in the new data-driven diet viewer
-- (DietTemplateView's [Replace Recipe]) — deliberately a SEPARATE table from
-- diet_patient_overrides above, not a reuse of it: that one stores TEXT
-- splices ({originalText, replacementText}) for the old .docx-splice
-- pipeline, this stores an ID swap against server/diet-data/
-- recipe-library.json ({originalRecipeId, newRecipeId}) — different enough
-- shapes that conflating them in one column would be a mess to read back.
create table if not exists public.diet_recipe_overrides (
  person_key text not null,
  gear int not null,
  overrides jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (person_key, gear)
);
alter table public.diet_recipe_overrides enable row level security;

-- Recipes typed from scratch via [Replace Recipe]/[+ Add Recipe]'s "Enter
-- Manually" tab, promoted into the shared cross-patient recipe library
-- instead of staying a one-off entry in diet_recipe_overrides above (that
-- table still ALSO gets a row, unchanged, so it applies to the patient the
-- coach was actually working on) — tagged with the same mealType/condition/
-- dietType vocabulary server/diet-data/recipe-library.json uses (see
-- server/lib/recipeEligibility.js), so it becomes findable by ANY coach
-- filtering the library by that same gear+condition, for ANY patient, from
-- then on. That static file is read-only at runtime and wouldn't survive a
-- redeploy/serverless cold start if written to directly (see server/
-- index.js's loadRecipeLibrary comment) — this table is the live, writable
-- counterpart the server merges in at read time.
-- Per-patient edits to Diet Schedule table cells (MealPlanTable/InfoTable in
-- client/src/components/DietTemplateView.jsx) made by a Team Member account
-- (TLs are review-only there — see App.jsx's canEdit). Same shape/convention
-- as diet_recipe_overrides above (one JSON array per (person_key, gear)),
-- but keyed positionally ({ tableKey, rowIndex, colIndex, value }) rather
-- than by recipe_id, since a schedule row has no recipe identity at all —
-- tableKey mirrors the same "mealplan:<title>"/"infotable:<title>" naming
-- client/src/lib/applyScheduleOverrides.js's own key builders use.
-- Diet Schedule content itself is a SHARED static template file per gear/
-- condition/dietType/language combination (server/diet-data/*.json,
-- server/index.js's GET /api/diet-template/:id) — every patient on that same
-- combination is served the identical file, so an edit must live here, in a
-- per-patient overlay applied at render time, and never mutate that shared
-- file directly.
create table if not exists public.diet_schedule_overrides (
  person_key text not null,
  gear int not null,
  overrides jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (person_key, gear)
);
alter table public.diet_schedule_overrides enable row level security;

create table if not exists public.diet_manual_recipes (
  recipe_id text primary key,
  name text not null,
  ingredients jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  image text,
  meal_types text[] not null default '{}'::text[],
  conditions text[] not null default '{}'::text[],
  diet_types text[] not null default '{}'::text[],
  language text,
  allergens text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  created_by_name text
);
alter table public.diet_manual_recipes enable row level security;

-- Bugs & enhancements raised from inside the app's own "Bugs & Enhancements"
-- section. `code` is a short display id (DEV-0001, DEV-0002, ...) generated
-- from a sequence rather than derived from `id`, so it stays stable and
-- human-readable even though `id` itself is a uuid.
create sequence if not exists public.diet_issues_code_seq;

create table if not exists public.diet_issues (
  id uuid primary key default gen_random_uuid(),
  code text not null default ('DEV-' || lpad(nextval('public.diet_issues_code_seq')::text, 4, '0')),
  kind text not null check (kind in ('bug', 'enhancement')),
  urgency text not null default 'medium' check (urgency in ('low', 'medium', 'high', 'critical')),
  title text not null,
  screen text,
  what_happened text,
  repro_steps text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'fixed', 'wont_do')),
  raised_by_id uuid references auth.users (id) on delete set null,
  raised_by_name text,
  raised_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Same pattern as diet_patient_overrides above: RLS enabled with no
-- policies — only the server's service_role key (which bypasses RLS)
-- reads/writes this table; the client always goes through /api/issues.
alter table public.diet_issues enable row level security;

-- Feature/product requirements raised from the app's own "Requirements"
-- section — a separate backlog from diet_issues (bugs are things that broke;
-- requirements are things to build), but the same code/sequence pattern.
create sequence if not exists public.diet_requirements_code_seq;

create table if not exists public.diet_requirements (
  id uuid primary key default gen_random_uuid(),
  code text not null default ('REQ-' || lpad(nextval('public.diet_requirements_code_seq')::text, 4, '0')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  title text not null,
  area text,
  description text,
  status text not null default 'proposed' check (status in ('proposed', 'in_progress', 'done', 'declined')),
  requested_by_id uuid references auth.users (id) on delete set null,
  requested_by_name text,
  requested_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Same RLS pattern as diet_issues above: service_role only, client always
-- goes through /api/requirements.
alter table public.diet_requirements enable row level security;

-- TL-raised inline remarks on a diet plan (see server/lib/dietRemarksStore.js
-- for the full picture): a TL highlights one block of the rendered plan (a
-- recipe card, a schedule-table row, an info-table row, a freeText line) and
-- leaves a comment. The coach who owns that patient sees the highlight the
-- next time they open that gear, and once it's fixed clicks "Mark Resolved".
-- patient_name/health_coach_name/batch/condition_label are a snapshot taken
-- at raise time, not a live join — the cross-patient "Diet Remarks" panel
-- needs them even for a patient whose sheet isn't the one currently loaded.
create table if not exists public.diet_remarks (
  id uuid primary key default gen_random_uuid(),
  person_key text not null,
  gear int not null,
  remark_key text not null,
  highlighted_text text not null,
  comment text not null,
  patient_name text,
  health_coach_name text,
  batch text,
  condition_label text,
  raised_by_id uuid references auth.users (id) on delete set null,
  raised_by_name text,
  raised_by_email text,
  status text not null default 'pending' check (status in ('pending', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_name text
);
create index if not exists diet_remarks_person_gear_idx on public.diet_remarks (person_key, gear);
create index if not exists diet_remarks_status_idx on public.diet_remarks (status, created_at desc);
-- Same RLS pattern as diet_issues above: service_role only, client always
-- goes through /api/diet-remarks.
alter table public.diet_remarks enable row level security;

-- Manually-set lifecycle checkpoints a sheet column doesn't exist for
-- (Call Done, Completed) — everything else in the Pending/Call Done/
-- Prepared/Verified/Completed lifecycle (Pending/Prepared/Verified) is
-- derived live from sheet data on every fetch (see
-- client/src/lib/gearStatus.js) and never written here. Same RLS pattern as
-- diet_patient_overrides above: service_role only, client always goes
-- through /api/patient-status.
create table if not exists public.diet_patient_status (
  person_key text not null,
  gear int not null,
  status text not null check (status in ('call_done', 'completed')),
  updated_at timestamptz not null default now(),
  updated_by_name text,
  primary key (person_key, gear)
);
alter table public.diet_patient_status enable row level security;

-- Weight snapshots, auto-appended by the server whenever a person's parsed
-- weight changes on sync (see server/lib/weightLogStore.js), so the profile
-- page can show a gain/loss trend — the sheet itself only ever has the
-- current value, never history. Same RLS pattern as the tables above.
create table if not exists public.diet_patient_weight_log (
  id bigint generated always as identity primary key,
  person_key text not null,
  weight_kg numeric not null,
  recorded_at timestamptz not null default now()
);
create index if not exists diet_patient_weight_log_person_idx on public.diet_patient_weight_log (person_key, recorded_at desc);
alter table public.diet_patient_weight_log enable row level security;

-- One row per "Mark Prepared" (Team Member) or TL-verification-saved
-- (Team Leader) action, with who and when — neither of which the sheet
-- itself tracks (see server/lib/effortLogStore.js). Backs the Dashboard's
-- "Effort Goal" section (daily prep/verification counts vs. the 30/day,
-- 45/day targets) and the on-time half of the Prep %/Verification % report.
-- Deliberately append-only and separate from diet_patient_status: this is a
-- log of actions taken, not a current-state table, so a gear "un-prepared"
-- later doesn't erase that someone did the work that day.
create table if not exists public.diet_effort_log (
  id bigint generated always as identity primary key,
  person_key text not null,
  gear int not null,
  action text not null check (action in ('prepared', 'verified')),
  performed_by_id uuid references auth.users (id) on delete set null,
  performed_by_name text,
  performed_at timestamptz not null default now()
);
create index if not exists diet_effort_log_performed_at_idx on public.diet_effort_log (performed_at desc);
create index if not exists diet_effort_log_person_idx on public.diet_effort_log (person_key, gear);
-- Same RLS pattern as the tables above: service_role only, client always
-- goes through /api/effort-log and /api/effort-summary.
alter table public.diet_effort_log enable row level security;

-- Global (not per-patient) toggle of which "Personal Details" fields appear
-- on the cover page of EVERY diet plan (client/src/components/
-- PatientCoverPage.jsx) — a developer picks a subset of the fixed field
-- catalog (see server/lib/patientDetailFieldsStore.js) via the "Patient
-- Details Edit" sidebar page; saving here changes what every coach/TL sees
-- on every plan's cover page from that point on, no per-patient setting.
-- Singleton row (id always 1, enforced by the check) rather than a keyed
-- table, since there is exactly one of these configs, not one per anything.
create table if not exists public.diet_patient_detail_fields (
  id int primary key default 1 check (id = 1),
  field_keys text[] not null,
  updated_at timestamptz not null default now(),
  updated_by_name text
);
-- Diet & Other Preference / Clinical Details field selections (same pattern
-- as field_keys above) -- added so "Patient Details Edit" can configure all
-- three cover-page tables, not just Personal Details. Nullable so existing
-- rows fall back to their own defaults in patientDetailFieldsStore.js until
-- someone saves a custom selection for that category.
alter table public.diet_patient_detail_fields add column if not exists diet_preference_field_keys text[];
alter table public.diet_patient_detail_fields add column if not exists clinical_detail_field_keys text[];
-- Same RLS pattern as the tables above: service_role only, client always
-- goes through /api/patient-detail-fields.
alter table public.diet_patient_detail_fields enable row level security;

-- Native, in-app student registry — the "Register Student" module's own
-- store (see server/lib/studentsStore.js), built so day-to-day student
-- intake, viewing and CSV export no longer depend on the external Google
-- Sheet at all. Deliberately separate from, and does not replace, the
-- existing sheet-backed Tracker/GearViewer flows — those are untouched.
-- student_id defaults to an auto-generated "APPSTU-0001"-style code (same
-- sequence-backed default pattern as diet_issues.code/diet_requirements.code
-- above) whenever a coach leaves the Student ID field blank at registration.
create sequence if not exists public.diet_students_code_seq;

create table if not exists public.diet_students (
  id uuid primary key default gen_random_uuid(),
  student_id text unique default ('APPSTU-' || lpad(nextval('public.diet_students_code_seq')::text, 4, '0')),
  name text not null,
  contact text,
  batch text,
  hc_name text,
  category text,
  tl_name text,
  batch_status text,
  doh text,
  doe text,
  course_start_date text,
  days_since_joined text,
  total_handover text,
  gender text,
  age text,
  height text,
  weight text,
  current_day text,
  intro_call_status text,
  blood_report_date text,
  veg_preference text,
  language text,
  condition_raw text,
  food_allergy text,
  dislike_food text,
  secondary_condition text,
  past_history text,
  supplement text,
  gear2_diet_type text,
  gear3_diet_type text,
  gear4_diet_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_id uuid references auth.users (id) on delete set null,
  created_by_name text,
  updated_by_name text
);
create index if not exists diet_students_name_idx on public.diet_students (name);
-- Same RLS pattern as the tables above: service_role only, client always
-- goes through /api/students.
alter table public.diet_students enable row level security;
