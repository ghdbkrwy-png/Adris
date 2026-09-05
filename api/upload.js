const GOOGLE_BASE = "https://generativelanguage.googleapis.com";

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-File-Name,X-File-Size");
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-File-Name,X-File-Size");
    return res.end();
  }

  if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });

  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) return sendJson(res, 500, { error: "GEMINI_API_KEY غير مضاف في Vercel Environment Variables" });

  const mimeType = req.headers["content-type"] || "application/octet-stream";
  const sizeBytes = req.headers["x-file-size"] || req.headers["content-length"] || "0";
  const fileName = decodeURIComponent(req.headers["x-file-name"] || "file");

  try {
    // Start a Gemini resumable upload on the server. The secret key never reaches the browser.
    const start = await fetch(`${GOOGLE_BASE}/upload/v1beta/files?key=${encodeURIComponent(API_KEY)}`, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(sizeBytes),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ file: { display_name: fileName } })
    });

    if (!start.ok) {
      const text = await start.text();
      return sendJson(res, start.status, { error: text });
    }

    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (!uploadUrl) return sendJson(res, 502, { error: "Google لم يرجع رابط رفع صالح" });

    // Stream the raw file bytes from the browser through Vercel to Google.
    // This fixes the browser-side CORS failure that caused "انقطع الاتصال أثناء الرفع".
    const upstream = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Length": String(sizeBytes),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
        "Content-Type": mimeType
      },
      body: req,
      duplex: "half"
    });

    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.end(text);
  } catch (err) {
    return sendJson(res, 500, { error: String(err && err.message || err) });
  }
};
