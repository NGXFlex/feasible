import { GoogleGenerativeAI } from "@google/generative-ai";
import { checkPayload, parseModelReply, describeGeminiError, GEMINI_PROMPT } from "../src/engine/pdfPortions.js";

/* ------------------------------------------------------------------
   POST /api/parse-portions   { files: [{ data: "<base64>", mimeType }] }
                              (or { pdf: "<base64>" } for one PDF)
   -> 200 { subjects: [{ name, examDate, chapters }] }   or   4xx/5xx { error }

   Vercel serverless function. Sends a PDF or up to 5 photos to Gemini in
   one request, in order, and returns the subjects it finds. The app never saves this directly: the student
   reviews and edits it first.

   Needs GEMINI_API_KEY in the environment (Vercel > Project > Settings >
   Environment Variables). GEMINI_MODEL is optional.
------------------------------------------------------------------- */
// gemini-2.0-flash was shut down on 1 June 2026; set GEMINI_MODEL to move on without a code change
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Send the files with a POST request." });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "PDF import isn't set up on the server yet. Use Paste portions for now." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const payload = checkPayload(body);
  if (!payload.ok) return res.status(payload.status).json({ error: payload.error });

  let reply;
  try {
    const model = new GoogleGenerativeAI(key).getGenerativeModel({ model: MODEL });
    // every page or photo first, in the order given, then the instructions
    const result = await model.generateContent([
      ...payload.files.map((f) => ({ inlineData: { mimeType: f.mimeType, data: f.base64 } })),
      { text: GEMINI_PROMPT },
    ]);
    reply = result.response.text();
  } catch (err) {
    // the real reason, for the Vercel function logs (never the key or the file)
    console.error(`Gemini ${MODEL} failed:`, err?.status ?? "", err?.message ?? err);
    const { status, error } = describeGeminiError(err);
    return res.status(status).json({ error });
  }

  try {
    return res.status(200).json(parseModelReply(reply));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
