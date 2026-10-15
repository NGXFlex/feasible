import { GoogleGenerativeAI } from "@google/generative-ai";
import { checkPdfPayload, parseModelReply, describeGeminiError, GEMINI_PROMPT } from "../src/engine/pdfPortions.js";

/* ------------------------------------------------------------------
   POST /api/parse-portions   { pdf: "<base64>" }
   -> 200 { "Subject": ["Chapter", ...] }   or   4xx/5xx { error }

   Vercel serverless function. Sends the PDF to Gemini and returns the
   chapter list it finds. The app never saves this directly: the student
   reviews and edits it first.

   Needs GEMINI_API_KEY in the environment (Vercel > Project > Settings >
   Environment Variables). GEMINI_MODEL is optional.
------------------------------------------------------------------- */
const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Send the PDF with a POST request." });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "PDF import isn't set up on the server yet. Use Paste portions for now." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const payload = checkPdfPayload(body);
  if (!payload.ok) return res.status(payload.status).json({ error: payload.error });

  let reply;
  try {
    const model = new GoogleGenerativeAI(key).getGenerativeModel({ model: MODEL });
    const result = await model.generateContent([
      { inlineData: { mimeType: "application/pdf", data: payload.base64 } },
      { text: GEMINI_PROMPT },
    ]);
    reply = result.response.text();
  } catch (err) {
    const { status, error } = describeGeminiError(err);
    return res.status(status).json({ error });
  }

  try {
    return res.status(200).json(parseModelReply(reply));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
