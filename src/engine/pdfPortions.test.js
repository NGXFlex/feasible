import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from "@google/generative-ai";
import { checkPdfPayload, parseModelReply, describeGeminiError, base64Bytes, MAX_PDF_BYTES } from "./pdfPortions.js";
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

test("pdf payload: base64 size is the decoded size", () => {
  assert.equal(base64Bytes(Buffer.from("hello").toString("base64")), 5);
  assert.equal(base64Bytes(Buffer.from("hell").toString("base64")), 4);
});

test("model reply: fences stripped, numbering cleaned, junk dropped", () => {
  const reply = '```json\n{ "Physics": ["1. Electric Charges", "2) Current Electricity", 7, ""], "Empty": [], "Bad": "x", "Chemistry": ["Solutions;"] }\n```';
  assert.deepEqual(parseModelReply(reply), {
    Physics: ["Electric Charges", "Current Electricity"],
    Chemistry: ["Solutions"],
  });
  assert.deepEqual(parseModelReply("{}"), {});
});

test("model reply: anything that isn't the JSON object asked for is a readable error", () => {
  assert.throws(() => parseModelReply("Sure! Here are the chapters:"), /wasn't a chapter list/);
  assert.throws(() => parseModelReply('["a","b"]'), /wasn't a chapter list/);
});

test("model reply: each subject capped at 60 chapters", () => {
  const many = Array.from({ length: 75 }, (_, i) => `Topic ${i + 1}`);
  assert.equal(parseModelReply(JSON.stringify({ Big: many })).Big.length, 60);
});

test("gemini errors: quota says so and points to Paste portions", () => {
  const quota = describeGeminiError(new GoogleGenerativeAIFetchError("[429 Too Many Requests] Resource has been exhausted", 429, "Too Many Requests"));
  assert.equal(quota.status, 429);
  assert.match(quota.error, /free limit/);
  assert.match(quota.error, /Paste portions/);
  assert.equal(describeGeminiError({ message: "RESOURCE_EXHAUSTED: quota exceeded" }).status, 429);
  assert.match(describeGeminiError(new Error("socket hang up")).error, /Paste portions/);
});

test("parser: PDF chapter names keep all-caps names the paste parser treats as headings", () => {
  assert.deepEqual(parsePortions("OPTICS\nWave Optics").map((c) => c.name), ["Wave Optics"]);
  assert.deepEqual(parsePortions("OPTICS\nWave Optics", { keepHeadings: true }).map((c) => c.name), ["OPTICS", "Wave Optics"]);
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

test("function: sends the PDF inline and returns the cleaned chapter list", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  let sent;
  fakeGemini(async (parts) => {
    sent = parts;
    return { response: { text: () => '```json\n{"Biology": ["1. Reproduction", "2. Genetics"]}\n```' } };
  });
  const r = await call({ body: { pdf: PDF } });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { Biology: ["Reproduction", "Genetics"] });
  assert.deepEqual(sent[0], { inlineData: { mimeType: "application/pdf", data: PDF } });
  assert.match(sent[1].text, /Return ONLY valid JSON/);
});

test("function: a JSON string body works too", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  fakeGemini(async () => ({ response: { text: () => "{}" } }));
  const r = await call({ body: JSON.stringify({ pdf: PDF }) });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, {});
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
