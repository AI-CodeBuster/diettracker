// A plain <img src="/api/..."> can't carry the bearer token every /api/*
// route requires (browsers never attach custom headers to image requests),
// so it would just 401 — same reason apiFetch.js's openAuthedFile exists
// for authed downloads. This is that same fetch-then-blob-URL trick, kept
// mounted instead of one-shot: fetch the bytes with auth, hand the <img> an
// object URL, and revoke it on unmount/src-change rather than on a timer.
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiFetch';

function AuthedImage({ src, alt, className }) {
  const [blobUrl, setBlobUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    setBlobUrl(null);
    apiFetch(src)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (!blobUrl) return <div className={`${className} diet-recipe-image-loading`} aria-hidden="true" />;
  return <img className={className} src={blobUrl} alt={alt} />;
}

export default AuthedImage;
