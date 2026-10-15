import React, { useEffect, useRef, useState } from "react";
import { C, EASE, Tap, inputStyle, notice, card, choice, SectionLabel, CardGrid, SP, NumField, PAGE_PAD } from "./ui.jsx";
import {
  MAX_PDF_BYTES, MAX_REQUEST_BYTES, MAX_FILES, mimeTypeOf, draftFromPdf, draftChapters, draftIssues, subjectFromDraft,
} from "./engine/pdfPortions.js";
import { TYPE_META, PACE, key, toDate } from "./engine/plan.js";

/* ------------------------------------------------------------------ */
/*  Import from PDF: a school's portions document covers every subject, */
/*  so it adds several subjects at once. Upload → reading → tick the    */
/*  subjects you take → check each one → save them all.                 */
/* ------------------------------------------------------------------ */

const fmtDate = (d) => toDate(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export const ACCEPT = "application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png,image/heic,.heic,image/heif,.heif,image/webp,.webp";

/* Is this file one we can send? null when it is, else a message to show. */
export function fileProblem(file) {
  if (!mimeTypeOf(file.name, file.type)) return `${file.name} isn't a PDF or a photo. Use a PDF, JPG, PNG, HEIC or WebP file.`;
  if (file.size > MAX_PDF_BYTES) return `${file.name} is over 5 MB. Try a smaller file, or a lower-resolution photo.`;
  return null;
}

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).replace(/^data:[^;]+;base64,/, ""));
  r.onerror = () => reject(new Error("That file couldn't be opened. Try again, or add your subjects by hand instead."));
  r.readAsDataURL(blob);
});

/* Photos straight off a phone are often 3–5 MB, and everything has to go in
   one request of about 3 MB. So a photo is redrawn at most 2000px on its
   longest side, as a JPEG: plenty for reading text. A photo this browser
   can't open (HEIC outside Safari) goes as it is. PDFs are never touched. */
async function shrinkPhoto(file, mimeType) {
  if (mimeType === "application/pdf" || typeof createImageBitmap !== "function") return null;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size <= 600 * 1024) return null;   // already small
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? { blob, mimeType: "image/jpeg" } : null;
  } catch {
    return null;
  }
}

/* Send a PDF or up to 5 photos to the server (api/parse-portions.js), in
   order, in one request. Resolves to [{ name, examDate, chapters }];
   rejects with an Error whose message can be shown as it is. */
export async function readPortions(files) {
  if (!files.length) throw new Error("No file was chosen.");
  for (const f of files) { const p = fileProblem(f); if (p) throw new Error(p); }
  const parts = [];
  for (const f of files) {
    const type = mimeTypeOf(f.name, f.type);
    const small = await shrinkPhoto(f, type);
    parts.push({ data: await toBase64(small?.blob ?? f), mimeType: small?.mimeType ?? type });
  }
  const body = JSON.stringify({ files: parts });
  if (body.length > MAX_REQUEST_BYTES) {
    throw new Error("Those files are too big to send together (the limit is about 3 MB in all). Try fewer photos or a smaller PDF, or add your subjects by hand instead.");
  }
  let res;
  try {
    res = await fetch("/api/parse-portions", { method: "POST", headers: { "Content-Type": "application/json" }, body });
  } catch {
    throw new Error("Couldn't reach the PDF reader. Check your connection, or add your subjects by hand instead.");
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON: no function here, or the host refused it */ }
  if (!res.ok || !Array.isArray(data?.subjects)) {
    if (data?.error) throw new Error(data.error);
    if (res.status === 413) throw new Error("Those files are too big to send together (the limit is about 3 MB in all). Try fewer photos or a smaller PDF, or add your subjects by hand instead.");
    throw new Error("Importing isn't available here. Add your subjects by hand instead.");
  }
  return data.subjects;
}

const primary = { width: "100%", background: C.accent, color: C.onAccent, padding: "16px 0", borderRadius: 14, fontSize: 16, fontWeight: 650 };
const secondary = { width: "100%", background: "transparent", border: `1px solid ${C.line}`, color: C.text, padding: "14px 0", borderRadius: 14, fontSize: 14.5, fontWeight: 600 };
const textLink = { background: "none", color: C.accentText, padding: 0, fontSize: 16, fontWeight: 500 };
const small = { display: "block", fontSize: 12.5, color: C.dim, marginBottom: 6 };
const flag = { fontSize: 12.5, color: C.accentText, fontWeight: 600, marginTop: 6, lineHeight: 1.4 };
const pill = (on) => ({ flex: 1, ...choice(on), borderRadius: 10, padding: "9px 2px", fontSize: 13, fontWeight: 650 });

export default function ImportPdf({ defaultPace, onCancel, onManual, onSave }) {
  const [step, setStep] = useState("upload");     // upload | reading | error | pick | confirm
  const [staged, setStaged] = useState([]);        // [{ id, file, type, url }] in reading order
  const [stageNote, setStageNote] = useState("");  // why a file wasn't added
  const [error, setError] = useState("");
  const [found, setFound] = useState([]);           // what Gemini read, kept for the whole flow
  const [ticked, setTicked] = useState(() => new Set());
  const [drafts, setDrafts] = useState([]);
  const [open, setOpen] = useState(() => new Set()); // drafts with "Edit chapters" open
  const [dragging, setDragging] = useState(false);
  const [tried, setTried] = useState(false);        // Save pressed with something still flagged
  const run = useRef(0);                            // a newer upload or a cancel wins over an older reply

  useEffect(() => { window.scrollTo?.(0, 0); }, [step]);

  /* thumbnails are object URLs: let them go when they're removed or the screen closes */
  const urls = useRef([]);
  useEffect(() => { urls.current = staged.map((x) => x.url).filter(Boolean); }, [staged]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const addFiles = (list) => {
    const next = [...staged];
    const notes = [];
    for (const f of list ?? []) {
      const problem = fileProblem(f);
      if (problem) { notes.push(problem); continue; }
      if (next.length >= MAX_FILES) { notes.push(`Up to ${MAX_FILES} files at a time, so ${f.name} wasn't added.`); continue; }
      const type = mimeTypeOf(f.name, f.type);
      next.push({ id: `${f.name}-${f.size}-${f.lastModified}-${Math.random()}`, file: f, type, url: type.startsWith("image/") ? URL.createObjectURL(f) : null });
    }
    setStaged(next);
    setStageNote(notes.join(" "));
  };
  const removeFile = (id) => {
    const x = staged.find((f) => f.id === id);
    if (x?.url) URL.revokeObjectURL(x.url);
    setStaged(staged.filter((f) => f.id !== id));
    setStageNote("");
  };
  const clearFiles = () => { staged.forEach((x) => x.url && URL.revokeObjectURL(x.url)); setStaged([]); setStageNote(""); };
  const photos = staged.some((x) => x.type !== "application/pdf");
  const sending = staged.length === 1 ? staged[0].file.name : `${staged.length} files`;

  const upload = async () => {
    if (!staged.length) return;
    const id = ++run.current;
    setStep("reading");
    try {
      const subjects = await readPortions(staged.map((x) => x.file));
      if (id !== run.current) return;
      if (!subjects.length) {
        throw new Error(photos
          ? "Couldn't read that clearly — try a sharper photo, or enter it manually."
          : "No subjects or chapters were found in that PDF. Add your subjects by hand instead.");
      }
      setFound(subjects);
      setTicked(new Set());   // the document covers the whole year group, so nothing starts ticked
      setStep("pick");
    } catch (err) {
      if (id !== run.current) return;
      setError(err.message);
      setStep("error");
    }
  };

  const toConfirm = () => {
    const keep = found.filter((s) => ticked.has(s.name));
    // a subject checked earlier keeps its edits when you come back to the list
    setDrafts((prev) => keep.map((s) => prev.find((d) => d.key === s.name) ?? draftFromPdf(s, defaultPace)));
    setOpen(new Set(keep.filter((s) => !s.chapters.length).map((s) => s.name)));
    setTried(false);
    setStep("confirm");
  };

  const edit = (k, changes) => setDrafts((p) => p.map((d) => (d.key === k ? { ...d, ...changes } : d)));
  const issues = drafts.map((d) => draftIssues(d));
  const flagged = issues.filter((x) => Object.keys(x).length).length;

  const save = () => {
    if (flagged) { setTried(true); return; }
    const today = key(new Date());
    const stamp = Date.now();
    onSave(drafts.map((d, i) => subjectFromDraft(d, {
      id: `${d.name.trim().toLowerCase().replace(/\s+/g, "")}${stamp}${i}`, today,
    })));
  };

  const fileInput = (
    <input
      id="portions-pdf"
      type="file"
      multiple
      accept={ACCEPT}
      onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ""; }}
      style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}
    />
  );

  return (
    <div style={{ padding: PAGE_PAD }}>
      <Tap className="focus-ring" onClick={onCancel} style={{ ...textLink, marginBottom: 22 }}>‹ Subjects</Tap>
      <h1 className="rise" style={{ fontSize: 34, fontWeight: 700, letterSpacing: -1, margin: "0 0 6px" }}>Import portions</h1>

      {step === "upload" && (
        <>
          <p className="rise" style={{ color: C.dim, fontSize: 15, lineHeight: 1.55, margin: "0 0 24px", maxWidth: 560 }}>
            Upload a PDF or photos of your school's portions or timetable.
          </p>
          {staged.length < MAX_FILES && (
            <label
              htmlFor="portions-pdf"
              className="rise"
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles([...(e.dataTransfer.files ?? [])]); }}
              style={{
                display: "block", position: "relative", textAlign: "center", cursor: "pointer", maxWidth: 560,
                border: `1.5px dashed ${dragging ? C.accent : C.lineHi}`, borderRadius: 18,
                background: dragging ? C.accentSoft : C.surface, padding: staged.length ? "22px 20px" : "40px 20px",
                transition: `background .2s ${EASE}, border-color .2s ${EASE}`,
              }}
            >
              {fileInput}
              <div style={{ fontSize: 16, fontWeight: 650 }}>{staged.length ? "Add another page" : "Choose a PDF or photos"}</div>
              <div style={{ fontSize: 13, color: C.dim, marginTop: 6 }}>
                Drop them here, or tap to pick · up to {MAX_FILES} files, 5 MB each
              </div>
            </label>
          )}
          {stageNote && <div role="alert" style={{ ...notice, fontSize: 13.5, lineHeight: 1.5, marginTop: 12, maxWidth: 560 }}>{stageNote}</div>}

          {staged.length > 0 && (
            <div style={{ maxWidth: 560, marginTop: 18 }}>
              <div style={{ fontSize: 13, color: C.dim, marginBottom: 10 }}>
                {staged.length > 1 ? "Read in this order. Remove any you don't need." : "Ready to read."}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 10 }}>
                {staged.map((x, i) => (
                  <div key={x.id} data-file={x.file.name} style={{ position: "relative", aspectRatio: "3 / 4", borderRadius: 12, overflow: "hidden", border: `1px solid ${C.line}`, background: C.raised }}>
                    {x.url ? (
                      <img
                        src={x.url}
                        alt={`Page ${i + 1}: ${x.file.name}`}
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", background: C.raised }}
                      />
                    ) : null}
                    {/* under the picture: shows when there's no preview (a PDF, or HEIC this browser can't draw) */}
                    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 8, textAlign: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.dim }}>{x.type === "application/pdf" ? "PDF" : x.type.split("/")[1].toUpperCase()}</span>
                      <span style={{ fontSize: 11, color: C.dim, marginTop: 4, overflowWrap: "anywhere", lineHeight: 1.3 }}>{x.file.name}</span>
                    </div>
                    <span style={{ position: "absolute", left: 6, top: 6, minWidth: 20, height: 20, borderRadius: 99, background: C.surface, color: C.text, fontSize: 11.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow)" }}>{i + 1}</span>
                    <Tap
                      className="focus-ring"
                      aria-label={`Remove ${x.file.name}`}
                      onClick={() => removeFile(x.id)}
                      style={{ position: "absolute", right: 6, top: 6, width: 26, height: 26, borderRadius: 99, background: C.surface, color: C.text, fontSize: 16, lineHeight: 1, padding: 0, boxShadow: "var(--shadow)" }}
                    >
                      ×
                    </Tap>
                  </div>
                ))}
              </div>
              <Tap className="focus-ring" onClick={upload} style={{ ...primary, marginTop: 18 }}>
                {staged.length === 1 ? (photos ? "Read this photo" : "Read this PDF") : `Read ${staged.length} files`}
              </Tap>
            </div>
          )}
          <div style={{ fontSize: 12.5, color: C.dim, marginTop: 14, lineHeight: 1.5, maxWidth: 560 }}>
            Several photos are read together, in order, as one document. You tick the subjects you take and check each one before anything is saved.
          </div>
        </>
      )}

      {step === "reading" && (
        <div aria-live="polite" style={{ marginTop: 24, maxWidth: 560 }}>
          <div style={{ ...card, display: "flex", alignItems: "center", gap: 14 }}>
            <span className="pdf-spin" aria-hidden="true" style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 99, border: `2.5px solid ${C.line}`, borderTopColor: C.accent }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 650 }}>Reading your portions…</div>
              <div style={{ fontSize: 13, color: C.dim, marginTop: 3, overflowWrap: "anywhere" }}>{sending} · this usually takes a few seconds</div>
            </div>
          </div>
          <Tap className="focus-ring" onClick={() => { run.current++; setStep("upload"); }} style={{ ...secondary, marginTop: 14 }}>Cancel</Tap>
        </div>
      )}

      {step === "error" && (
        <div style={{ marginTop: 24, maxWidth: 560 }}>
          <div role="alert" style={{ ...notice, fontSize: 15, lineHeight: 1.55 }}>{error}</div>
          <Tap className="focus-ring" onClick={onManual} style={{ ...primary, marginTop: 16 }}>Add subjects by hand instead</Tap>
          <Tap className="focus-ring" onClick={() => setStep("upload")} style={{ ...secondary, marginTop: 10 }}>Try other files</Tap>
        </div>
      )}

      {step === "pick" && (() => {
        const n = found.length;
        const timetableOnly = found.every((s) => s.chapters.length === 0);
        const count = ticked.size;
        return (
          <div style={{ marginTop: 18 }}>
            {timetableOnly && (
              <div role="alert" style={{ ...notice, fontSize: 14, lineHeight: 1.5, marginBottom: 16, maxWidth: 720 }}>
                Found subjects but no chapter lists — your document may only be a timetable. You can still use its exam dates and add the chapters yourself, or add your subjects by hand.
                <Tap className="focus-ring" onClick={onManual} style={{ ...secondary, background: C.surface, marginTop: 12 }}>Add subjects by hand instead</Tap>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
              <div style={{ fontSize: 17, fontWeight: 650 }}>Found {n} subject{n === 1 ? "" : "s"}. Tick the ones you take.</div>
              <div style={{ display: "flex", gap: 16 }}>
                <Tap className="focus-ring" onClick={() => setTicked(new Set(found.map((s) => s.name)))} style={{ ...textLink, fontSize: 14, fontWeight: 600 }}>Select all</Tap>
                <Tap className="focus-ring" onClick={() => setTicked(new Set())} style={{ ...textLink, fontSize: 14, fontWeight: 600 }}>Clear</Tap>
              </div>
            </div>
            <CardGrid>
              {found.map((s) => {
                const on = ticked.has(s.name);
                return (
                  <Tap
                    key={s.name}
                    role="checkbox"
                    aria-checked={on}
                    className="focus-ring card"
                    onClick={() => setTicked((p) => { const x = new Set(p); if (x.has(s.name)) x.delete(s.name); else x.add(s.name); return x; })}
                    style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 13, background: C.surface, border: `1px solid ${on ? C.accent : C.line}`, borderRadius: 14, padding: "14px 16px", color: C.text }}
                  >
                    <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, border: `1.5px solid ${on ? C.accent : C.lineHi}`, background: on ? C.accent : "transparent", color: C.onAccent, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", transition: `all .2s ${EASE}` }}>
                      {on ? "✓" : ""}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 15, fontWeight: 600, overflowWrap: "anywhere" }}>{s.name}</span>
                      <span style={{ display: "block", fontSize: 12.5, color: C.dim, marginTop: 2 }}>
                        {s.chapters.length ? `${s.chapters.length} chapter${s.chapters.length === 1 ? "" : "s"}` : "No chapters listed"}
                        {s.examDate && ` · Exam ${fmtDate(s.examDate)}`}
                      </span>
                    </span>
                  </Tap>
                );
              })}
            </CardGrid>
            <div style={{ maxWidth: 560, marginTop: SP.section }}>
              <Tap className="focus-ring" disabled={!count} onClick={toConfirm} style={primary}>
                {count ? `Continue with ${count} subject${count === 1 ? "" : "s"}` : "Tick at least one subject"}
              </Tap>
              <Tap className="focus-ring" onClick={() => { clearFiles(); setStep("upload"); }} style={{ ...secondary, marginTop: 10 }}>
                Choose different files
              </Tap>
            </div>
          </div>
        );
      })()}

      {step === "confirm" && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 17, fontWeight: 650 }}>Check each subject</div>
          <div style={{ fontSize: 13.5, color: C.dim, marginTop: 4, lineHeight: 1.5 }}>
            Only what the PDF can't tell us. The defaults are fine to keep if you're not sure.
          </div>
          <div role="note" style={{ ...notice, fontSize: 13.5, lineHeight: 1.5, margin: "14px 0 18px", maxWidth: 720 }}>
            Checked by you — AI can misread a PDF, so fix anything wrong before saving.
          </div>

          <CardGrid align="start">
            {drafts.map((d, i) => {
              const bad = issues[i];
              const chapters = draftChapters(d);
              const isOpen = open.has(d.key) || !!bad.chapters;
              const show = (field) => bad[field] && (tried || field === "date" || field === "chapters");
              const past = !bad.date && d.date < key(new Date());
              const idp = `draft-${i}`;
              return (
                <div key={d.key} className="card" data-draft={d.key} style={{ ...card, padding: 18, borderColor: tried && Object.keys(bad).length ? C.accent : C.line }}>
                  <label style={small} htmlFor={`${idp}-name`}>Subject</label>
                  <input id={`${idp}-name`} value={d.name} onChange={(e) => edit(d.key, { name: e.target.value })} style={{ ...inputStyle, padding: "10px 12px", fontSize: 16, fontWeight: 600 }} />
                  {show("name") && <div style={flag}>{bad.name}</div>}

                  <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                    <div style={{ flex: 3, minWidth: 0 }}>
                      <label style={small} htmlFor={`${idp}-date`}>Exam date</label>
                      <input
                        id={`${idp}-date`}
                        type="date"
                        required
                        aria-invalid={!!bad.date}
                        value={d.date}
                        onChange={(e) => edit(d.key, { date: e.target.value, dateFromPdf: false })}
                        style={{
                          ...inputStyle, padding: "10px 10px", fontSize: 15,
                          ...(bad.date ? { borderColor: C.accent } : d.dateFromPdf ? { background: C.accentSoft, borderColor: C.accentLine } : {}),
                        }}
                      />
                    </div>
                    <div style={{ flex: 2, minWidth: 0 }}>
                      <label style={small} htmlFor={`${idp}-score`}>Last test score (%)</label>
                      <NumField id={`${idp}-score`} value={d.lastScore} min={0} max={100} onChange={(v) => edit(d.key, { lastScore: Math.round(v) })} style={{ ...inputStyle, padding: "10px 12px", fontSize: 15 }} />
                    </div>
                  </div>
                  {show("date") && <div style={flag}>{bad.date}</div>}
                  {!bad.date && d.dateFromPdf && <div style={{ ...flag, fontWeight: 500 }}>Date read from your document — check it's right</div>}
                  {past && <div style={flag}>This date has already passed — check it.</div>}

                  <span style={{ ...small, marginTop: 12 }}>How confident are you? ({d.confidence}/5)</span>
                  <div role="group" aria-label={`Confidence for ${d.name}`} style={{ display: "flex", gap: 6 }}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Tap key={n} aria-pressed={d.confidence === n} onClick={() => edit(d.key, { confidence: n })} style={pill(d.confidence === n)}>{n}</Tap>
                    ))}
                  </div>

                  <span style={{ ...small, marginTop: 12 }}>Pace</span>
                  <div role="group" aria-label={`Pace for ${d.name}`} style={{ display: "flex", gap: 6 }}>
                    {PACE.map((p) => (
                      <Tap key={p.id} aria-pressed={d.pace === p.id} onClick={() => edit(d.key, { pace: p.id })} style={pill(d.pace === p.id)}>{p.label}</Tap>
                    ))}
                  </div>

                  <span style={{ ...small, marginTop: 12 }}>Subject type</span>
                  <div role="group" aria-label={`Type for ${d.name}`} style={{ display: "flex", gap: 6 }}>
                    {Object.entries(TYPE_META).map(([k, v]) => (
                      <Tap key={k} aria-pressed={d.type === k} onClick={() => edit(d.key, { type: k })} style={pill(d.type === k)}>{v.label}</Tap>
                    ))}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
                    <span style={{ fontSize: 13.5, color: chapters.length ? C.text : C.accentText, fontWeight: 600 }}>
                      {chapters.length ? `${chapters.length} chapter${chapters.length === 1 ? "" : "s"} from your PDF` : "No chapters yet"}
                    </span>
                    <Tap
                      className="focus-ring"
                      aria-expanded={isOpen}
                      onClick={() => setOpen((p) => { const x = new Set(p); if (x.has(d.key)) x.delete(d.key); else x.add(d.key); return x; })}
                      style={{ ...textLink, fontSize: 13.5, fontWeight: 600 }}
                    >
                      {isOpen ? "Hide chapters" : "Edit chapters"}
                    </Tap>
                  </div>
                  {isOpen && (
                    <>
                      <textarea
                        aria-label={`Chapters for ${d.name}`}
                        rows={Math.min(10, Math.max(4, chapters.length + 1))}
                        value={d.chaptersText}
                        placeholder="One chapter per line"
                        onChange={(e) => edit(d.key, { chaptersText: e.target.value })}
                        style={{ ...inputStyle, marginTop: 10, resize: "vertical", lineHeight: 1.5, fontSize: 14.5 }}
                      />
                      <div style={{ fontSize: 12, color: C.dim, marginTop: 6, lineHeight: 1.45 }}>
                        One chapter per line. Delete any line that isn't a chapter. At most 60 are kept.
                      </div>
                    </>
                  )}
                  {show("chapters") && <div style={flag}>{bad.chapters}</div>}
                </div>
              );
            })}
          </CardGrid>

          <div style={{ maxWidth: 560, marginTop: SP.section }}>
            {tried && flagged > 0 && (
              <div role="alert" style={{ ...notice, fontSize: 14, marginBottom: 12 }}>
                {flagged} subject{flagged === 1 ? " needs" : "s need"} fixing — see the flagged fields above.
              </div>
            )}
            <Tap className="focus-ring" aria-disabled={flagged > 0 || undefined} onClick={save} style={{ ...primary, opacity: flagged ? 0.55 : 1 }}>
              Add {drafts.length} subject{drafts.length === 1 ? "" : "s"}
            </Tap>
            <Tap className="focus-ring" onClick={() => setStep("pick")} style={{ ...secondary, marginTop: 10 }}>‹ Back to the list</Tap>
          </div>
        </div>
      )}
    </div>
  );
}
