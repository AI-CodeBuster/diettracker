// "Patient Details Edit" sidebar page (developer-only -- see Sidebar.jsx;
// enforced server-side too, see server/index.js's PUT /api/patient-detail-
// fields requireTL gate). Each of the three sections below -- Personal
// Details / Diet & Other Preference / Clinical Details -- mirrors one of
// PatientCoverPage.jsx's own cover-page tables: drag a field to reorder it,
// click its x to drop it, or "+ Add field" to bring back one that isn't
// shown. A field's own value always comes from the patient's existing
// record (sheet data or a computed value like BMI/IBW) -- this page only
// controls whether and where that row shows, never where its data comes
// from, which is why there's no "add a custom field" input, only a curated
// order over each section's fixed catalog. Saving here changes what every
// coach/TL sees on every patient's plan immediately.
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiFetch';
import {
  PERSONAL_DETAIL_FIELD_LABELS,
  DIET_PREFERENCE_FIELD_LABELS,
  CLINICAL_DETAIL_FIELD_LABELS,
} from './PatientCoverPage';

const CATEGORIES = [
  { key: 'personal', title: 'Personal Details', labels: PERSONAL_DETAIL_FIELD_LABELS },
  { key: 'dietPreference', title: 'Diet & Other Preference', labels: DIET_PREFERENCE_FIELD_LABELS },
  { key: 'clinicalDetails', title: 'Clinical Details', labels: CLINICAL_DETAIL_FIELD_LABELS },
];
const EMPTY_FIELDS = { personal: [], dietPreference: [], clinicalDetails: [] };

function PatientDetailFieldsPage() {
  const [allFieldKeys, setAllFieldKeys] = useState(EMPTY_FIELDS);
  const [active, setActive] = useState(EMPTY_FIELDS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [openAddMenu, setOpenAddMenu] = useState(null);
  const [dragging, setDragging] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch('/api/patient-detail-fields', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setAllFieldKeys(data.allFieldKeys || EMPTY_FIELDS);
        setActive(data.fields || EMPTY_FIELDS);
      })
      .catch((err) => setError(String(err.message || err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addField = (category, key) => {
    setSavedAt(null);
    setActive((prev) => ({ ...prev, [category]: [...prev[category], key] }));
    setOpenAddMenu(null);
  };

  const removeField = (category, key) => {
    setSavedAt(null);
    setActive((prev) => ({ ...prev, [category]: prev[category].filter((k) => k !== key) }));
  };

  const handleDragStart = (category, index) => (e) => {
    setDragging({ category, index });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (category, index) => (e) => {
    e.preventDefault();
    if (!dragging || dragging.category !== category || dragging.index === index) return;
    setSavedAt(null);
    setActive((prev) => {
      const list = prev[category].slice();
      const moved = list.splice(dragging.index, 1)[0];
      list.splice(index, 0, moved);
      return { ...prev, [category]: list };
    });
    setDragging({ category, index });
  };

  const handleDragEnd = () => setDragging(null);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch('/api/patient-detail-fields', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save');
      setActive(data.fields);
      setSavedAt(new Date());
    } catch (err) {
      setSaveError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  const canSave = !saving && CATEGORIES.every(({ key }) => active[key] && active[key].length > 0);

  return (
    <div className="issues-page">
      <div className="issues-header">
        <div>
          <h1>Patient Details Edit</h1>
          <p className="issues-subtitle">
            Drag to reorder, click a field's x to remove it, or "+ Add field" to bring one back --
            for each of the three tables on every diet plan's cover page. Saving here applies to
            every patient's plan immediately.
          </p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading && <div className="loading-banner">Loading…</div>}

      {!loading && !error && (
        <>
          {openAddMenu && <div className="patient-fields-backdrop" onClick={() => setOpenAddMenu(null)} />}

          {CATEGORIES.map(({ key, title, labels }) => {
            const activeKeys = active[key] || [];
            const availableKeys = (allFieldKeys[key] || []).filter((k) => !activeKeys.includes(k));
            return (
              <div className="patient-fields-section" key={key}>
                <div className="patient-fields-section-header">
                  <h2>{title}</h2>
                  <div className="patient-fields-add-wrap">
                    <button
                      type="button"
                      className="patient-fields-add-btn"
                      onClick={() => setOpenAddMenu(openAddMenu === key ? null : key)}
                    >
                      + Add field
                    </button>
                    {openAddMenu === key && (
                      <div className="patient-fields-add-menu">
                        {availableKeys.length === 0 ? (
                          <div className="patient-fields-add-menu-empty">All fields added</div>
                        ) : (
                          availableKeys.map((k) => (
                            <button
                              type="button"
                              key={k}
                              className="patient-fields-add-menu-item"
                              onClick={() => addField(key, k)}
                            >
                              {labels[k] || k}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="patient-fields-active-list">
                  {activeKeys.map((fieldKey, index) => (
                    <div
                      key={fieldKey}
                      className={
                        dragging && dragging.category === key && dragging.index === index
                          ? 'patient-fields-active-item patient-fields-active-item-dragging'
                          : 'patient-fields-active-item'
                      }
                      draggable
                      onDragStart={handleDragStart(key, index)}
                      onDragOver={handleDragOver(key, index)}
                      onDragEnd={handleDragEnd}
                    >
                      <span className="patient-fields-drag-handle" aria-hidden="true">⠿</span>
                      <span className="patient-fields-active-label">{labels[fieldKey] || fieldKey}</span>
                      <button
                        type="button"
                        className="patient-fields-remove-btn"
                        aria-label={'Remove ' + (labels[fieldKey] || fieldKey)}
                        onClick={() => removeField(key, fieldKey)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {!activeKeys.length && (
                    <div className="patient-fields-empty">No fields — add at least one below.</div>
                  )}
                </div>
              </div>
            );
          })}

          {saveError && <div className="error-banner">{saveError}</div>}

          <div className="patient-fields-actions">
            <button type="button" className="issues-raise-btn" disabled={!canSave} onClick={handleSave}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {!canSave && !saving && <span className="modal-hint">Every section needs at least one field.</span>}
            {savedAt && !saving && <span className="patient-fields-saved">Saved — every diet plan now reflects this.</span>}
          </div>
        </>
      )}
    </div>
  );
}

export default PatientDetailFieldsPage;
