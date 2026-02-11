import { putEntry, deleteEntry, getAllEntries, getEntry, bulkUpsert } from "./db.js";

const SCHEMA_VERSION = 2;
const DRAFT_KEY = "tt_draft_v2";

const $ = (id) => document.getElementById(id);

function uuid() {
  // RFC4122-ish, good enough for local IDs
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function pad2(n){ return String(n).padStart(2,"0"); }

function toLocalISOString(d = new Date()){
  const tz = -d.getTimezoneOffset(); // minutes east of UTC
  const sign = tz >= 0 ? "+" : "-";
  const ah = Math.floor(Math.abs(tz) / 60);
  const am = Math.abs(tz) % 60;
  // shift so that toISOString gives local wall time
  const shifted = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  const base = shifted.toISOString().slice(0,19);
  return `${base}${sign}${pad2(ah)}:${pad2(am)}`;
}

function parseLocalDateTime(dateStr, timeStr){
  // dateStr: YYYY-MM-DD, timeStr: HH:MM
  if (!dateStr || !timeStr) return null;
  const [y,m,day] = dateStr.split("-").map(Number);
  const [hh,mm] = timeStr.split(":").map(Number);
  const d = new Date(y, m-1, day, hh, mm, 0, 0);
  return toLocalISOString(d);
}

function minutesBetween(takenAt, endAt){
  if (!takenAt || !endAt) return null;
  const a = new Date(takenAt);
  const b = new Date(endAt);
  const diffMs = b - a;
  if (!Number.isFinite(diffMs)) return null;
  return Math.round(diffMs / 60000);
}

function humanDate(iso){
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", { weekday:"short", day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
}

function clampInt(n, min, max){
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.round(x)));
}

function getSelectedEffects(){
  return Array.from(document.querySelectorAll(".fx:checked")).map(x => x.value);
}

function setSelectedEffects(arr){
  const set = new Set(arr || []);
  document.querySelectorAll(".fx").forEach(cb => cb.checked = set.has(cb.value));
}

function loadDraft(){
  try{
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch{ return null; }
}

function saveDraft(draft){
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

function clearDraft(){
  localStorage.removeItem(DRAFT_KEY);
}

function initDate(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth()+1);
  const dd = pad2(d.getDate());
  $("date").value = `${yyyy}-${mm}-${dd}`;
}

function setStatus(msg){
  $("liveStatus").textContent = msg || "";
}

function readCommonFields(){
  return {
    medication: $("medication").value.trim(),
    doseMg: Number($("doseMg").value || 0),
    form: $("form").value,
    benefit: clampInt($("benefit").value, 0, 10),
    crash: clampInt($("crash").value, 0, 10),
    sideEffects: getSelectedEffects(),
    notes: $("notes").value.trim()
  };
}

function applyCommonFields(obj){
  $("medication").value = obj.medication || "";
  $("doseMg").value = (obj.doseMg ?? "");
  $("form").value = obj.form || "unknown";
  $("benefit").value = clampInt(obj.benefit ?? 0, 0, 10);
  $("crash").value = clampInt(obj.crash ?? 0, 0, 10);
  $("benefitVal").textContent = String($("benefit").value);
  $("crashVal").textContent = String($("crash").value);
  setSelectedEffects(obj.sideEffects || []);
  $("notes").value = obj.notes || "";
}

async function renderHistory(){
  const entries = await getAllEntries();
  const root = $("history");
  if (!entries.length){
    root.innerHTML = `<div class="small">Aucune entrée pour l’instant.</div>`;
    return;
  }

  root.innerHTML = entries.map(e => {
    const dur = e.durationMin != null ? `${Math.round(e.durationMin/6)/10} h` : "—";
    const title = `${e.medication || "Médicament"} · ${e.doseMg ?? "—"} mg`;
    const sub = `Prise: ${humanDate(e.takenAt)}${e.endAt ? ` · Fin: ${humanDate(e.endAt)}` : ""}`;
    const tags = [
      e.form && e.form !== "unknown" ? `Forme: ${e.form}` : null,
      e.durationMin != null ? `Durée: ${dur}` : null,
      `Bénéfice: ${e.benefit ?? "—"}/10`,
      `Crash: ${e.crash ?? "—"}/10`,
      (e.sideEffects?.length ? `Effets: ${e.sideEffects.length}` : null)
    ].filter(Boolean).map(t => `<span class="tag">${t}</span>`).join("");

    return `
      <div class="hist-item">
        <div class="hist-top">
          <div>
            <div class="hist-title">${escapeHtml(title)}</div>
            <div class="hist-sub">${escapeHtml(sub)}</div>
          </div>
          <div class="tag">${escapeHtml(formatEntryMode(e.entryMode))}</div>
        </div>
        <div class="hist-metrics">${tags}</div>
        <div class="hist-actions">
          <button class="secondary" data-action="edit" data-id="${e.id}">Modifier</button>
          <button class="danger" data-action="delete" data-id="${e.id}">Supprimer</button>
        </div>
      </div>
    `;
  }).join("");

  root.querySelectorAll("button[data-action]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === "delete"){
        if (confirm("Supprimer cette entrée ?")){
          await deleteEntry(id);
          await renderHistory();
        }
      } else if (action === "edit"){
        const entry = await getEntry(id);
        if (entry) openEditModal(entry);
      }
    });
  });
}

function formatEntryMode(mode){
  if (mode === "now_buttons") return "Auto";
  if (mode === "manual") return "Rattrapage";
  return "—";
}

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}

function getDraftOrNew(){
  return loadDraft() || {
    schemaVersion: SCHEMA_VERSION,
    id: uuid(),
    takenAt: null,
    endAt: null,
    entryMode: null,
    medication: "",
    doseMg: null,
    form: "unknown",
    benefit: 0,
    crash: 0,
    sideEffects: [],
    notes: ""
  };
}

function updateDraftUI(draft){
  applyCommonFields(draft);
  if (draft.takenAt && !draft.endAt){
    setStatus(`Prise enregistrée: ${humanDate(draft.takenAt)} · En attente de fin d’effet…`);
  } else if (draft.takenAt && draft.endAt){
    const mins = minutesBetween(draft.takenAt, draft.endAt);
    const h = mins != null ? `${Math.round(mins/6)/10} h` : "—";
    setStatus(`Durée calculée: ${h} · Finalise pour enregistrer.`);
  } else {
    setStatus("");
  }
  $("btnEndNow").disabled = !draft.takenAt || !!draft.endAt;
  $("btnFinalize").disabled = !draft.takenAt;
}

async function finalizeDraft(){
  const draft = getDraftOrNew();
  const common = readCommonFields();
  const entry = {
    ...draft,
    ...common,
    schemaVersion: SCHEMA_VERSION,
    durationMin: (draft.takenAt && draft.endAt) ? minutesBetween(draft.takenAt, draft.endAt) : null,
  };

  // Minimal validation: medication/dose can be empty if you want, but warn.
  if (!entry.medication){
    if (!confirm("Médicament vide. Enregistrer quand même ?")) return;
  }
  if (!entry.doseMg && entry.doseMg !== 0){
    if (!confirm("Dose vide. Enregistrer quand même ?")) return;
  }

  await putEntry(entry);
  clearDraft();
  updateDraftUI(getDraftOrNew());
  await renderHistory();
  setStatus("Entrée enregistrée.");
}

function openEditModal(entry){
  const modal = $("modal");
  const body = $("modalBody");
  body.className = "modal-body";
  body.innerHTML = `
    <div class="grid2">
      <div class="form-group">
        <label>Médicament</label>
        <input id="m_medication" type="text" value="${escapeHtml(entry.medication || "")}" />
      </div>
      <div class="form-group">
        <label>Dose (mg)</label>
        <input id="m_doseMg" type="number" step="0.5" value="${entry.doseMg ?? ""}" />
      </div>
    </div>

    <div class="grid2">
      <div class="form-group">
        <label>Forme</label>
        <select id="m_form">
          <option value="unknown">Non précisée</option>
          <option value="IR">IR</option>
          <option value="LP">LP</option>
        </select>
      </div>
      <div class="form-group">
        <label>Mode</label>
        <input type="text" value="${escapeHtml(formatEntryMode(entry.entryMode))}" disabled />
      </div>
    </div>

    <div class="grid2">
      <div class="form-group">
        <label>Prise (ISO)</label>
        <input id="m_takenAt" type="text" value="${escapeHtml(entry.takenAt || "")}" />
      </div>
      <div class="form-group">
        <label>Fin (ISO)</label>
        <input id="m_endAt" type="text" value="${escapeHtml(entry.endAt || "")}" />
      </div>
    </div>

    <div class="grid2">
      <div class="form-group">
        <label>Efficacité (0–10)</label>
        <input id="m_benefit" type="number" min="0" max="10" value="${clampInt(entry.benefit ?? 0,0,10)}" />
      </div>
      <div class="form-group">
        <label>Crash (0–10)</label>
        <input id="m_crash" type="number" min="0" max="10" value="${clampInt(entry.crash ?? 0,0,10)}" />
      </div>
    </div>

    <div class="form-group">
      <label>Effets (codes séparés par virgules)</label>
      <input id="m_fx" type="text" value="${escapeHtml((entry.sideEffects || []).join(","))}" placeholder="appetite_low,anxiety_irritability" />
    </div>

    <div class="form-group">
      <label>Notes</label>
      <textarea id="m_notes" rows="3">${escapeHtml(entry.notes || "")}</textarea>
    </div>

    <div class="actions">
      <button id="m_save" class="primary">Enregistrer</button>
      <button id="m_cancel" class="secondary">Annuler</button>
    </div>

    <div class="small">
      Astuce: si tu veux une UI “date/heure” pour l’édition, on la fera ensuite. Là c’est le P0 robuste.
    </div>
  `;
  body.querySelector("#m_form").value = entry.form || "unknown";

  modal.classList.remove("hidden");

  const close = () => modal.classList.add("hidden");
  $("modalClose").onclick = close;
  body.querySelector("#m_cancel").onclick = close;

  body.querySelector("#m_save").onclick = async () => {
    const updated = {
      ...entry,
      medication: body.querySelector("#m_medication").value.trim(),
      doseMg: Number(body.querySelector("#m_doseMg").value || 0),
      form: body.querySelector("#m_form").value,
      takenAt: body.querySelector("#m_takenAt").value.trim() || null,
      endAt: body.querySelector("#m_endAt").value.trim() || null,
      benefit: clampInt(body.querySelector("#m_benefit").value, 0, 10),
      crash: clampInt(body.querySelector("#m_crash").value, 0, 10),
      sideEffects: (body.querySelector("#m_fx").value || "").split(",").map(s => s.trim()).filter(Boolean),
      notes: body.querySelector("#m_notes").value.trim()
    };
    updated.durationMin = (updated.takenAt && updated.endAt) ? minutesBetween(updated.takenAt, updated.endAt) : null;
    await putEntry(updated);
    close();
    await renderHistory();
  };
}

function downloadBlob(filename, mime, content){
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportJSON(){
  const entries = await getAllEntries();
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: toLocalISOString(),
    entries
  };
  downloadBlob(`titration-tracker-backup-${new Date().toISOString().slice(0,10)}.json`, "application/json", JSON.stringify(payload, null, 2));
}

function csvEscape(v){
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}

async function exportCSV(){
  const entries = await getAllEntries();
  const header = ["id","takenAt","endAt","durationMin","medication","doseMg","form","benefit","crash","sideEffects","notes","entryMode","schemaVersion"];
  const rows = entries.map(e => header.map(k => {
    const v = (k === "sideEffects") ? (e.sideEffects || []).join("|") : e[k];
    return csvEscape(v);
  }).join(","));
  const csv = [header.join(","), ...rows].join("\n");
  downloadBlob(`titration-tracker-${new Date().toISOString().slice(0,10)}.csv`, "text/csv", csv);
}

async function exportPrintReport(){
  const entries = await getAllEntries();
  const html = buildPrintableReport(entries);
  const w = window.open("", "_blank");
  if (!w){
    alert("Impossible d’ouvrir la fenêtre d’impression (pop-up bloquée). Autorise les pop-ups et réessaie.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  // Give the browser a tick to layout
  setTimeout(() => w.print(), 250);
}

function median(arr){
  const xs = arr.filter(x => Number.isFinite(x)).slice().sort((a,b)=>a-b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length/2);
  return xs.length % 2 ? xs[mid] : (xs[mid-1]+xs[mid])/2;
}

function groupByDose(entries){
  const map = new Map();
  for (const e of entries){
    const key = `${e.medication || ""}__${e.doseMg ?? ""}__${e.form || "unknown"}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  }
  return map;
}

function buildPrintableReport(entries){
  const rows = entries.slice().sort((a,b) => (a.takenAt || "").localeCompare(b.takenAt || ""));
  const groups = groupByDose(rows);

  const summaryRows = Array.from(groups.entries()).map(([key, es]) => {
    const [med, dose, form] = key.split("__");
    const durs = es.map(x => x.durationMin);
    const bens = es.map(x => x.benefit);
    const cra = es.map(x => x.crash);
    const mdur = median(durs);
    return {
      med: med || "—",
      dose: dose || "—",
      form: form && form !== "unknown" ? form : "—",
      n: es.length,
      durH: mdur != null ? (Math.round((mdur/60)*10)/10) : null,
      ben: median(bens),
      crash: median(cra)
    };
  }).sort((a,b) => (a.med+a.dose).localeCompare(b.med+b.dose));

  const now = new Date();
  const title = "Rapport de titration (auto-suivi)";
  const disclaimer = "Outil de suivi personnel. Ne remplace pas un avis médical.";

  const tableRows = rows.map(e => {
    const dur = e.durationMin != null ? `${Math.round(e.durationMin/6)/10} h` : "—";
    const fx = (e.sideEffects || []).join(", ");
    return `
      <tr>
        <td>${escapeHtml(humanDate(e.takenAt))}</td>
        <td>${escapeHtml(e.medication || "—")}</td>
        <td>${escapeHtml(String(e.doseMg ?? "—"))}</td>
        <td>${escapeHtml(e.form && e.form !== "unknown" ? e.form : "—")}</td>
        <td>${escapeHtml(dur)}</td>
        <td>${escapeHtml(String(e.benefit ?? "—"))}</td>
        <td>${escapeHtml(String(e.crash ?? "—"))}</td>
        <td>${escapeHtml(fx || "—")}</td>
        <td>${escapeHtml(e.notes || "—")}</td>
      </tr>
    `;
  }).join("");

  const summaryTable = summaryRows.map(s => `
    <tr>
      <td>${escapeHtml(s.med)}</td>
      <td>${escapeHtml(String(s.dose))}</td>
      <td>${escapeHtml(s.form)}</td>
      <td>${escapeHtml(String(s.n))}</td>
      <td>${escapeHtml(s.durH != null ? `${s.durH} h` : "—")}</td>
      <td>${escapeHtml(s.ben != null ? String(Math.round(s.ben*10)/10) : "—")}</td>
      <td>${escapeHtml(s.crash != null ? String(Math.round(s.crash*10)/10) : "—")}</td>
    </tr>
  `).join("");

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:18px;}
  h1{margin:0 0 6px 0;font-size:18px;}
  .meta{color:#475569;font-size:12px;margin-bottom:10px;}
  .box{border:1px solid #e2e8f0;border-radius:12px;padding:12px;margin:12px 0;}
  table{width:100%;border-collapse:collapse;font-size:11px;}
  th,td{border-bottom:1px solid #e2e8f0;padding:6px 6px;vertical-align:top;}
  th{background:#f8fafc;text-align:left;font-size:11px;}
  .small{color:#64748b;font-size:11px;margin-top:10px;}
  @media print{ body{margin:0;} .noprint{display:none;} }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">Généré le ${escapeHtml(now.toLocaleString("fr-FR"))}</div>
  <div class="box">
    <strong>Synthèse par dose (médianes)</strong>
    <table>
      <thead><tr><th>Médicament</th><th>Dose (mg)</th><th>Forme</th><th>N</th><th>Durée (h)</th><th>Bénéfice</th><th>Crash</th></tr></thead>
      <tbody>${summaryTable || "<tr><td colspan='7'>—</td></tr>"}</tbody>
    </table>
  </div>

  <div class="box">
    <strong>Chronologie</strong>
    <table>
      <thead>
        <tr>
          <th>Date/heure</th><th>Médicament</th><th>Dose</th><th>Forme</th><th>Durée</th><th>Bénéfice</th><th>Crash</th><th>Effets</th><th>Notes</th>
        </tr>
      </thead>
      <tbody>${tableRows || "<tr><td colspan='9'>—</td></tr>"}</tbody>
    </table>
  </div>

  <div class="small">${escapeHtml(disclaimer)}</div>
</body>
</html>`;
}

async function importJSON(file){
  const txt = await file.text();
  let data;
  try{ data = JSON.parse(txt); }catch{
    alert("JSON invalide.");
    return;
  }
  if (!data || !Array.isArray(data.entries)){
    alert("Format inattendu (attendu: { entries: [...] }).");
    return;
  }
  // minimal sanitation: ensure ids exist
  const cleaned = data.entries.map(e => ({
    schemaVersion: e.schemaVersion ?? SCHEMA_VERSION,
    id: e.id || uuid(),
    takenAt: e.takenAt || null,
    endAt: e.endAt || null,
    durationMin: e.durationMin ?? ((e.takenAt && e.endAt) ? minutesBetween(e.takenAt, e.endAt) : null),
    entryMode: e.entryMode || "manual",
    medication: e.medication || "",
    doseMg: Number(e.doseMg || 0),
    form: e.form || "unknown",
    benefit: clampInt(e.benefit ?? 0, 0, 10),
    crash: clampInt(e.crash ?? 0, 0, 10),
    sideEffects: Array.isArray(e.sideEffects) ? e.sideEffects : [],
    notes: e.notes || ""
  }));
  await bulkUpsert(cleaned);
  await renderHistory();
  alert(`Import terminé: ${cleaned.length} entrées.`);
}

function initSliders(){
  const update = () => {
    $("benefitVal").textContent = String($("benefit").value);
    $("crashVal").textContent = String($("crash").value);
  };
  $("benefit").addEventListener("input", update);
  $("crash").addEventListener("input", update);
  update();
}

function registerSW(){
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", async () => {
    try{
      await navigator.serviceWorker.register("./sw.js");
    }catch(e){
      // silent; offline still works in browser
      console.warn("SW registration failed", e);
    }
  });
}

function wireActions(){
  $("btnTakeNow").addEventListener("click", () => {
    const draft = getDraftOrNew();
    const common = readCommonFields();
    if (draft.takenAt){
      if (!confirm("Une prise est déjà enregistrée dans le brouillon. Remplacer ?")) return;
    }
    const updated = {
      ...draft,
      ...common,
      schemaVersion: SCHEMA_VERSION,
      id: draft.id || uuid(),
      takenAt: toLocalISOString(new Date()),
      endAt: null,
      entryMode: "now_buttons"
    };
    saveDraft(updated);
    updateDraftUI(updated);
  });

  $("btnEndNow").addEventListener("click", () => {
    const draft = getDraftOrNew();
    if (!draft.takenAt){
      alert("Enregistre d’abord la prise.");
      return;
    }
    const updated = {
      ...draft,
      endAt: toLocalISOString(new Date()),
      entryMode: draft.entryMode || "now_buttons"
    };
    saveDraft(updated);
    updateDraftUI(updated);
  });

  $("btnSaveManual").addEventListener("click", async () => {
    const dateStr = $("date").value;
    const takeT = $("takeTime").value;
    const endT = $("endTime").value;
    if (!dateStr || !takeT){
      alert("Renseigne au moins la date et l’heure de prise.");
      return;
    }
    let takenAt = parseLocalDateTime(dateStr, takeT);
    let endAt = endT ? parseLocalDateTime(dateStr, endT) : null;

    // If end time earlier than take time, assume next day
    if (takenAt && endAt){
      const a = new Date(takenAt);
      const b = new Date(endAt);
      if (b < a){
        const b2 = new Date(b.getTime() + 24*60*60000);
        endAt = toLocalISOString(b2);
      }
    }

    const common = readCommonFields();
    const entry = {
      schemaVersion: SCHEMA_VERSION,
      id: uuid(),
      takenAt,
      endAt,
      durationMin: (takenAt && endAt) ? minutesBetween(takenAt, endAt) : null,
      entryMode: "manual",
      ...common
    };

    await putEntry(entry);
    await renderHistory();
    setStatus("Entrée (rattrapage) enregistrée.");
  });

  $("btnFinalize").addEventListener("click", finalizeDraft);

  $("btnClearDraft").addEventListener("click", () => {
    if (confirm("Effacer le brouillon (prise non finalisée) ?")){
      clearDraft();
      updateDraftUI(getDraftOrNew());
      setStatus("Brouillon effacé.");
    }
  });

  $("btnExportJSON").addEventListener("click", exportJSON);
  $("btnExportCSV").addEventListener("click", exportCSV);
  $("btnExportPDF").addEventListener("click", exportPrintReport);

  $("btnImport").addEventListener("click", async () => {
    const input = $("importFile");
    if (!input.files || !input.files[0]){
      alert("Choisis un fichier JSON.");
      return;
    }
    await importJSON(input.files[0]);
    input.value = "";
  });

  $("modal").addEventListener("click", (e) => {
    if (e.target === $("modal")) $("modal").classList.add("hidden");
  });
}

async function boot(){
  initDate();
  initSliders();
  registerSW();

  const draft = getDraftOrNew();
  updateDraftUI(draft);
  await renderHistory();

  // restore any draft fields (except timestamps which are stored too)
  const stored = loadDraft();
  if (stored) updateDraftUI(stored);

  wireActions();
}

boot();
