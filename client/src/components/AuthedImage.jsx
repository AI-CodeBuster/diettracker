// A plain <img src="/api/..."> can't carry the bearer token every /api/*
// route requires (browsers never attach custom headers to image requests),
// so it would just 401 — same reason apiFetch.js's openAuthedFile exists
// for authed downloads. This is that same fetch-then-blob-URL trick, kept
// mounted instead of one-shot: fetch the bytes with auth, hand the <img> an
// object URL, and revoke it on unmount/src-change rather than on a timer.
//
// One automatic retry (short backoff) before settling into the permanent
// placeholder — cheap insurance against a transient failure (a slow cold
// serverless start, a dropped connection under a burst of requests) that
// would otherwise leave a photo silently blank forever with nothing
// downstream to notice or retry.
//
// lazy (opt-in, default off): defers starting the fetch until this element
// is actually near the viewport (IntersectionObserver), instead of firing
// the instant it mounts. Off by default because DietTemplateView keeps
// every meal/tab's images mounted at once so "Download as PDF" can reveal
// them all via print CSS (App.css's ".diet-meal-panel { display: block
// !important }") — an image inside a currently-inactive (display: none)
// tab would never intersect at all under IntersectionObserver, so it would
// never even start loading in time for a coach who opens a plan and
// downloads immediately without switching tabs. Opt in only where a long,
// unfiltered list can mount hundreds of these at once — the Recipe
// Library grid (RecipeLibraryBrowser.jsx), which with no filter applied
// can render 500+ cards simultaneously: that many concurrent authenticated
// fetches firing at once is what was producing a handful of silently
// blank photos (some transiently failing under the burst, with no retry
// until now). Capping it to roughly a screenful at a time removes the
// burst instead of just papering over it with a retry.
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/apiFetch';

const RETRY_DELAY_MS = 1200;

function AuthedImage({ src, alt, className, lazy = false }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [visible, setVisible] = useState(!lazy);
  const [retriesLeft, setRetriesLeft] = useState(1);
  const elRef = useRef(null);

  useEffect(() => { setRetriesLeft(1); }, [src]);

  useEffect(() => {
    if (!lazy || visible) return;
    const el = elRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) setVisible(true); },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [lazy, visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let objectUrl = null;
    let retryTimer = null;
    setBlobUrl(null);
    apiFetch(src)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (cancelled) return;
        if (!blob) {
          if (retriesLeft > 0) retryTimer = setTimeout(() => { if (!cancelled) setRetriesLeft((n) => n - 1); }, RETRY_DELAY_MS);
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled && retriesLeft > 0) retryTimer = setTimeout(() => { if (!cancelled) setRetriesLeft((n) => n - 1); }, RETRY_DELAY_MS);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (retryTimer) clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, visible, retriesLeft]);

  if (!blobUrl) return <div ref={elRef} className={`${className} diet-recipe-image-loading`} aria-hidden="true" />;
  return <img ref={elRef} className={className} src={blobUrl} alt={alt} />;
}

export default AuthedImage;
