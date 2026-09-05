const GOOGLE_BASE = "https://generativelanguage.googleapis.com";

function json(res, obj, status = 200) {
  res.status(status).setHeader("Content-Type", "application/json");
  return res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.end();
  }

  const API_KEY = process.env.GEMINI_API_KEY;
  const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-3.6-flash";
  const TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-3.1-flash-tts-preview";

  if (!API_KEY) return json(res, { error: "GEMINI_API_KEY غير مضاف في Vercel Environment Variables" }, 500);

  const path = new URL(req.url, "http://localhost").pathname.replace(/^\/api/, "") || "/";

  try {
    if (path === "/upload-start" && req.method === "POST") {
      const { fileName, mimeType, sizeBytes } = req.body || {};
      const upstream = await fetch(`${GOOGLE_BASE}/upload/v1beta/files?key=${encodeURIComponent(API_KEY)}`, {
        method: "POST",
        headers: {
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": String(sizeBytes || 0),
          "X-Goog-Upload-Header-Content-Type": mimeType || "application/pdf",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ file: { display_name: fileName || "file" } })
      });
      const text = await upstream.text();
      if (!upstream.ok) return json(res, { error: text }, upstream.status);
      return json(res, { uploadUrl: upstream.headers.get("x-goog-upload-url") });
    }

    if (path === "/file-status" && req.method === "GET") {
      const name = new URL(req.url, "http://localhost").searchParams.get("name");
      if (!name) return json(res, { error: "missing name" }, 400);
      const upstream = await fetch(`${GOOGLE_BASE}/v1beta/${name}?key=${encodeURIComponent(API_KEY)}`);
      return json(res, await upstream.json(), upstream.status);
    }

    if (path === "/chat" && req.method === "POST") {
      const body = req.body || {};
      const upstream = await fetch(`${GOOGLE_BASE}/v1beta/models/${encodeURIComponent(TEXT_MODEL)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(API_KEY)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: body.contents,
          systemInstruction: body.systemInstruction ? { parts: [{ text: body.systemInstruction }] } : undefined,
          generationConfig: { temperature: 0.4 }
        })
      });
      res.status(upstream.status).setHeader("Content-Type", "text/event-stream");
      if (!upstream.body) return res.end();
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
      return res.end();
    }

    if (path === "/tts" && req.method === "POST") {
      const body = req.body || {};
      const upstream = await fetch(`${GOOGLE_BASE}/v1beta/models/${encodeURIComponent(TTS_MODEL)}:generateContent?key=${encodeURIComponent(API_KEY)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: body.prompt }] }],
          generationConfig: { responseModalities: ["AUDIO"], speechConfig: body.speechConfig }
        })
      });
      return json(res, await upstream.json(), upstream.status);
    }

    return json(res, { error: "not found" }, 404);
  } catch (err) {
    return json(res, { error: String(err && err.message || err) }, 500);
  }
};
