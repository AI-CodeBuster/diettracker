// Uploads the deduplicated recipe photos staged by scripts/migrate-all.js to
// the private "diet-images" Supabase Storage bucket, which is what the
// deployed app serves them from (/api/diet-image/<hash>.<ext> redirects to a
// signed URL). Run after migrate-all.js, and again whenever it restages.
//
// Images are content addressed, so re-running is cheap and idempotent:
// a name that already exists in the bucket holds identical bytes by
// definition, and is skipped rather than re-uploaded.
//
//   node scripts/sync-diet-images-to-storage.js
//   node scripts/sync-diet-images-to-storage.js --force   # re-upload everything
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { supabaseAdmin } = require('../lib/supabaseAdmin');

const STAGE_DIR = path.join(__dirname, '..', 'diet-images-staging');
const BUCKET = 'diet-images';
const FORCE = process.argv.includes('--force');

const CONTENT_TYPES = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif' };

async function ensureBucketIsPrivate() {
  const { data, error } = await supabaseAdmin.storage.getBucket(BUCKET);
  if (error) {
    const { error: createErr } = await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
    if (createErr) throw new Error(`Could not find or create bucket "${BUCKET}": ${createErr.message}`);
    return;
  }
  if (data.public) {
    // These are patient-facing diet photos behind a login; every route that
    // serves one assumes it is unreachable without a signed URL. A public
    // bucket would make every object fetchable by anyone who has the hash.
    throw new Error(
      `Bucket "${BUCKET}" is PUBLIC. Make it private in the Supabase dashboard ` +
        `(Storage -> ${BUCKET} -> Settings) before syncing.`
    );
  }
}

async function existingNames() {
  const names = new Set();
  let offset = 0;
  for (;;) {
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).list('', { limit: 1000, offset });
    if (error) throw new Error(`Could not list bucket: ${error.message}`);
    if (!data.length) break;
    data.forEach((o) => names.add(o.name));
    if (data.length < 1000) break;
    offset += data.length;
  }
  return names;
}

async function main() {
  if (!supabaseAdmin) {
    console.error('Supabase is not configured (check server/.env).');
    process.exit(1);
  }
  if (!fs.existsSync(STAGE_DIR)) {
    console.error(`Nothing staged at ${STAGE_DIR}. Run: node scripts/migrate-all.js`);
    process.exit(1);
  }
  await ensureBucketIsPrivate();

  const files = fs.readdirSync(STAGE_DIR).filter((n) => /^[0-9a-f]{16}\.(jpg|png|gif)$/.test(n));
  const already = FORCE ? new Set() : await existingNames();
  const todo = files.filter((n) => !already.has(n));
  const totalMb = todo.reduce((n, f) => n + fs.statSync(path.join(STAGE_DIR, f)).size, 0) / 1e6;
  console.log(`${files.length} staged, ${files.length - todo.length} already in bucket, uploading ${todo.length} (${totalMb.toFixed(1)} MB)...`);

  let ok = 0;
  const failed = [];
  for (let i = 0; i < todo.length; i++) {
    const name = todo[i];
    const buf = fs.readFileSync(path.join(STAGE_DIR, name));
    const ext = name.split('.').pop();
    const { error } = await supabaseAdmin.storage.from(BUCKET).upload(name, buf, {
      contentType: CONTENT_TYPES[ext] || 'application/octet-stream',
      upsert: true,
    });
    if (error) {
      failed.push({ name, error: error.message });
      console.log(`[${i + 1}/${todo.length}] FAILED ${name}: ${error.message}`);
    } else {
      ok++;
      if ((i + 1) % 25 === 0 || i === todo.length - 1) console.log(`[${i + 1}/${todo.length}] uploaded`);
    }
  }

  console.log(`\nDone. ${ok} uploaded, ${failed.length} failed.`);
  if (failed.length) {
    console.log('Failures:', JSON.stringify(failed, null, 2));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
