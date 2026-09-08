const _v = "2026-09-08-fix";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
const configuredOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

function log(label: string, data: unknown) {
  console.log(`[file-status v${_v}] ${label}:`, typeof data === "string" ? data : JSON.stringify(data));
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
    const r = await fetch(`${supabaseUrl}/rest/v1/rpc/check_code`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_code: code, p_device_id: deviceId }),
    });
    if (!r.ok) { log("auth_rpc_error", { status: r.status }); return false; }
    return Boolean((await r.json())?.valid);
  } catch (err) {
    log("auth_exception", err instanceof Error ? err.message : String(err));
    return false;
  }
}

Deno.serve(async (req) => {
  log("request", { method: req.method, origin: req.headers.get("Origin") ?? "" });

  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders(req) });

  try {
    const url = new URL(req.url);
    const name = url.searchParams.get("name");
    const code = (url.searchParams.get("code") ?? "").trim().toUpperCase();
    const deviceId = (url.searchParams.get("device_id") ?? "").trim();
    log("parsed", { name, code: code ? "set" : "empty", deviceId: deviceId ? "set" : "empty" });

    if (!await authorized(code, deviceId)) { log("auth_failed", { code }); return jsonResponse(req, { error: "التفعيل غير صالح." }, 403); }
    if (!name) return jsonResponse(req, { error: "missing name" }, 400);

    const upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/${name}?key=${encodeURIComponent(geminiKey)}`;
    log("upstream_call", { url: upstreamUrl });

    const upstream = await fetch(upstreamUrl);
    log("upstream_status", { status: upstream.status, ok: upstream.ok });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      log("upstream_error", { status: upstream.status, body: errText.slice(0, 500) });
      return jsonResponse(req, { error: "تعذر التحقق من حالة الملف." }, upstream.status);
    }

    return jsonResponse(req, await upstream.json().catch(() => ({ error: "invalid_response" })));
  } catch (err) {
    log("uncaught_error", err instanceof Error ? { message: err.message, stack: err.stack } : String(err));
    return jsonResponse(req, { error: "تعذر التحقق من حالة الملف." }, 500);
  }
});

