const functionVersion = "2026-09-08";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const configuredOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

function log(label: string, data: unknown) {
  console.log(`[check-activation v${functionVersion}] ${label}:`, JSON.stringify(data));
}

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  let allowedOrigin = "*";
  if (configuredOrigin === "*") {
    allowedOrigin = origin || "*";
  } else if (origin === configuredOrigin) {
    allowedOrigin = origin;
  } else if (origin === "http://localhost:5173" || origin === "http://127.0.0.1:5173") {
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
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  log("request", { method: req.method, origin });

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders(req) });
  }

  try {
    if (req.method !== "POST") {
      log("rejected", { reason: "method_not_allowed", method: req.method });
      return jsonResponse(req, { success: false, error: "method_not_allowed", message: "طريقة الطلب غير مدعومة." }, 405);
    }

    if (!supabaseUrl || !serviceKey) {
      log("config_error", { supabaseUrl: supabaseUrl ? "set" : "missing", serviceKey: serviceKey ? "set" : "missing" });
      return jsonResponse(req, { success: false, error: "server_config_missing", message: "إعدادات الخادم غير مكتملة." }, 500);
    }

    const rawBody = await req.text();
    log("raw_body", rawBody.slice(0, 200));

    let body: { code?: string; device_id?: string; mode?: string };
    try {
      body = JSON.parse(rawBody);
    } catch {
      log("parse_error", { raw: rawBody.slice(0, 200) });
      return jsonResponse(req, { success: false, error: "invalid_json", message: "تنسيق الطلب غير صالح." }, 400);
    }

    const code = String(body.code ?? "").trim().toUpperCase();
    const deviceId = String(body.device_id ?? "").trim();
    const mode = body.mode === "check" ? "check_code" : "activate_code";

    log("parsed", { code, deviceId: deviceId ? "set" : "empty", mode });

    if (!code || !deviceId) {
      log("validation_failed", { code: !!code, deviceId: !!deviceId });
      return jsonResponse(req, { success: false, valid: false, error: "missing_fields", message: "أدخل الكود وحاول مرة أخرى." }, 400);
    }

    const rpcUrl = `${supabaseUrl}/rest/v1/rpc/${mode}`;
    log("rpc_call", { url: rpcUrl, mode });

    const rpcResponse = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        "Content-Profile": "public",
      },
      body: JSON.stringify({ p_code: code, p_device_id: deviceId }),
    });

    log("rpc_status", { status: rpcResponse.status, ok: rpcResponse.ok });

    const rpcText = await rpcResponse.text();
    log("rpc_response", rpcText.slice(0, 500));

    let rpcData: unknown = null;
    try {
      rpcData = JSON.parse(rpcText);
    } catch {
      log("rpc_parse_failed", { text: rpcText.slice(0, 200) });
    }

    if (!rpcResponse.ok) {
      log("rpc_error", { status: rpcResponse.status, body: rpcText.slice(0, 300) });
      return jsonResponse(req, { success: false, valid: false, error: "database_error", message: "تعذر التحقق من التفعيل من قاعدة البيانات." }, 502);
    }

    const result = (rpcData ?? {}) as Record<string, unknown>;
    log("final_result", result);

    return jsonResponse(req, { success: true, ...result });
  } catch (err) {
    log("uncaught_error", { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
    return jsonResponse(req, { success: false, valid: false, error: "server_error", message: "حدث خطأ غير متوقع في الخادم." }, 500);
  }
});
