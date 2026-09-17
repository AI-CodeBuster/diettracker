// Authenticated Google Sheets client, used for every write-back into the
// tracker spreadsheet (TL verification, Mark Prepared — see
// tlVerificationWriter.js / prepStatusWriter.js) — every sheet *read* in this
// app goes through the unauthenticated CSV/gviz export instead, which is
// enough for reading a publicly-viewable sheet but can't write.
//
// Credentials come from one env var, GOOGLE_SERVICE_ACCOUNT_KEY_JSON — the
// full JSON key file downloaded from Google Cloud Console (IAM & Admin ->
// Service Accounts -> Keys -> Add key -> JSON), pasted in as one line. A
// single JSON blob avoids the usual pain of escaping the private key's
// newlines across two separate env vars.
const { google } = require('googleapis');

let cachedClient = null;

function loadCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY_JSON is set but is not valid JSON');
  }
}

async function getSheetsClient() {
  if (cachedClient) return cachedClient;
  const credentials = loadCredentials();
  if (!credentials) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_KEY_JSON is not configured on the server — this app can\'t write to Google Sheets yet.'
    );
  }
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  await auth.authorize();
  cachedClient = google.sheets({ version: 'v4', auth });
  return cachedClient;
}

module.exports = { getSheetsClient };
