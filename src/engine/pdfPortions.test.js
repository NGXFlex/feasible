import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from "@google/generative-ai";
import {
  checkPdfPayload, parseModelReply, describeGeminiError, base64Bytes, normaliseExamDate, MAX_PDF_BYTES,
  draftFromPdf, draftChapters, draftIssues, subjectFromDraft, checkPayload, mimeTypeOf, GEMINI_PROMPT,
} from "./pdfPortions.js";
import { parsePortions } from "./portions.js";
import handler from "../../api/parse-portions.js";

const PDF = Buffer.from("%PDF-1.4 tiny test file").toString("base64");

test("pdf payload: a base64 PDF passes; missing, junk and oversized ones don't", () => {
  assert.deepEqual(checkPdfPayload({ pdf: PDF }), { ok: true, base64: PDF });
  assert.equal(checkPdfPayload({ pdf: `data:application/pdf;base64,${PDF}` }).base64, PDF);
  assert.equal(checkPdfPayload({}).status, 400);
  assert.equal(checkPdfPayload(null).status, 400);
  assert.equal(checkPdfPayload({ pdf: "not base64 !!" }).status, 400);
  const big = "A".repeat(Math.ceil((MAX_PDF_BYTES + 10) / 3) * 4);
  const r = checkPdfPayload({ pdf: big });
  assert.equal(r.status, 413);
  assert.match(r.error, /5 MB/);
});

test("payload: up to 5 files, PDFs and photos, each with its own type", () => {
  const jpg = { data: PDF, mimeType: "image/jpeg" };
  const r = checkPayload({ files: [jpg, { data: PDF, mimeType: "image/heic" }, { data: PDF, mimeType: "application/pdf" }] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.files.map((f) => f.mimeType), ["image/jpeg", "image/heic", "application/pdf"]);
  assert.equal(checkPayload({ files: Array(6).fill(jpg) }).status, 400);
  assert.match(checkPayload({ files: Array(6).fill(jpg) }).error, /up to 5/);
  assert.match(checkPayload({ files: [{ data: PDF, mimeType: "image/gif" }] }).error, /PDFs and photos/);
  assert.equal(checkPayload({ files: [] }).status, 400);
  const big = "A".repeat(Math.ceil((MAX_PDF_BYTES + 10) / 3) * 4);
  assert.equal(checkPayload({ files: [jpg, { data: big, mimeType: "image/png" }] }).status, 413, "5 MB is per file");
  // the older single-PDF form still works
  assert.deepEqual(checkPayload({ pdf: PDF }).files, [{ mimeType: "application/pdf", base64: PDF }]);
});

test("payload: a file the browser gives no type gets one from its name", () => {
  assert.equal(mimeTypeOf("IMG_0042.HEIC", ""), "image/heic");
  assert.equal(mimeTypeOf("notice.jpeg", ""), "image/jpeg");
  assert.equal(mimeTypeOf("scan.pdf", "application/octet-stream"), "application/pdf");
  assert.equal(mimeTypeOf("photo.png", "image/png"), "image/png");
  assert.equal(mimeTypeOf("notes.docx", ""), null);
});

test("prompt: tells Gemini about photos and what to do when nothing is legible", () => {
  assert.match(GEMINI_PROMPT, /The input may be photographs of a printed or handwritten document\. Read them in the order given\. Ignore glare, shadows and page edges\./);
  assert.match(GEMINI_PROMPT, /If nothing is legible, return \{ "subjects": \[\] \}/);
});

test("pdf payload: base64 size is the decoded size", () => {
  assert.equal(base64Bytes(Buffer.from("hello").toString("base64")), 5);
  assert.equal(base64Bytes(Buffer.from("hell").toString("base64")), 4);
});

test("model reply: fences stripped, numbering cleaned, junk dropped", () => {
  const body = JSON.stringify({ subjects: [
    { name: "Physics", examDate: "2026-03-12", chapters: ["1. Electric Charges", "2) Current Electricity", 7, ""] },
    { name: "Empty", examDate: null, chapters: [] },
    { name: "", chapters: ["x"] },
    "junk",
    { name: "Chemistry", chapters: ["Solutions;"] },
  ] });
  assert.deepEqual(parseModelReply("```json\n" + body + "\n```"), {
    subjects: [
      { name: "Physics", examDate: "2026-03-12", chapters: ["Electric Charges", "Current Electricity"] },
      { name: "Chemistry", examDate: null, chapters: ["Solutions"] },
    ],
  });
  assert.deepEqual(parseModelReply('{ "subjects": [] }'), { subjects: [] });
  assert.deepEqual(parseModelReply("{}"), { subjects: [] });
});

test("model reply: a subject with a date but no chapters is kept (timetable only)", () => {
  const r = parseModelReply('{"subjects":[{"name":"English","examDate":"2026-03-04","chapters":[]}]}');
  assert.deepEqual(r.subjects, [{ name: "English", examDate: "2026-03-04", chapters: [] }]);
});

test("model reply: a subject listed twice is merged", () => {
  const r = parseModelReply(JSON.stringify({ subjects: [
    { name: "Maths", examDate: null, chapters: ["Matrices"] },
    { name: "maths", examDate: "2026-03-09", chapters: ["Integrals"] },
  ] }));
  assert.deepEqual(r.subjects, [{ name: "Maths", examDate: "2026-03-09", chapters: ["Matrices", "Integrals"] }]);
});

test("model reply: the older { subject: [chapters] } shape still reads", () => {
  assert.deepEqual(parseModelReply('{"Biology":["1. Genetics"]}'), { subjects: [{ name: "Biology", examDate: null, chapters: ["Genetics"] }] });
});

test("exam dates: ISO kept, numeric dates read as DD/MM, anything else null", () => {
  assert.equal(normaliseExamDate("2026-03-12"), "2026-03-12");
  assert.equal(normaliseExamDate("2026-3-2"), "2026-03-02");
  assert.equal(normaliseExamDate("12/03/26"), "2026-03-12");
  assert.equal(normaliseExamDate("12-03-2026"), "2026-03-12");
  assert.equal(normaliseExamDate("05.04.2026"), "2026-04-05");
  assert.equal(normaliseExamDate("31/02/2026"), null);
  assert.equal(normaliseExamDate("2026-13-01"), null);
  assert.equal(normaliseExamDate("12 March 2026"), null);
  assert.equal(normaliseExamDate(null), null);
  assert.equal(normaliseExamDate(""), null);
});

test("model reply: anything that isn't the JSON object asked for is a readable error", () => {
  assert.throws(() => parseModelReply("Sure! Here are the chapters:"), /wasn't a chapter list/);
  assert.throws(() => parseModelReply('["a","b"]'), /wasn't a chapter list/);
  assert.throws(() => parseModelReply('{"subjects":"none"}'), /wasn't a chapter list/);
});

test("model reply: each subject capped at 60 chapters", () => {
  const many = Array.from({ length: 75 }, (_, i) => `Topic ${i + 1}`);
  const r = parseModelReply(JSON.stringify({ subjects: [{ name: "Big", chapters: many }] }));
  assert.equal(r.subjects[0].chapters.length, 60);
});

test("gemini errors: quota says so and points to Paste portions", () => {
  const quota = describeGeminiError(new GoogleGenerativeAIFetchError("[429 Too Many Requests] Resource has been exhausted", 429, "Too Many Requests"));
  assert.equal(quota.status, 429);
  assert.match(quota.error, /free limit/);
  assert.match(quota.error, /Paste portions/);
  assert.equal(describeGeminiError({ message: "RESOURCE_EXHAUSTED: quota exceeded" }).status, 429);
  assert.match(describeGeminiError(new Error("socket hang up")).error, /Paste portions/);
  // a retired model says so, instead of "try again in a moment"
  const gone = describeGeminiError(new GoogleGenerativeAIFetchError("[404 Not Found] models/gemini-2.0-flash is not found for API version v1beta", 404, "Not Found"));
  assert.equal(gone.status, 500);
  assert.match(gone.error, /isn't available any more/);
});

test("parser: PDF chapter names keep all-caps names the paste parser treats as headings", () => {
  assert.deepEqual(parsePortions("OPTICS\nWave Optics").map((c) => c.name), ["Wave Optics"]);
  assert.deepEqual(parsePortions("OPTICS\nWave Optics", { keepHeadings: true }).map((c) => c.name), ["OPTICS", "Wave Optics"]);
});

/* ------------------------------ importing ------------------------------ */
test("import: a draft starts from what was read, with plain defaults", () => {
  const d = draftFromPdf({ name: "Physics", examDate: "2026-11-02", chapters: ["Optics", "Atoms"] }, "quick");
  assert.equal(d.name, "Physics");
  assert.equal(d.date, "2026-11-02");
  assert.equal(d.dateFromPdf, true);
  assert.deepEqual([d.confidence, d.lastScore, d.pace, d.type], [3, 60, "quick", "theory"]);
  assert.deepEqual(draftChapters(d), ["Optics", "Atoms"]);
  assert.deepEqual(draftIssues(d), {});
});

test("import: no exam date, no chapters or no name can't be saved", () => {
  const d = draftFromPdf({ name: "English", examDate: null, chapters: [] });
  assert.equal(d.dateFromPdf, false);
  const issues = draftIssues(d);
  assert.match(issues.date, /exam date/);
  assert.match(issues.chapters, /at least one chapter/);
  assert.match(draftIssues({ ...d, name: "  ", date: "2026-11-02", chaptersText: "Flamingo" }).name, /name/);
  assert.deepEqual(draftIssues({ ...d, date: "2026-11-02", chaptersText: "Flamingo" }), {});
});

test("import: edited chapters are what gets saved, capped at 60, headings kept", () => {
  const d = { ...draftFromPdf({ name: "Chem", examDate: "2026-11-02", chapters: ["Solutions"] }), chaptersText: "OPTICS\n\n2. Amines\n" };
  const s = subjectFromDraft({ ...d, name: " Chem ", lastScore: 71.6, confidence: 4 }, { id: "c1", today: "2026-10-15" });
  assert.deepEqual(s.names, ["OPTICS", "Amines"]);
  assert.equal(s.chapters, 2);
  assert.equal(s.name, "Chem");
  assert.equal(s.lastScore, 72);
  assert.equal(s.confidence, 4);
  assert.equal(s.createdAt, "2026-10-15");
  assert.deepEqual(s.done, [false, false]);
  assert.deepEqual(s.weight, [2, 2]);
  assert.deepEqual(s.log, []);
  const many = { ...d, chaptersText: Array.from({ length: 70 }, (_, i) => `Topic ${i + 1}`).join("\n") };
  assert.equal(subjectFromDraft(many, { id: "x", today: "2026-10-15" }).chapters, 60);
});

/* ------------------------------ the function ------------------------------ */
const call = async (req) => {
  const res = { code: 200, body: undefined, headers: {} };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  await handler({ method: "POST", ...req }, res);
  return res;
};
const realModel = GoogleGenerativeAI.prototype.getGenerativeModel;
const fakeGemini = (fn) => {
  GoogleGenerativeAI.prototype.getGenerativeModel = function () { return { generateContent: fn }; };
};
afterEach(() => {
  GoogleGenerativeAI.prototype.getGenerativeModel = realModel;
  delete process.env.GEMINI_API_KEY;
});

test("function: POST only, and a missing key is a clear error", async () => {
  assert.equal((await call({ method: "GET" })).code, 405);
  const r = await call({ body: { pdf: PDF } });
  assert.equal(r.code, 500);
  assert.match(r.body.error, /isn't set up/);
});

test("function: sends the PDF inline and returns the cleaned subjects", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  let sent;
  const reply = JSON.stringify({ subjects: [{ name: "Biology", examDate: "2026-03-12", chapters: ["1. Reproduction", "2. Genetics"] }] });
  fakeGemini(async (parts) => {
    sent = parts;
    return { response: { text: () => "```json\n" + reply + "\n```" } };
  });
  const r = await call({ body: { pdf: PDF } });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { subjects: [{ name: "Biology", examDate: "2026-03-12", chapters: ["Reproduction", "Genetics"] }] });
  assert.deepEqual(sent[0], { inlineData: { mimeType: "application/pdf", data: PDF } });
  assert.match(sent[1].text, /Return ONLY valid JSON/);
  assert.match(sent[1].text, /examDate/);
});

test("function: several photos go to Gemini in one request, in order, each with its type", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  let sent;
  fakeGemini(async (parts) => { sent = parts; return { response: { text: () => '{"subjects":[]}' } }; });
  const a = Buffer.from("page one").toString("base64");
  const b = Buffer.from("page two").toString("base64");
  const r = await call({ body: { files: [{ data: a, mimeType: "image/jpeg" }, { data: b, mimeType: "image/png" }] } });
  assert.equal(r.code, 200);
  assert.deepEqual(sent.slice(0, 2), [
    { inlineData: { mimeType: "image/jpeg", data: a } },
    { inlineData: { mimeType: "image/png", data: b } },
  ]);
  assert.match(sent[2].text, /photographs/);
  assert.deepEqual(r.body, { subjects: [] });
});

test("function: a JSON string body works too", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  fakeGemini(async () => ({ response: { text: () => '{ "subjects": [] }' } }));
  const r = await call({ body: JSON.stringify({ pdf: PDF }) });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { subjects: [] });
});

test("function: oversized and empty uploads never reach Gemini", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  let called = false;
  fakeGemini(async () => { called = true; });
  assert.equal((await call({ body: { pdf: "A".repeat(7_100_000) } })).code, 413);
  assert.equal((await call({ body: {} })).code, 400);
  assert.equal(called, false);
});

test("function: quota and unreadable replies come back as readable 4xx messages", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  fakeGemini(async () => { throw new GoogleGenerativeAIFetchError("[429 Too Many Requests] quota", 429, "Too Many Requests"); });
  const q = await call({ body: { pdf: PDF } });
  assert.equal(q.code, 429);
  assert.match(q.body.error, /free limit/);

  fakeGemini(async () => ({ response: { text: () => "I can't help with that." } }));
  const bad = await call({ body: { pdf: PDF } });
  assert.equal(bad.code, 400);
  assert.match(bad.body.error, /Paste portions/);
});
