const _v = "2026-09-08-transcribe-fix";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
const rawModel = Deno.env.get("GEMINI_TRANSCRIBE_MODEL") ?? "";
const normalizedModel = rawModel.replace(/^models\//, "").replace(/^['\"]|['\"]$/g, "").trim();
const model = normalizedModel === "gemini-3.6-flash" ? normalizedModel : "gemini-3.6-flash";
const configuredOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

function log(label: string, data: unknown) {
  console.log(`[transcribe v${_v}] ${label}:`, typeof data === "string" ? data : JSON.stringify(data));
}

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  const allowedOrigin = configuredOrigin === "*" ? (origin || "*") : (origin === configuredOrigin || origin === "http://localhost:5173" || origin === "http://127.0.0.1:5173" ? origin : configuredOrigin);
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  };
}

function jsonResponse(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });
}

async function authorized(code: string, deviceId: string) {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/check_code`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_code: code, p_device_id: deviceId }),
    });
    if (!response.ok) { log("auth_rpc_error", { status: response.status }); return false; }
    return Boolean((await response.json())?.valid);
  } catch (error) {
    log("auth_exception", error instanceof Error ? error.message : String(error));
    return false;
  }
}

Deno.serve(async (req) => {
  log("request", { method: req.method, origin: req.headers.get("Origin") ?? "" });
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders(req) });

  try {
    if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);
    if (!geminiKey) return jsonResponse(req, { error: "خدمة التفريغ غير مهيأة." }, 500);

    const body = await req.json();
    const code = String(body.code ?? "").trim().toUpperCase();
    const deviceId = String(body.device_id ?? "").trim();
    const fileUri = String(body.file_uri ?? "").trim();
    const mimeType = String(body.mime_type ?? "").trim();
    log("parsed", { code: code ? "set" : "empty", deviceId: deviceId ? "set" : "empty", fileUri: fileUri ? "set" : "empty", mimeType, model });

    if (!await authorized(code, deviceId)) return jsonResponse(req, { error: "التفعيل غير صالح." }, 403);
    if (!fileUri || !mimeType.startsWith("audio/")) return jsonResponse(req, { error: "نوع الملف الصوتي غير صالح." }, 400);

    const upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`;
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { file_data: { mime_type: mimeType, file_uri: fileUri } },
            { text: "حوّل التسجيل الصوتي بالكامل إلى نص حرفي. أعد النص فقط دون شرح أو تلخيص." },
          ],
        }],
        generationConfig: { temperature: 0 },
      }),
    });

    const responseText = await upstream.text();
    log("upstream_status", { status: upstream.status, ok: upstream.ok, body: responseText.slice(0, 300) });

    let data: Record<string, unknown> | null = null;
    try { data = JSON.parse(responseText) as Record<string, unknown>; } catch { data = null; }

    if (!upstream.ok) {
      const message = typeof data?.error === "object" && data.error && "message" in data.error ? String((data.error as { message?: unknown }).message ?? "فشل تفريغ التسجيل.") : "فشل تفريغ التسجيل.";
      return jsonResponse(req, { error: message, upstream_status: upstream.status }, upstream.status);
    }

    const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
    const firstCandidate = candidates[0] as { content?: { parts?: Array<{ text?: string }> } } | undefined;
    const text = firstCandidate?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
    if (!text) return jsonResponse(req, { error: "لم يرجع التسجيل نصًا." }, 502);

    log("success", { textLength: text.length });
    return jsonResponse(req, { text, model });
  } catch (error) {
    log("uncaught_error", error instanceof Error ? { message: error.message, stack: error.stack } : String(error));
    return jsonResponse(req, { error: "حدث خطأ أثناء تفريغ التسجيل." }, 500);
  }
});

