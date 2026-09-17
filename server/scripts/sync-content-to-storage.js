// One-off / repeatable sync: uploads every file listed in manifest.json from
// server/content/ (the local source of truth admins edit) up to the
// "diet-content" Supabase Storage bucket, which is what the deployed app
// actually serves files from at runtime (a Vercel function's filesystem is
// read-only and far too small for these files to be bundled directly).
// Run this again any time files under server/content/ change, after
// `npm run build-manifest`.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { supabaseAdmin } = require('../lib/supabaseAdmin');

const CONTENT_DIR = path.join(__dirname, '..', 'content');
const MANIFEST_PATH = path.join(__dirname, '..', 'manifest.json');
const BUCKET = 'diet-content';

async function ensureBucketIsPrivate() {
  const { data, error } = await supabaseAdmin.storage.getBucket(BUCKET);
  if (error) {
    const { error: createErr } = await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
    if (createErr) throw new Error(`Could not find or create bucket "${BUCKET}": ${createErr.message}`);
    return;
  }
  if (data.public) {
    // This bucket backs signed-URL downloads for patient diet files — every
    // route that serves a file assumes it's unreachable without one. A
    // public bucket would let anyone who guesses/derives an object path
    // (they're deterministic — see server/index.js) download it directly,
    // bypassing login entirely. Refuse to sync rather than upload into that.
    throw new Error(
      `Bucket "${BUCKET}" is PUBLIC. Diet files must not be reachable without a signed URL — ` +
        `make it private in the Supabase dashboard (Storage -> ${BUCKET} -> Settings) before syncing.`
    );
  }
}

async function main() {
  if (!supabaseAdmin) {
    console.error('Supabase is not configured (check server/.env).');
    process.exit(1);
  }
  await ensureBucketIsPrivate();
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  const files = manifest.files;
  console.log(`Uploading ${files.length} files to bucket "${BUCKET}"...`);

  let ok = 0;
  let failed = [];
  for (let i = 0; i < files.length; i++) {
    const entry = files[i];
    const fullPath = path.join(CONTENT_DIR, entry.relPath);
    const buf = fs.readFileSync(fullPath);
    const { error } = await supabaseAdmin.storage.from(BUCKET).upload(entry.relPath, buf, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true,
    });
    if (error) {
      failed.push({ relPath: entry.relPath, error: error.message });
      console.log(`[${i + 1}/${files.length}] FAILED ${entry.relPath}: ${error.message}`);
    } else {
      ok++;
      console.log(`[${i + 1}/${files.length}] OK ${entry.relPath} (${(buf.length / 1024 / 1024).toFixed(1)}MB)`);
    }
  }

  console.log(`\nDone. ${ok} succeeded, ${failed.length} failed.`);
  if (failed.length) {
    console.log('Failures:', JSON.stringify(failed, null, 2));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
