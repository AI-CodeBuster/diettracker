import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { renderAsync } from 'docx-preview';
import { matchDietOptions, queryManifest, BASE_CONDITIONS } from '../lib/matchDiet';
import { CONDITION_LABELS, DIET_LABELS, LANGUAGE_LABELS } from '../lib/labels';
import { scanAndHighlight, applyReplacement, reapplySavedReplacement, revertReplacement } from '../lib/foodMatch';
import { suggestSubstitutes } from '../lib/suggestSubstitute';
import { patientKey } from '../lib/patientKey';
import { apiFetch } from '../lib/apiFetch';
import { prepareGearChain, triggerPrint } from '../lib/printDoc';

function uniqueBy(arr, fn) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = fn(x);
    if (!seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}

const GEAR_MEAL_LABELS = { 2: 'Breakfast', 3: 'Lunch', 4: 'Dinner' };

// Word renders a chart at a fixed physical page width (~816px for a
// Letter-size page) regardless of viewport — on a phone (or a narrower
// appended section) that's wider than the available space, so this scales
// the whole rendered page down to fit. offsetWidth/offsetHeight are layout
// metrics unaffected by a transform, so they stay reliable to re-measure
// even after a previous scale has been applied. marginBottom compensates
// for the visual shrink, since transform doesn't change the element's
// layout box size — without it the container would still reserve its full
// unscaled height, leaving a blank gap below. Shared by the primary render
// and every AppendedGearView so an appended section's right edge doesn't
// run past the panel the way an unscaled one would.
function useScaleToFit(innerRef, viewportRef, ready) {
  useEffect(() => {
    if (!ready) return;
    const viewport = viewportRef.current;
    const inner = innerRef.current;
    if (!viewport || !inner) return;

    const recompute = () => {
      const page = inner.querySelector('.docx');
      if (!page) return;
      const available = viewport.clientWidth - 32; // .panel-body's 16px padding on each side
      const naturalWidth = page.offsetWidth;
      if (!naturalWidth || naturalWidth <= available) {
        inner.style.transform = '';
        inner.style.marginBottom = '';
        return;
      }
      const scale = available / naturalWidth;
      const naturalHeight = inner.offsetHeight;
      inner.style.transform = `scale(${scale})`;
      inner.style.transformOrigin = 'top center';
      inner.style.marginBottom = `${-(naturalHeight * (1 - scale))}px`;
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(viewport);
    return () => ro.disconnect();
  }, [ready, innerRef, viewportRef]);
}

/**
 * Renders one *additional* gear's chart (its own cover page stripped, via
 * /without-cover) appended below the primary gear being viewed — Gear 3
 * shows Lunch+Dinner, Gear 2 shows Breakfast+Lunch+Dinner. Deliberately
 * self-contained and outside the primary containerRef: it does not
 * participate in allergy/dislike scanning, saved replacements, or the
 * download button, all of which stay scoped to the one gear actually
 * selected above (see the "view only" scope this was built to).
 *
 * Calls onSettled() exactly once, on success or failure, so the parent can
 * render these one at a time (see appendedRenderedCount below) rather than
 * firing every renderAsync() call at once — docx-preview isn't written with
 * concurrent calls in mind, and this app has no test coverage proving that
 * two calls racing against each other on the same page is actually safe.
 */
function AppendedGearView({ entry, gear, onSettled, viewportRef }) {
  const ref = useRef(null);
  const [status, setStatus] = useState('loading');
  useScaleToFit(ref, viewportRef, status === 'ready');

  useEffect(() => {
    let cancelled = false;
    let settled = false;
    const settle = (next) => {
      if (cancelled) return;
      setStatus(next);
      if (!settled) { settled = true; onSettled(); }
    };
    setStatus('loading');
    apiFetch(`/api/diet-file/${entry.id}/without-cover`)
      .then((res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => {
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = '';
        return renderAsync(buf, ref.current, undefined, {
          className: 'docx',
          inWrapper: true,
          ignoreLastRenderedPageBreak: true,
        });
      })
      .then(() => settle('ready'))
      .catch(() => settle('error'));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  return (
    <div className="appended-gear-section">
      <div className="appended-gear-label">{GEAR_MEAL_LABELS[gear] || `Gear ${gear}`}</div>
      {status === 'loading' && <div className="panel-status">Loading…</div>}
      {status === 'error' && <div className="panel-status panel-error">Couldn't load Gear {gear}.</div>}
      <div ref={ref} className="docx-container" style={{ display: status === 'ready' ? 'block' : 'none' }} />
    </div>
  );
}

/**
 * Looks up whether this patient already has a saved (previously edited)
 * gear before rendering anything — the result decides which manifest file
 * to open (see DietViewerPanelReady), so it has to resolve first rather
 * than after an initial auto-detected file has already started loading.
 */
function DietViewerPanel({ person, gear, manifestFiles, foodRules, sheetName, onClose, fullscreen, onToggleFullscreen }) {
  const pKey = useMemo(() => patientKey(sheetName, person), [sheetName, person]);
  // undefined = looking up; null = no saved gear; object = { manifestId, replacements }
  const [savedGear, setSavedGear] = useState(undefined);
  // Every gear's saved overrides, keyed by gear number. The merged PDF spans
  // this gear *and* the later ones, so it needs each of their replacement
  // lists — and /api/patient-data returns them all in this one request.
  const [allGears, setAllGears] = useState({});

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/patient-data/${encodeURIComponent(pKey)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setAllGears(data.gears || {});
        setSavedGear((data.gears && data.gears[String(gear)]) || null);
      })
      .catch(() => { if (!cancelled) { setAllGears({}); setSavedGear(null); } });
    return () => { cancelled = true; };
  }, [pKey, gear]);

  if (savedGear === undefined) {
    return (
      <div className={`panel${fullscreen ? ' panel-fullscreen' : ''}`}>
        <header className="panel-header">
          <div>
            <h2>Gear {gear} Diet Plan</h2>
            <p className="panel-subtitle">{person.name}{person.studentId ? ` · #${person.studentId}` : ''}</p>
          </div>
          <div className="panel-header-actions">
            <button className="panel-close" onClick={onClose} type="button" aria-label="Close">×</button>
          </div>
        </header>
        <div className="panel-body-wrap">
          <div className="panel-body">
            <div className="panel-status">Loading…</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <DietViewerPanelReady
      person={person}
      gear={gear}
      manifestFiles={manifestFiles}
      foodRules={foodRules}
      pKey={pKey}
      savedGear={savedGear}
      allGears={allGears}
      onClose={onClose}
      fullscreen={fullscreen}
      onToggleFullscreen={onToggleFullscreen}
    />
  );
}

function DietViewerPanelReady({ person, gear, manifestFiles, foodRules, pKey, savedGear, allGears, onClose, fullscreen, onToggleFullscreen }) {
  const options = useMemo(() => matchDietOptions(manifestFiles, person, gear), [manifestFiles, person, gear]);

  // A saved gear pins the diet plan to the exact file it was edited
  // against, so reopening this gear shows that same edited version instead
  // of silently falling back to a freshly auto-detected default (which may
  // be a different file and wouldn't carry the saved replacements).
  const savedEntry = useMemo(() => {
    if (!savedGear || !savedGear.manifestId) return null;
    return manifestFiles.find((f) => f.id === savedGear.manifestId) || null;
  }, [savedGear, manifestFiles]);

  const [condition, setCondition] = useState(savedEntry?.condition ?? options[0]?.condition ?? 'DIABETES');
  const [comorbid, setComorbid] = useState(savedEntry ? (savedEntry.comorbid || null) : (options[0]?.comorbid ?? null));
  const [dietType, setDietType] = useState(savedEntry?.dietType ?? options[0]?.best?.dietType ?? person.vegPreference ?? null);
  const [language, setLanguage] = useState(savedEntry?.language ?? options[0]?.best?.language ?? person.language ?? null);

  const dietTypeChoices = useMemo(
    () => uniqueBy(manifestFiles.filter((f) => f.condition === condition && f.gear === gear && (f.comorbid || null) === (comorbid || null)), (f) => f.dietType).map((f) => f.dietType),
    [manifestFiles, condition, comorbid, gear]
  );
  const languageChoices = useMemo(
    () => uniqueBy(manifestFiles.filter((f) => f.condition === condition && f.gear === gear && (f.comorbid || null) === (comorbid || null) && f.dietType === dietType), (f) => f.language).map((f) => f.language),
    [manifestFiles, condition, comorbid, gear, dietType]
  );

  const selectedEntry = useMemo(() => {
    const ranked = queryManifest(manifestFiles, { condition, comorbid, gear, dietType, language });
    return ranked[0] || null;
  }, [manifestFiles, condition, comorbid, gear, dietType, language]);

  // Gear 3 additionally shows Gear 4 (Lunch + Dinner); Gear 2 shows Gear 3
  // and Gear 4 too (Breakfast + Lunch + Dinner) — now part of the actual
  // downloaded/printed plan (see printDoc.js), not just an on-screen
  // convenience, so silently dropping a later gear here means handing the
  // patient a "complete" PDF with a whole meal missing from it.
  //
  // A later gear's own diet-type note can name a condition no template was
  // ever prepared for at that gear — e.g. a patient's Gear 4 note says only
  // "THYROID", the manifest has zero Gear 4 THYROID files (Gear 2/3 THYROID
  // exist, Gear 4 never got one made), yet the SAME patient's Gear 2 note
  // ("DIABETES,THYROID") auto-detects to THYROID too, and reusing that one
  // condition across every later gear used to be the only thing tried —
  // so Gear 4 came up empty even though the patient's own broader clinical
  // record also says Diabetes, and a Diabetes Gear 4 template does exist.
  // Tried in order, first hit wins:
  //   1. This gear's own note, exactly like the primary gear's selection —
  //      most authoritative when a template actually exists for it.
  //   2. The condition already chosen for the gear being viewed — keeps the
  //      chain visually consistent when this gear's own note doesn't name
  //      anything with a real file.
  //   3. Re-detected from the patient's FULL clinical record instead of
  //      just this gear's own (narrower) note — catches exactly the
  //      Gowri-style case above.
  // Only if all three come up empty is the gear actually skipped — there
  // is genuinely no file to show for it under any reading of this patient's
  // notes.
  const appendEntries = useMemo(() => {
    const out = [];
    for (let g = gear + 1; g <= 4; g++) {
      let entry = null;

      const ownBest = matchDietOptions(manifestFiles, person, g)[0];
      if (ownBest) {
        entry = queryManifest(manifestFiles, { condition: ownBest.condition, comorbid: ownBest.comorbid, gear: g, dietType, language })[0] || null;
      }

      if (!entry) {
        entry = queryManifest(manifestFiles, { condition, comorbid, gear: g, dietType, language })[0] || null;
      }

      if (!entry && person.gearDietType && person.gearDietType[g]) {
        const fallbackPerson = { ...person, gearDietType: { ...person.gearDietType, [g]: '' } };
        const fallbackBest = matchDietOptions(manifestFiles, fallbackPerson, g)[0];
        if (fallbackBest) {
          entry = queryManifest(manifestFiles, { condition: fallbackBest.condition, comorbid: fallbackBest.comorbid, gear: g, dietType, language })[0] || null;
        }
      }

      if (entry) out.push({ gear: g, entry });
    }
    return out;
  }, [manifestFiles, person, condition, comorbid, dietType, language, gear]);

  // Renders appendEntries one at a time instead of all at once — see
  // AppendedGearView's docstring. Reset to 1 (not 0) whenever the list of
  // entries to show changes, so the first section mounts immediately rather
  // than waiting for an extra render.
  const [appendedRenderedCount, setAppendedRenderedCount] = useState(1);
  useEffect(() => {
    setAppendedRenderedCount(1);
  }, [appendEntries]);

  // Keep dietType/language valid whenever condition/comorbid changes and the
  // previous selection no longer exists for the new combo.
  useEffect(() => {
    if (dietTypeChoices.length && !dietTypeChoices.includes(dietType)) {
      setDietType(dietTypeChoices.includes(person.vegPreference) ? person.vegPreference : dietTypeChoices[0]);
    }
  }, [dietTypeChoices]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (languageChoices.length && !languageChoices.includes(language)) {
      setLanguage(languageChoices.includes(person.language) ? person.language : languageChoices[0]);
    }
  }, [languageChoices]); // eslint-disable-line react-hooks/exhaustive-deps

  const containerRef = useRef(null);
  const panelBodyRef = useRef(null); // the scrollable document viewport — nav scrolling is scoped to just this
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [fileActionError, setFileActionError] = useState(null);

  // Both output files span the same chain — the gear being viewed followed by
  // every later gear, each under its meal heading (Gear 2 -> Breakfast +
  // Lunch + Dinner, Gear 3 -> Lunch + Dinner, Gear 4 -> Dinner alone) —
  // matching what the viewer already shows on screen. The *only* difference
  // between them is whether the patient's replacements get baked in.
  const printChain = useMemo(() => {
    if (!selectedEntry) return [];
    return [{ gear, entry: selectedEntry }, ...appendEntries].map((s) => ({
      gear: s.gear,
      entry: s.entry,
      mealLabel: GEAR_MEAL_LABELS[s.gear] || `Gear ${s.gear}`,
    }));
  }, [selectedEntry, appendEntries, gear]);

  // Plain functions rather than useCallback: these only ever run from a
  // click, so memoising them buys nothing — and reading the live
  // replacements ref inside a hook would make every later write to that ref
  // look like mutation of hook-captured state.
  //
  // The gear on screen is the one actively being edited, so its live
  // in-session list wins; the later gears come from whatever is saved
  // server-side. A saved list recorded against a different template is
  // ignored rather than misapplied.
  const replacementsForGear = (g, entry) => {
    if (g === gear) return savedReplacementsRef.current || [];
    const saved = allGears && allGears[String(g)];
    return saved && saved.manifestId === entry.id ? saved.replacements || [] : [];
  };

  // "Breakfast + Lunch + Dinner" — names what the two buttons will actually
  // produce, so it's clear the output isn't just the one gear on screen.
  const chainLabel = useMemo(
    () => printChain.map((s) => s.mealLabel).join(' + '),
    [printChain],
  );

  const [printBusy, setPrintBusy] = useState(null);
  // Set once prepareGearChain() finishes, holding just what the second,
  // fully-synchronous click needs to call triggerPrint() with — never
  // anything that needs an await. Two clicks rather than one is a
  // deliberate trade-off: window.print() called well after several network
  // fetches and renders is a documented source of blank output in some
  // browsers, evidently including whatever the coach reporting this bug is
  // on — some print pipelines tie their output to the ORIGINAL click's
  // user-gesture context rather than to what's on the page when print()
  // actually runs. Splitting "prepare" from "print" into two clicks means
  // the second click IS that fresh gesture, with zero async work between
  // it and window.print().
  const [printReady, setPrintReady] = useState(null); // null | { fileName }

  const runPrepare = async (withReplacements) => {
    setFileActionError(null);
    setPrintReady(null);
    if (!printChain.length) return;
    setPrintBusy('Preparing…');
    try {
      await prepareGearChain({
        sections: printChain.map((s) => ({
          ...s,
          replacements: withReplacements ? replacementsForGear(s.gear, s.entry) : undefined,
        })),
        onProgress: setPrintBusy,
      });
      setPrintReady({
        fileName: `${(person.name || pKey).replace(/[^\w-]+/g, '_')}_gear${gear}_${withReplacements ? 'diet-plan' : 'original'}`,
      });
    } catch (err) {
      setFileActionError(err.message || 'Could not build the PDF.');
    } finally {
      setPrintBusy(null);
    }
  };

  // The button onClick itself — plain and synchronous, not async, so
  // nothing can slip an await in before triggerPrint() reaches window.print().
  const handlePrintNow = () => {
    if (!printReady) return;
    try {
      triggerPrint(printReady.fileName);
    } catch (err) {
      setFileActionError(err.message || 'Could not open the print dialog.');
    } finally {
      setPrintReady(null);
    }
  };

  const handleOpenOriginal = () => runPrepare(false);
  const handleDownloadForPatient = () => runPrepare(true);

  useEffect(() => {
    if (!selectedEntry) { setStatus('error'); return; }
    let cancelled = false;
    setStatus('loading');
    apiFetch(`/api/diet-file/${selectedEntry.id}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => {
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = '';
        return renderAsync(buf, containerRef.current, undefined, {
          className: 'docx',
          inWrapper: true,
          ignoreLastRenderedPageBreak: true,
        });
      })
      .then(() => { if (!cancelled) setStatus('ready'); })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [selectedEntry]);

  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      // Escape backs out one level at a time: fullscreen first, then close.
      if (fullscreen) onToggleFullscreen();
      else onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, fullscreen, onToggleFullscreen]);

  // ---- allergy / dislike detection + replacement ----
  const [flagged, setFlagged] = useState({ found: [], unmatched: [] });
  const [showFlagged, setShowFlagged] = useState(false);
  const [matchStates, setMatchStates] = useState({}); // matchId -> { status, inputValue, suggestions }
  const savedReplacementsRef = useRef([]); // running authoritative list for this person+gear, persisted to the server

  // ---- up/down navigation between highlighted (yellow flagged + green
  // replaced) marks in the rendered chart ----
  const [navPos, setNavPos] = useState(-1); // -1 = nothing navigated to yet
  const [navTotal, setNavTotal] = useState(0);

  // Queried live from the DOM rather than cached: a match can span more than
  // one <mark> when Word split its run across multiple text nodes (see
  // wrapMatches in foodMatch.js), all sharing one data-match-id — dedupe to
  // that id so a single logical match is one stop, not several.
  const getNavMarks = useCallback(() => {
    if (!containerRef.current) return [];
    const all = Array.from(containerRef.current.querySelectorAll('mark.food-flag, mark.food-replaced'));
    const seen = new Set();
    return all.filter((m) => {
      const id = m.dataset.matchId;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, []);

  // Scrolls only the document viewport itself, never any outer ancestor —
  // target.scrollIntoView() would walk up and scroll *every* scrollable
  // ancestor needed to bring the target into view, which in the normal
  // (non-fullscreen) docked layout includes the outer page. That drags the
  // whole panel — nav buttons included — around on screen. Computing the
  // delta and scrolling panelBodyRef directly keeps the buttons perfectly
  // static; only the chart underneath them moves.
  const scrollTargetIntoPanelView = useCallback((target) => {
    const panel = panelBodyRef.current;
    if (!panel) return;
    const panelRect = panel.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const delta = (targetRect.top + targetRect.height / 2) - (panelRect.top + panelRect.height / 2);
    panel.scrollTo({ top: panel.scrollTop + delta, behavior: 'smooth' });
  }, []);

  const navigate = useCallback((direction) => {
    const marks = getNavMarks();
    if (!marks.length) return;
    // Computed inside the updater (rather than off the navPos closure) so
    // consecutive clicks always advance from the true latest position, even
    // if fired faster than React re-renders between them.
    setNavPos((prev) => {
      const next = prev === -1
        ? (direction === 'down' ? 0 : marks.length - 1)
        : Math.max(0, Math.min(marks.length - 1, prev + (direction === 'down' ? 1 : -1)));
      const target = marks[next];
      scrollTargetIntoPanelView(target);
      target.classList.add('food-nav-current');
      setTimeout(() => target.classList.remove('food-nav-current'), 1500);
      return next;
    });
  }, [getNavMarks, scrollTargetIntoPanelView]);

  useEffect(() => {
    if (status !== 'ready' || !containerRef.current || !selectedEntry) return;

    const savedReplacements = savedGear && savedGear.manifestId === selectedEntry.id ? savedGear.replacements || [] : [];
    savedReplacementsRef.current = savedReplacements;
    const reapplied = savedReplacements.filter((r) => reapplySavedReplacement(containerRef.current, r.originalText, r.replacementText));

    // Tamil dislike/allergy terms are typed in English by coaches, so when
    // this diet plan is the Tamil-language version, scanAndHighlight also
    // searches each term's Tamil translation (via foodRules) so matches are
    // still found inside the Tamil-script chart text.
    const result = scanAndHighlight(containerRef.current, {
      allergyText: person.foodAllergy,
      dislikeText: person.dislikeFood,
      rules: foodRules,
      language,
    });

    // scanAndHighlight's own pass skips text already inside a replaced mark
    // (it's not "still flagged"), so reapplied saved replacements never show
    // up in result.found — but the coach should still be able to review and
    // change them after reopening this gear, so add them back in from the
    // data already saved for them.
    const reappliedFound = reapplied.map((r) => ({ id: r.id, term: r.matchedTerm, source: r.source, text: r.originalText }));
    setFlagged({ found: [...reappliedFound, ...result.found], unmatched: result.unmatched });

    const initialStates = {};
    reapplied.forEach((r) => { initialStates[r.id] = { status: 'done', inputValue: '', replacementText: r.replacementText }; });
    result.found.forEach((m) => { initialStates[m.id] = { status: 'flagged', inputValue: '' }; });
    setMatchStates(initialStates);
    setNavPos(-1);
    setNavTotal(getNavMarks().length);
  }, [status, selectedEntry, person, foodRules, language, savedGear, getNavMarks]);

  useScaleToFit(containerRef, panelBodyRef, status === 'ready');

  const persistReplacement = useCallback((entry) => {
    // Not deduped by originalText: the same word (e.g. "Fish") can
    // legitimately appear — and get flagged/replaced — at more than one
    // location in the document, each a distinct match.id. Deduped by id
    // instead, so changing an already-applied replacement to a different
    // alternative updates that one stored entry rather than piling up a new
    // one every time the coach reconsiders it.
    const existingIdx = savedReplacementsRef.current.findIndex((r) => r.id === entry.id);
    const next = existingIdx >= 0
      ? savedReplacementsRef.current.map((r, i) => (i === existingIdx ? entry : r))
      : [...savedReplacementsRef.current, entry];
    // Reassigning a ref is the whole point of one; the rule only fires here
    // because runPrint reads this ref to bake the coach's not-yet-refetched
    // edits into the downloaded PDF, which makes the write look to the
    // linter like mutation of hook-captured state.
    // eslint-disable-next-line react/immutability
    savedReplacementsRef.current = next;
    apiFetch(`/api/patient-data/${encodeURIComponent(pKey)}/gear/${gear}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifestId: selectedEntry?.id, replacements: next }),
    }).catch(() => {});
  }, [pKey, gear, selectedEntry]);

  // Revert's other half: drops a saved replacement entirely rather than
  // upserting one, so the reverted item goes back to being just a flagged
  // (not replaced) match the next time this gear's overrides are loaded —
  // including in the downloaded/printed PDF, which reads this same
  // server-side list (see replacementsForGear below).
  const removeSavedReplacement = useCallback((matchId) => {
    const next = savedReplacementsRef.current.filter((r) => r.id !== matchId);
    // eslint-disable-next-line react/immutability
    savedReplacementsRef.current = next;
    apiFetch(`/api/patient-data/${encodeURIComponent(pKey)}/gear/${gear}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifestId: selectedEntry?.id, replacements: next }),
    }).catch(() => {});
  }, [pKey, gear, selectedEntry]);

  const applyMatch = useCallback((match, replacementText, mode) => {
    if (!containerRef.current || !replacementText.trim()) return;
    const text = replacementText.trim();
    applyReplacement(containerRef.current, match.id, text);
    // inputValue/suggestions reset so the row is ready for a fresh pick if
    // the coach wants to change this replacement again later.
    setMatchStates((prev) => ({ ...prev, [match.id]: { ...prev[match.id], status: 'done', replacementText: text, inputValue: '', suggestions: undefined } }));
    persistReplacement({
      id: match.id,
      originalText: match.text,
      matchedTerm: match.term,
      source: match.source,
      replacementText: text,
      mode,
      appliedAt: new Date().toISOString(),
    });
  }, [persistReplacement]);

  // Undoes a replacement: puts the original food item exactly as it
  // appeared in the diet plan back in place of whatever was substituted,
  // clears this row back to plain "flagged", and drops the saved entry so
  // the download/print PDF picks the item back up as unmodified too — the
  // opposite of applyMatch above, mirroring it step for step.
  const revertMatch = useCallback((match) => {
    if (!containerRef.current) return;
    revertReplacement(containerRef.current, match.id, match.text, match.source);
    setMatchStates((prev) => ({ ...prev, [match.id]: { status: 'flagged', inputValue: '', replacementText: undefined, suggestions: undefined } }));
    removeSavedReplacement(match.id);
  }, [removeSavedReplacement]);

  const handleAutoSuggest = useCallback(async (match) => {
    // language: when this diet plan is the Tamil-language version, the
    // suggested alternatives are themselves in Tamil so the inserted text
    // reads naturally inside the Tamil chart. Every click asks the server
    // (which asks Gemini) fresh, rather than picking from a fixed local
    // list, so this takes a moment — shown via the 'suggest-loading' status.
    setMatchStates((prev) => ({ ...prev, [match.id]: { ...prev[match.id], status: 'suggest-loading' } }));
    const { items } = await suggestSubstitutes(match.term, dietType, language);
    setMatchStates((prev) => ({ ...prev, [match.id]: { ...prev[match.id], status: 'suggesting', suggestions: items } }));
  }, [dietType, language]);

  const handleInputChange = useCallback((matchId, value) => {
    setMatchStates((prev) => ({ ...prev, [matchId]: { ...prev[matchId], inputValue: value } }));
  }, []);

  return (
    <div className={`panel${fullscreen ? ' panel-fullscreen' : ''}`}>
      <header className="panel-header">
        <div>
          <h2>Gear {gear} Diet Plan</h2>
          <p className="panel-subtitle">{person.name}{person.studentId ? ` · #${person.studentId}` : ''}</p>
        </div>
        <div className="panel-header-actions">
          <button
            className="panel-fullscreen-btn"
            onClick={onToggleFullscreen}
            type="button"
            aria-label={fullscreen ? 'Minimize' : 'Full screen'}
            title={fullscreen ? 'Minimize' : 'Full screen'}
          >
            {fullscreen ? '⤡ Minimize' : '⤢ Full screen'}
          </button>
          <button className="panel-close" onClick={onClose} type="button" aria-label="Close">×</button>
        </div>
      </header>

      <div className="panel-controls">
        <label>
          Condition
          <select value={condition} onChange={(e) => setCondition(e.target.value)}>
            {BASE_CONDITIONS.map((c) => (
              <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={comorbid === 'GASTRIC'}
            onChange={(e) => setComorbid(e.target.checked ? 'GASTRIC' : null)}
          />
          Gastric / Ulcer / Acidity
        </label>
        <label>
          Diet type
          <select value={dietType ?? ''} onChange={(e) => setDietType(e.target.value)} disabled={!dietTypeChoices.length}>
            {dietTypeChoices.map((d) => (
              <option key={d} value={d}>{DIET_LABELS[d]}</option>
            ))}
          </select>
        </label>
        <label>
          Language
          <select value={language ?? ''} onChange={(e) => setLanguage(e.target.value)} disabled={!languageChoices.length}>
            {languageChoices.map((l) => (
              <option key={l} value={l}>{LANGUAGE_LABELS[l]}</option>
            ))}
          </select>
        </label>
        {options.length > 1 && (
          <span className="panel-hint">
            Also detected: {options.slice(1).map((o) => CONDITION_LABELS[o.condition]).join(', ')}
          </span>
        )}
        {savedEntry && selectedEntry?.id === savedEntry.id && (
          <span className="panel-hint">
            ↺ Restored this patient's saved Gear {gear} plan
            {(savedGear.replacements || []).length ? ` — ${savedGear.replacements.length} replacement${savedGear.replacements.length === 1 ? '' : 's'} applied` : ''}.
          </span>
        )}
        {appendEntries.length > 0 && (
          <span className="panel-hint">
            Also showing below: {appendEntries.map((a) => `${GEAR_MEAL_LABELS[a.gear] || `Gear ${a.gear}`} (Gear ${a.gear})`).join(', ')}.
          </span>
        )}
      </div>

      {status === 'ready' && (() => {
        // Keyed off replacementText rather than status === 'done': a match
        // that already has a replacement applied stays "resolved" for this
        // count even while the coach is mid-way through reconsidering it
        // (status briefly becomes 'suggesting' again) — nothing in the
        // document changes until they actually apply a different pick.
        const pending = flagged.found.filter((m) => !matchStates[m.id]?.replacementText);
        const allergyCount = pending.filter((m) => m.source === 'allergy').length;
        const dislikeCount = pending.filter((m) => m.source === 'dislike').length;
        const hasFound = flagged.found.length > 0;
        const hasUnmatched = flagged.unmatched.length > 0;
        if (!hasFound && !hasUnmatched) {
          return (
            <div className="flagged-bar flagged-bar-clear">
              <span>✓ This patient has no allergy or dislike food items on file.</span>
            </div>
          );
        }
        const allClear = pending.length === 0;
        return (
          <>
            {hasFound && (
              <div className={`flagged-bar${allClear ? ' flagged-bar-clear' : ''}`}>
                {allClear ? (
                  <span>✓ No remaining dislike/allergy items flagged in this diet plan.</span>
                ) : (
                  <span>⚠ {allergyCount} allergy · {dislikeCount} dislike match{pending.length === 1 ? '' : 'es'} found in this diet plan.</span>
                )}
                <button type="button" className="flagged-bar-toggle" onClick={() => setShowFlagged((v) => !v)}>
                  {showFlagged ? 'Hide' : 'Review & replace'}
                </button>
              </div>
            )}
            {hasUnmatched && (
              <div className="flagged-bar flagged-bar-warning">
                <span>
                  ⚠ Allergic and dislike food items not found in this diet plan:{' '}
                  {flagged.unmatched.map((u) => `${u.term} (${u.source})`).join(', ')}. Please check manually.
                </span>
              </div>
            )}
          </>
        );
      })()}

      {showFlagged && (
        <div className="flagged-panel">
          {flagged.found.map((match) => {
            const state = matchStates[match.id] || { status: 'flagged', inputValue: '' };
            // A match keeps its Replace/Auto controls even after being
            // applied once, so the coach can change it to a different
            // alternative later — manually or by pressing Auto again.
            const wasApplied = Boolean(state.replacementText);
            return (
              <div key={match.id} className="flagged-item">
                <span className={`flagged-item-source flagged-item-source-${match.source}`}>{match.source}</span>
                <span className="flagged-item-term">“{match.text}”</span>
                {wasApplied && <span className="flagged-item-done">✓ Replaced with “{state.replacementText}”</span>}
                <input
                  type="text"
                  className="flagged-item-input"
                  placeholder={wasApplied ? 'Type a different replacement…' : 'Type a replacement…'}
                  value={state.inputValue}
                  onChange={(e) => handleInputChange(match.id, e.target.value)}
                />
                <button
                  type="button"
                  className="flagged-item-btn"
                  disabled={!state.inputValue.trim()}
                  onClick={() => applyMatch(match, state.inputValue, 'manual')}
                >
                  {wasApplied ? 'Change' : 'Replace'}
                </button>
                {state.status === 'suggest-loading' ? (
                  <span className="flagged-item-suggestions flagged-item-suggestions-loading">Asking AI for alternatives…</span>
                ) : state.status === 'suggesting' ? (
                  <span className="flagged-item-suggestions">
                    <span className="flagged-item-suggestions-label">Pick an alternative:</span>
                    {state.suggestions.map((item) => (
                      <button
                        key={item}
                        type="button"
                        className="flagged-item-suggestion-chip"
                        onClick={() => applyMatch(match, item, 'auto')}
                      >
                        {item}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="flagged-item-btn"
                      onClick={() => handleAutoSuggest(match)}
                      title="Ask again for a fresh set of alternatives"
                    >
                      ↻ Retry
                    </button>
                    <button
                      type="button"
                      className="flagged-item-btn"
                      onClick={() => setMatchStates((prev) => ({ ...prev, [match.id]: { ...prev[match.id], status: wasApplied ? 'done' : 'flagged', suggestions: undefined } }))}
                    >
                      Dismiss
                    </button>
                  </span>
                ) : (
                  <button type="button" className="flagged-item-btn" onClick={() => handleAutoSuggest(match)}>
                    {wasApplied ? 'Auto (see alternatives)' : 'Auto'}
                  </button>
                )}
                {wasApplied && (
                  <button
                    type="button"
                    className="flagged-item-btn flagged-item-btn-revert"
                    onClick={() => revertMatch(match)}
                    title={`Undo this replacement and restore "${match.text}" exactly as it appears in the original diet plan`}
                  >
                    ↺ Revert
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="panel-body-wrap">
        <div className="panel-body" ref={panelBodyRef}>
          {status === 'loading' && <div className="panel-status">Loading diet plan…</div>}
          {status === 'error' && (
            <div className="panel-status panel-error">
              No matching diet plan file found for {CONDITION_LABELS[condition]}
              {comorbid ? ' + Gastric/Ulcer/Acidity' : ''}, Gear {gear}
              {dietType ? `, ${DIET_LABELS[dietType]}` : ''}{language ? `, ${LANGUAGE_LABELS[language]}` : ''}.
              Try a different condition, diet type, or language above.
            </div>
          )}
          <div ref={containerRef} className="docx-container" style={{ display: status === 'ready' ? 'block' : 'none' }} />
          {status === 'ready' && appendEntries.slice(0, appendedRenderedCount).map((a) => (
            <AppendedGearView
              key={a.entry.id}
              entry={a.entry}
              gear={a.gear}
              viewportRef={panelBodyRef}
              onSettled={() => setAppendedRenderedCount((n) => Math.max(n, appendEntries.indexOf(a) + 2))}
            />
          ))}
        </div>

        {status === 'ready' && navTotal > 0 && (
          <div className="nav-arrows">
            <span className="nav-arrows-count">{navPos === -1 ? '–' : navPos + 1} / {navTotal}</span>
            <button
              type="button"
              className="nav-arrow-btn"
              onClick={() => navigate('up')}
              disabled={navPos === 0}
              aria-label="Previous highlighted item"
              title="Previous highlighted item"
            >
              ▲
            </button>
            <button
              type="button"
              className="nav-arrow-btn"
              onClick={() => navigate('down')}
              disabled={navPos === navTotal - 1}
              aria-label="Next highlighted item"
              title="Next highlighted item"
            >
              ▼
            </button>
          </div>
        )}
      </div>

      {selectedEntry && (
        <footer className="panel-footer">
          {!fullscreen && <span className="panel-filename">{selectedEntry.fileName}</span>}
          {fileActionError && <span className="panel-file-error">{fileActionError}</span>}
          {printBusy && <span className="panel-print-busy">{printBusy}</span>}
          {printReady && (
            <span className="panel-print-ready-wrap">
              <span className="panel-print-ready">
                PDF ready —
                <button type="button" className="panel-download panel-download-primary" onClick={handlePrintNow}>
                  🖨 Click to print / save as PDF
                </button>
              </span>
              <span className="panel-print-tip">
                In the dialog, turn off “Headers and footers” (under More settings) so the filename and date/time aren't printed on every page.
              </span>
            </span>
          )}
          <span className="panel-footer-actions">
            <button
              type="button"
              onClick={handleOpenOriginal}
              className="panel-download"
              disabled={!!printBusy}
              title={`Open the unmodified ${chainLabel} plan as a PDF — no allergy or dislike replacements applied`}
            >
              Open original file
            </button>
            <button
              type="button"
              onClick={handleDownloadForPatient}
              className="panel-download panel-download-primary"
              disabled={!!printBusy}
              title={`Save this patient's ${chainLabel} plan as a PDF, with their replacements applied`}
            >
              ⬇ Download PDF
            </button>
          </span>
        </footer>
      )}
    </div>
  );
}

export default DietViewerPanel;
