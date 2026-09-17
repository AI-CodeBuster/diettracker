import { supabase } from './supabaseClient';

async function authHeaders(existing) {
  const headers = new Headers(existing);
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

// Drop-in replacement for fetch() against our own /api/* routes — attaches
// the current Supabase session as a bearer token, since every route now
// requires one.
export async function apiFetch(input, init = {}) {
  const headers = await authHeaders(init.headers);
  return fetch(input, { ...init, headers });
}

// Plain <a href> navigation can't carry an Authorization header, so file
// downloads/opens route through here instead: fetch the bytes with auth,
// then hand the browser a blob URL to save under the given filename.
export async function openAuthedFile(url, filename) {
  const res = await apiFetch(url);
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
}
