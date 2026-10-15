import { cleanChapterName } from "./portions.js";

/* ------------------------------------------------------------------ */
/*  PDF portions import: everything around the Gemini call that can be  */
/*  checked without it. Used by api/parse-portions.js and the client.   */
/* ------------------------------------------------------------------ */

export const MAX_PDF_BYTES = 5 * 1024 * 1024;
/* Vercel refuses a function request body over 4.5 MB, and base64 makes a
   file a third bigger, so a PDF has to stay under about 3.3 MB to arrive. */
export const MAX_REQUEST_BYTES = 4.5 * 1024 * 1024;
export const MAX_SUBJECT_CHAPTERS = 60;

export const GEMINI_PROMPT = `This is a student's exam portions or syllabus document. Extract the chapter or topic names for each subject it lists.

Return ONLY valid JSON, no markdown fences, in this shape:
{ "Subject Name": ["Chapter 1 name", "Chapter 2 name"] }

Rules:
- Include only what is explicitly listed as portions. Do not invent chapters.
- Strip leading numbering from chapter names.
- Drop unit headings, term labels, and page numbers.
- If no subjects are identifiable, return {}`;

/* A request body that can be sent on: { pdf: "<base64>" } under 5 MB.
   Returns { ok: true, base64 } or { ok: false, status, error }. */
export function checkPdfPayload(body) {
  const pdf = body && typeof body === "object" ? body.pdf : undefined;
  if (typeof pdf !== "string" || !pdf.trim()) {
    return { ok: false, status: 400, error: "No PDF was sent. Choose a PDF file and try again." };
  }
  const base64 = pdf.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return { ok: false, status: 400, error: "That file couldn't be read as a PDF." };
  }
  if (base64Bytes(base64) > MAX_PDF_BYTES) {
    return { ok: false, status: 413, error: "That PDF is over 5 MB. Try a smaller file, or use Paste portions instead." };
  }
  return { ok: true, base64 };
}

/* bytes a base64 string decodes to */
export const base64Bytes = (b64) => Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);

/* Gemini's reply as { subject: [chapter, ...] }. Strips markdown fences,
   keeps only string chapter names, cleans their numbering, drops empty
   subjects, and caps each subject at 60 chapters. Throws a readable Error
   when the reply isn't the JSON asked for. */
export function parseModelReply(text) {
  const raw = String(text ?? "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("The PDF reader sent back something that wasn't a chapter list. Try again, or use Paste portions instead.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("The PDF reader sent back something that wasn't a chapter list. Try again, or use Paste portions instead.");
  }
  const out = {};
  for (const [subject, chapters] of Object.entries(data)) {
    const name = String(subject).trim();
    if (!name || !Array.isArray(chapters)) continue;
    const list = chapters
      .filter((c) => typeof c === "string")
      .map(cleanChapterName)
      .filter(Boolean)
      .slice(0, MAX_SUBJECT_CHAPTERS);
    if (list.length) out[name] = list;
  }
  return out;
}

/* A failed Gemini call as { status, error } a student can act on */
export function describeGeminiError(err) {
  const status = err?.status ?? err?.response?.status;
  const text = `${err?.message ?? ""} ${JSON.stringify(err?.errorDetails ?? "")}`;
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(text)) {
    return { status: 429, error: "The free limit for reading PDFs has been reached for now. Use Paste portions instead — copy the chapter list out of the PDF and paste it in." };
  }
  if (status === 400 && /pdf|mime|document|invalid/i.test(text)) {
    return { status: 400, error: "Gemini couldn't read that PDF. If it's a scan or password-protected, use Paste portions instead." };
  }
  if (status === 401 || status === 403 || /API key/i.test(text)) {
    return { status: 500, error: "PDF import isn't set up correctly on the server. Use Paste portions for now." };
  }
  return { status: 502, error: "The PDF couldn't be read right now. Try again in a moment, or use Paste portions instead." };
}
