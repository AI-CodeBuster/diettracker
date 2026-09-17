// Vercel entrypoint: every /api/* request (per the rewrite in vercel.json)
// is routed here, and Vercel invokes the exported Express app directly as
// the request handler — Express's own router then dispatches based on the
// original request path.
module.exports = require('../server/index.js');
