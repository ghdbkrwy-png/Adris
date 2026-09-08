const _v = "2026-09-08-fix";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
const configuredOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

function log(label: string, data: unknown) {
  console.log(`[upload-to-gemini v${_v}] ${label}:`, typeof data === "string" ? data : JSON.stringify(data));
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
    if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);
    if (!geminiKey) { log("config_error", "GEMINI_API_KEY missing"); return jsonResponse(req, { error: "خدمة الذكاء الاصطناعي غير مهيأة." }, 500); }

    const body = await req.json();
    const code = String(body.code ?? "").trim().toUpperCase();
    const deviceId = String(body.device_id ?? "").trim();
    log("parsed", { code: code ? "set" : "empty", deviceId: deviceId ? "set" : "empty", path: body.storage_path });

    if (!await authorized(code, deviceId)) { log("auth_failed", { code }); return jsonResponse(req, { error: "التفعيل غير صالح." }, 403); }

    const path = String(body.storage_path ?? "");
    const mimeType = String(body.mime_type ?? "application/octet-stream");
    if (!path) return jsonResponse(req, { error: "لم يتم تحديد الملف." }, 400);

    const fileUrl = `${supabaseUrl}/storage/v1/object/user-files/${path.split("/").map(encodeURIComponent).join("/")}`;
    log("storage_fetch", { url: fileUrl });

    const fileResponse = await fetch(fileUrl, { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } });
    log("storage_status", { status: fileResponse.status, ok: fileResponse.ok });

    if (!fileResponse.ok || !fileResponse.body) { log("storage_error", { status: fileResponse.status }); return jsonResponse(req, { error: "تعذر قراءة الملف المرفوع." }, 502); }

    const startUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(geminiKey)}`;
    log("gemini_upload_start", { url: startUrl });

    const start = await fetch(startUrl, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(body.size_bytes ?? 0),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: body.file_name ?? "file" } }),
    });

    log("start_status", { status: start.status, ok: start.ok });

    if (!start.ok) {
      const errText = await start.text().catch(() => "");
      log("start_error", { status: start.status, body: errText.slice(0, 500) });
      return jsonResponse(req, { error: "تعذر بدء رفع الملف إلى خدمة الذكاء الاصطناعي." }, 502);
    }

    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (!uploadUrl) { log("no_upload_url", "x-goog-upload-url header missing"); return jsonResponse(req, { error: "تعذر إنشاء رابط الرفع." }, 502); }

    log("gemini_upload_finalize", { url: uploadUrl.slice(0, 80) + "..." });

    const uploaded = await fetch(uploadUrl, {
      method: "POST",
      headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize", "Content-Type": mimeType },
      body: fileResponse.body,
      duplex: "half",
    });

    log("finalize_status", { status: uploaded.status, ok: uploaded.ok });

    const data = await uploaded.json().catch(() => null);
    if (!uploaded.ok) {
      const errText = await uploaded.text().catch(() => "");
      log("finalize_error", { status: uploaded.status, body: errText.slice(0, 500) });
      return jsonResponse(req, { error: "تعذر رفع الملف إلى خدمة الذكاء الاصطناعي." }, 502);
    }

    log("success", { file: data?.file ?? "no_file" });
    return jsonResponse(req, data);
  } catch (err) {
    log("uncaught_error", err instanceof Error ? { message: err.message, stack: err.stack } : String(err));
    return jsonResponse(req, { error: "حدث خطأ أثناء رفع الملف." }, 500);
  }
});
