(function(){
  "use strict";
  const KEY = "adrisma3i_activation_v1";
  const DEVICE_KEY = "adrisma3i_installation_v1";
  const pendingClass = "auth-pending";
  document.documentElement.classList.add(pendingClass);

  function deviceId(){
    let value = localStorage.getItem(DEVICE_KEY);
    if(!value){ value = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(DEVICE_KEY, value); }
    return value;
  }
  function saved(){ try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } }
  function save(data){ localStorage.setItem(KEY, JSON.stringify(data)); }
  function showLoading(){
    const el = document.createElement("div"); el.id = "auth-loading"; el.textContent = "جاري التحقق من التفعيل...";
    document.documentElement.appendChild(el);
  }
  function stopLoading(){ document.documentElement.classList.remove(pendingClass); document.getElementById("auth-loading")?.remove(); }
  function redirect(message){
    if(message) sessionStorage.setItem("adrisma3i_activation_message", message);
    location.replace("index.html");
  }
  async function verify(){
    const record = saved();
    if(!record?.code) { redirect(); return false; }
    const response = await fetch(SUPABASE_FUNCTION("check-activation"), { method:"POST", headers:{ "Content-Type":"application/json", apikey:APP_CONFIG.SUPABASE_ANON_KEY }, body:JSON.stringify({ code:record.code, device_id:deviceId(), mode:"check" }) });
    const data = await response.json().catch(() => null);
    if(!response.ok || !data?.valid){ localStorage.removeItem(KEY); redirect(data?.message || "التفعيل غير صالح."); return false; }
    save({ code:record.code, expiresAt:data.expires_at, activatedAt:data.activated_at });
    stopLoading();
    return true;
  }
  window.AuthGuard = { KEY, DEVICE_KEY, deviceId, saved, save, verify, stopLoading };
  showLoading();
  verify().catch(() => redirect("تعذر الاتصال بالخادم."));
  setInterval(() => { if(document.visibilityState === "visible") verify().catch(() => {}); }, 60000);
  document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible") verify().catch(() => {}); });
})();
