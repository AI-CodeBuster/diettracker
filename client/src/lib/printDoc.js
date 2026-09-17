import { renderAsync } from 'docx-preview';
import { reapplySavedReplacement } from './foodMatch';
import { apiFetch } from './apiFetch';

// Builds one merged, printable document out of a gear chain and hands it to
// the browser's own print dialog, where it gets saved as a PDF.
//
// Why the print dialog rather than converting server-side: the app runs as a
// single Vercel serverless function with a 30s ceiling, these templates are
// 15-20MB .docx files, and the personalized copy differs per patient, so
// nothing can be converted ahead of time. The browser already renders these
// files (docx-preview) for the viewer, and its own PDF engine produces real
// vector text at the right page size for free — no extra dependency, no
// conversion service, and no risk of timing out on a big file.
const PRINT_ROOT_ID = 'print-root';

function printRoot() {
  let el = document.getElementById(PRINT_ROOT_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = PRINT_ROOT_ID;
    document.body.appendChild(el);
  }
  el.innerHTML = '';
  return el;
}

/** The URL a gear's bytes come from: the first (primary) gear keeps its own
 * cover page — the patient questionnaire and table of contents — while every
 * gear appended below it has that stripped, so the merged document doesn't
 * repeat a cover sheet two or three times over. Mirrors what the on-screen
 * viewer already does for its appended sections. */
function sectionUrl(entry, isPrimary) {
  return isPrimary ? `/api/diet-file/${entry.id}` : `/api/diet-file/${entry.id}/without-cover`;
}

// docx-preview's embedded images are set via URL.createObjectURL(blob) —
// renderAsync's own promise resolves as soon as the HTML is built and
// inserted, without ever waiting on those <img> elements to actually load
// (its source has no 'load' listener on them at all). The browser fetches
// and decodes each blob URL afterwards, on its own schedule, fully
// decoupled from that await. That's invisible in the on-screen viewer —
// the coach is just looking at the screen and the images pop in a moment
// later — but calling window.print() too soon races that decode: a page
// that's mostly one embedded image (a chart graphic, a scanned table) can
// come out blank. This waits for every image actually inserted to finish
// loading (or fail) before the print dialog opens.
function waitForImages(root, timeoutMs = 15000) {
  const imgs = Array.from(root.querySelectorAll('img'));
  if (!imgs.length) return Promise.resolve();
  return Promise.all(
    imgs.map((img) => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise((resolve) => {
        const done = () => { img.removeEventListener('load', done); img.removeEventListener('error', done); resolve(); };
        img.addEventListener('load', done);
        img.addEventListener('error', done); // a broken image shouldn't hang the whole print
        setTimeout(done, timeoutMs);
      });
    }),
  );
}

// Two animation-frame turns is the standard way to wait for a full
// layout+paint cycle to actually complete, rather than just be scheduled —
// belt-and-suspenders alongside waitForImages against the same class of
// "printed before it finished painting" race.
function nextTwoFrames() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

// docx-preview converts each table's Word column widths into a <colgroup>
// of absolute-unit <col> elements sized for that .docx's OWN original page
// width. The print CSS forces every table to table-layout:fixed (so a wide
// Tamil phrase can't force auto-layout to grow the table past the page —
// see the @media print rule in App.css), but per the CSS table spec, a
// fixed-layout table's rendered width is
//   MAX(the table's own specified width, the SUM of its column widths)
// — so even with `width: 100% !important` on the table itself, if that
// column-width sum exceeds the print page's width (routine for a template
// whose original Word page was wider than Letter/A4), the sum wins and the
// table overflows the page's right edge regardless, with no CSS override
// able to stop it. Converting each <col> to a percentage OF THAT SAME
// TABLE's own total removes the floor entirely: the ratios between columns
// are preserved bit-for-bit, but their sum becomes exactly 100%, so
// MAX(100%, 100%) can never exceed the page.
function makeTablesResponsive(root) {
  root.querySelectorAll('table').forEach((table) => {
    const cols = table.querySelectorAll(':scope > colgroup > col');
    if (!cols.length) return;
    const widths = Array.from(cols).map((c) => parseFloat(c.style.width) || 0);
    const total = widths.reduce((a, b) => a + b, 0);
    if (!total) return;
    cols.forEach((col, i) => { col.style.width = `${(widths[i] / total) * 100}%`; });
  });
}

let cleanupPrevious = null;

function armCleanup(root, prevTitle) {
  cleanupPrevious?.();
  const cleanup = () => {
    document.title = prevTitle;
    root.innerHTML = '';
    window.removeEventListener('afterprint', cleanup);
    if (cleanupPrevious === cleanup) cleanupPrevious = null;
  };
  cleanupPrevious = cleanup;
  window.addEventListener('afterprint', cleanup);
  // Chrome fires afterprint reliably; Safari historically hasn't, so this
  // backstop makes sure the (large) rendered copy doesn't sit in the DOM
  // forever if the event never arrives.
  setTimeout(cleanup, 120_000);
}

/**
 * Fetches, renders, and merges a gear chain into an off-screen document —
 * everything that can be async — WITHOUT calling window.print(). Split out
 * from triggerPrint() on purpose: window.print() called after a long async
 * gap (several network fetches, docx-preview renders, image loads) is a
 * documented source of blank/stale print output in some browsers, which
 * some print pipelines tie to the original click's user-gesture context
 * rather than to whatever is on the page the instant print() actually
 * runs. Keeping ALL of the async work here means the button that finally
 * calls window.print() can do so as the very first, fully synchronous
 * thing in its own click handler, with nothing awaited in between.
 *
 * @param {object} opts
 * @param {Array<{gear: number, entry: object, mealLabel: string, replacements?: Array}>} opts.sections
 *   Rendered top to bottom in the order given. `replacements` is applied to
 *   that section only when present — that's the single difference between the
 *   personalized download and the unmodified "original" copy.
 * @param {(msg: string) => void} [opts.onProgress]
 * @returns {Promise<void>} resolves once the merged document is fully
 *   rendered, images loaded, and ready for triggerPrint() to print it.
 */
export async function prepareGearChain({ sections, onProgress }) {
  const root = printRoot();

  // renderAsync is called one section at a time on purpose: docx-preview
  // isn't documented as safe to run concurrently against the same page, and
  // the viewer already serialises its appended sections for the same reason.
  for (let i = 0; i < sections.length; i++) {
    const { gear, entry, mealLabel, replacements } = sections[i];
    onProgress?.(`Preparing ${mealLabel} (Gear ${gear})… ${i + 1} of ${sections.length}`);

    const wrap = document.createElement('div');
    wrap.className = 'print-gear';

    const heading = document.createElement('h1');
    heading.className = 'print-meal-heading';
    heading.textContent = mealLabel;
    wrap.appendChild(heading);

    const body = document.createElement('div');
    body.className = 'print-gear-body';
    wrap.appendChild(body);
    root.appendChild(wrap);

    const res = await apiFetch(sectionUrl(entry, i === 0));
    if (!res.ok) throw new Error(`Could not load the Gear ${gear} plan (server returned ${res.status}).`);
    await renderAsync(await res.arrayBuffer(), body, undefined, {
      className: 'docx',
      inWrapper: true,
      ignoreLastRenderedPageBreak: true,
    });

    // Same first-occurrence-at-a-time semantics the viewer and the server-side
    // .docx rewrite both use, so N saved entries for the same word consume N
    // distinct occurrences rather than all landing on the first one.
    for (const { originalText, replacementText } of replacements || []) {
      if (!originalText || !replacementText) continue;
      reapplySavedReplacement(body, originalText, replacementText);
    }
  }

  makeTablesResponsive(root);

  onProgress?.('Waiting for images to finish loading…');
  await waitForImages(root);
  await nextTwoFrames();
}

/**
 * Prints the document prepareGearChain() just built. Deliberately synchronous
 * end to end (no await anywhere in this function) — call it directly from a
 * click handler, with nothing async between the click and this call, so
 * window.print() runs on a document the browser just finished laying out and
 * with the click's own user-gesture context still fresh.
 *
 * @param {string} [fileName] Seeds the print dialog's suggested PDF name.
 */
export function triggerPrint(fileName) {
  const root = document.getElementById(PRINT_ROOT_ID);
  if (!root || !root.childElementCount) {
    throw new Error('Nothing to print — call prepareGearChain() first.');
  }

  // The print dialog seeds its suggested "Save as PDF" filename from
  // document.title, so this is what makes the saved file land under a
  // recognisable patient/gear name instead of the app's own title.
  const prevTitle = document.title;
  if (fileName) document.title = fileName;

  armCleanup(root, prevTitle);
  window.print();
}
