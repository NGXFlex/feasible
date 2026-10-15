import { cleanChapterName, parsePortions, DEFAULT_WEIGHT } from "./portions.js";

/* ------------------------------------------------------------------ */
/*  PDF portions import: everything around the Gemini call that can be  */
/*  checked without it. Used by api/parse-portions.js and the client.   */
/* ------------------------------------------------------------------ */

export const MAX_PDF_BYTES = 5 * 1024 * 1024;   // per file
/* Vercel refuses a function request body over 4.5 MB, and base64 makes a
   file a third bigger, so everything sent together has to stay under about
   3.3 MB. The browser shrinks photos before sending so several fit. */
export const MAX_REQUEST_BYTES = 4.5 * 1024 * 1024;
export const MAX_FILES = 5;
export const MAX_SUBJECT_CHAPTERS = 60;

/* what Gemini can read, by type; a file the browser gives no type gets one from its name */
export const FILE_TYPES = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/heic": [".heic"],
  "image/heif": [".heif"],
  "image/webp": [".webp"],
};
export function mimeTypeOf(name, type) {
  if (type && FILE_TYPES[type]) return type;
  const ext = String(name ?? "").toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  return Object.keys(FILE_TYPES).find((t) => FILE_TYPES[t].includes(ext)) ?? null;
}

export const GEMINI_PROMPT = `This is a student's exam portions document. It may also contain an exam timetable.
The input may be photographs of a printed or handwritten document. Read them in the order given. Ignore glare, shadows and page edges.

Return ONLY valid JSON, no markdown fences:
{
  "subjects": [
    {
      "name": "Subject name as written",
      "examDate": "YYYY-MM-DD or null if not stated",
      "chapters": ["chapter name", "chapter name"]
    }
  ]
}

Rules:
- One entry per subject found. Include every subject in the document.
- Include only chapters explicitly listed. Never invent them.
- Strip leading numbering from chapter names.
- Drop unit headings, term labels, page numbers and marks columns.
- examDate: only if the document clearly states an exam date for that subject. Convert any format (12/03/26, 12 March 2026, 12-03-2026) to YYYY-MM-DD. Assume DD/MM/YYYY for ambiguous numeric dates, as this is an Indian school document. If no date is stated, use null.
- A subject with a date but no chapters is still valid — include it with an empty chapters array.
- If nothing is identifiable, return { "subjects": [] }
- If nothing is legible, return { "subjects": [] }`;

/* A request body that can be sent on:
     { files: [{ data: "<base64>", mimeType }] }   up to 5, in reading order
     { pdf: "<base64>" }                           one PDF (older clients)
   each file under 5 MB. Returns { ok: true, files: [{ mimeType, base64 }] }
   or { ok: false, status, error }. */
export function checkPayload(body) {
  const b = body && typeof body === "object" ? body : {};
  const list = Array.isArray(b.files) ? b.files
    : typeof b.pdf === "string" ? [{ data: b.pdf, mimeType: "application/pdf" }]
    : null;
  if (!list || !list.length) {
    return { ok: false, status: 400, error: "No file was sent. Choose a PDF or photos and try again." };
  }
  if (list.length > MAX_FILES) {
    return { ok: false, status: 400, error: `That's more than ${MAX_FILES} files. Send up to ${MAX_FILES} at a time.` };
  }
  const files = [];
  for (const f of list) {
    const data = typeof f?.data === "string" ? f.data : "";
    const mimeType = FILE_TYPES[f?.mimeType] ? f.mimeType : null;
    if (!mimeType) {
      return { ok: false, status: 400, error: "Only PDFs and photos (JPG, PNG, HEIC or WebP) can be read." };
    }
    const base64 = data.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
    if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      return { ok: false, status: 400, error: "One of those files couldn't be read." };
    }
    if (base64Bytes(base64) > MAX_PDF_BYTES) {
      return { ok: false, status: 413, error: "One of those files is over 5 MB. Try a smaller file, or enter it manually instead." };
    }
    files.push({ mimeType, base64 });
  }
  return { ok: true, files };
}
/* the single-PDF form, as before */
export function checkPdfPayload(body) {
  const r = checkPayload(body);
  return r.ok ? { ok: true, base64: r.files[0].base64 } : r;
}

/* bytes a base64 string decodes to */
export const base64Bytes = (b64) => Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);

/* An exam date as "YYYY-MM-DD", or null. Gemini is asked for that format;
   if it sends a numeric date anyway, it is read as DD/MM/YYYY (Indian
   school documents). Impossible dates (31/02) are null. */
export function normaliseExamDate(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  let y, m, d, r;
  if ((r = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [, y, m, d] = r;
  else if ((r = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/))) {
    [, d, m, y] = r;
    if (y.length === 2) y = `20${y}`;
  } else return null;
  [y, m, d] = [Number(y), Number(m), Number(d)];
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (y < 2000 || y > 2100 || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const NOT_A_LIST = "The PDF reader sent back something that wasn't a chapter list. Try again, or use Paste portions instead.";

/* Gemini's reply as { subjects: [{ name, examDate, chapters }] }. Strips
   markdown fences, keeps only string chapter names and cleans their
   numbering, checks each date, merges a subject listed twice, drops
   subjects with neither chapters nor a date, and caps each subject at 60
   chapters. Throws a readable Error when the reply isn't the JSON asked for. */
export function parseModelReply(text) {
  const raw = String(text ?? "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(NOT_A_LIST);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(NOT_A_LIST);
  // the older { "Subject": [chapters] } shape is read too
  const list = data.subjects === undefined
    ? Object.entries(data).map(([name, chapters]) => ({ name, chapters }))
    : data.subjects;
  if (!Array.isArray(list)) throw new Error(NOT_A_LIST);

  const subjects = [];
  const byName = new Map();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!name) continue;
    const chapters = (Array.isArray(entry.chapters) ? entry.chapters : [])
      .filter((c) => typeof c === "string")
      .map(cleanChapterName)
      .filter(Boolean);
    const examDate = normaliseExamDate(entry.examDate);
    if (!chapters.length && !examDate) continue;
    const seen = byName.get(name.toLowerCase());
    if (seen) {
      seen.chapters.push(...chapters);
      seen.examDate ??= examDate;
      continue;
    }
    const subject = { name, examDate, chapters };
    byName.set(name.toLowerCase(), subject);
    subjects.push(subject);
  }
  for (const s of subjects) s.chapters = s.chapters.slice(0, MAX_SUBJECT_CHAPTERS);
  return { subjects };
}

/* A failed Gemini call as { status, error } a student can act on */
export function describeGeminiError(err) {
  const status = err?.status ?? err?.response?.status;
  const text = `${err?.message ?? ""} ${JSON.stringify(err?.errorDetails ?? "")}`;
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(text)) {
    return { status: 429, error: "The free limit for reading PDFs has been reached for now. Use Paste portions instead — copy the chapter list out of the PDF and paste it in." };
  }
  if (status === 400 && /pdf|mime|image|document|invalid/i.test(text)) {
    return { status: 400, error: "Gemini couldn't read that file. If it's password-protected or damaged, enter it manually instead." };
  }
  if (status === 401 || status === 403 || /API key/i.test(text)) {
    return { status: 500, error: "PDF import isn't set up correctly on the server. Use Paste portions for now." };
  }
  return { status: 502, error: "The PDF couldn't be read right now. Try again in a moment, or use Paste portions instead." };
}

/* ---------------------------- importing ----------------------------
   Each subject the student ticks becomes a draft they check before
   anything is saved. Nothing Gemini sent is saved without that step. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function draftFromPdf(subject, pace = "steady") {
  return {
    key: subject.name,
    name: subject.name,
    date: subject.examDate ?? "",
    dateFromPdf: !!subject.examDate,
    chaptersText: subject.chapters.join("\n"),
    type: "theory", confidence: 3, lastScore: 60, pace,
  };
}

/* the chapter names in a draft, one per line, at most 60 */
export const draftChapters = (draft) =>
  parsePortions(draft.chaptersText, { keepHeadings: true }).map((c) => c.name).slice(0, MAX_SUBJECT_CHAPTERS);

/* What stops a draft being saved, by field: {} when it can be saved */
export function draftIssues(draft) {
  const issues = {};
  if (!draft.name.trim()) issues.name = "Give this subject a name.";
  if (!DAY.test(draft.date ?? "")) issues.date = "Add the exam date — the plan needs it.";
  if (!draftChapters(draft).length) issues.chapters = "Add at least one chapter.";
  return issues;
}

/* A checked draft as a saved subject. today is "YYYY-MM-DD". */
export function subjectFromDraft(draft, { id, today }) {
  const names = draftChapters(draft);
  const n = names.length;
  return {
    id, name: draft.name.trim(), date: draft.date, createdAt: today,
    chapters: n, type: draft.type, confidence: draft.confidence,
    lastScore: Math.round(draft.lastScore), pace: draft.pace,
    log: [], names,
    diff: Array(n).fill(2),
    done: Array(n).fill(false),
    weight: Array(n).fill(DEFAULT_WEIGHT),
  };
}
