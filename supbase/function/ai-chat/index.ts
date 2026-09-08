const _v = "2026-09-08-fix-2";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
const rawModel = Deno.env.get("GEMINI_TEXT_MODEL") ?? "";
const normalizedModel = rawModel.replace(/^models\//, "").replace(/^['\"]|['\"]$/g, "").trim();
const supportedModels = new Set(["gemini-3.6-flash", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"]);
const model = supportedModels.has(normalizedModel) ? normalizedModel : "gemini-3.6-flash";
log("model_config", { configured: Boolean(rawModel), normalized: normalizedModel, selected: model });
const configuredOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

function log(label: string, data: unknown) {
  console.log(`[ai-chat v${_v}] ${label}:`, typeof data === "string" ? data : JSON.stringify(data));
}

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  let allowedOrigin = "*";
  if (configuredOrigin === "*") {
    allowedOrigin = origin || "*";
  } else if (origin === configuredOrigin || origin === "http://localhost:5173" || origin === "http://127.0.0.1:5173") {
    allowedOrigin = origin;
  } else {
    allowedOrigin = configuredOrigin;
  }
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
    const result = await fetch(`${supabaseUrl}/rest/v1/rpc/check_code`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_code: code, p_device_id: deviceId }),
    });
    if (!result.ok) { log("auth_rpc_error", { status: result.status }); return false; }
    const data = await result.json();
    return Boolean(data?.valid);
  } catch (err) {
    log("auth_exception", err instanceof Error ? err.message : String(err));
    return false;
  }
}

Deno.serve(async (req) => {
  log("request", { method: req.method, origin: req.headers.get("Origin") ?? "" });

  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders(req) });

  try {
    if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

    if (!geminiKey) { log("config_error", "GEMINI_API_KEY missing"); return jsonResponse(req, { error: "خدمة الذكاء الاصطناعي غير مهيأة — مفتاح API غير موجود." }, 500); }
    if (!supabaseUrl || !serviceKey) { log("config_error", "SUPABASE_URL or SERVICE_ROLE_KEY missing"); return jsonResponse(req, { error: "إعدادات الخادم غير مكتملة." }, 500); }

    const body = await req.json();
    const code = String(body.code ?? "").trim().toUpperCase();
    const deviceId = String(body.device_id ?? "").trim();
    log("parsed", { code: code ? "set" : "empty", deviceId: deviceId ? "set" : "empty", model });

    if (!await authorized(code, deviceId)) { log("auth_failed", { code }); return jsonResponse(req, { error: "التفعيل غير صالح." }, 403); }

    const upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(geminiKey)}`;
    log("upstream_call", { url: upstreamUrl, model });

    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: body.contents,
        systemInstruction: body.systemInstruction ? { parts: [{ text: body.systemInstruction }] } : undefined,
        generationConfig: { temperature: 0.4 },
      }),
    });

    log("upstream_status", { status: upstream.status, ok: upstream.ok });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      log("upstream_error", { status: upstream.status, body: errText.slice(0, 500) });
      let message = "حدث خطأ في خدمة الذكاء الاصطناعي.";
      try { const errJson = JSON.parse(errText); if (errJson?.error?.message) message = errJson.error.message; } catch {}
      return jsonResponse(req, { error: message, upstream_status: upstream.status }, upstream.status);
    }

    return new Response(upstream.body, { status: upstream.status, headers: { ...corsHeaders(req), "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  } catch (err) {
    log("uncaught_error", err instanceof Error ? { message: err.message, stack: err.stack } : String(err));
    return jsonResponse(req, { error: "حدث خطأ أثناء معالجة الطلب." }, 500);
  }
});

