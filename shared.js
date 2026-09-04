// منطق مشترك بين كل الصفحات: القوالب المشتركة (topbar/tabnav/modals) بس منطقها هون،
// مو بملف ui.js (يلي المفروض يبقى عرض بس).
window.Shared = (function(){

  function getQueryNbId(){
    return new URLSearchParams(location.search).get("nb");
  }

  function loadNotebookOrRedirect(notebooks){
    const id = getQueryNbId();
    const nb = notebooks.find(n => n.id === id);
    if(!nb){ location.href = "index.html"; return null; }
    return nb;
  }

  // يُستدعى بكل صفحة بعد ما تُبنى الواجهة (topbar/tabnav/modals) — يوصل الأزرار المشتركة بمنطقها.
  function wireChrome(cfg, saveCfg, opts){
    opts = opts || {};

    const settingsBtn = document.getElementById("settings-btn");
    const proBtn = document.getElementById("pro-btn");
    const wbTitle = document.getElementById("wb-title");

    if(settingsBtn) settingsBtn.addEventListener("click", () => {
      applyThemeToModal(cfg.theme);
      UI.openModal("modal-settings");
    });
    document.getElementById("settings-close")?.addEventListener("click", () => UI.closeModal("modal-settings"));
    document.getElementById("theme-light-opt")?.addEventListener("click", () => setTheme("light"));
    document.getElementById("theme-dark-opt")?.addEventListener("click", () => setTheme("dark"));

    function applyThemeToModal(theme){
      document.getElementById("theme-light-opt")?.classList.toggle("active", theme === "light");
      document.getElementById("theme-dark-opt")?.classList.toggle("active", theme === "dark");
    }
    function setTheme(t){
      cfg.theme = t;
      saveCfg(cfg);
      document.documentElement.setAttribute("data-theme", t);
      applyThemeToModal(t);
    }

    if(proBtn) proBtn.addEventListener("click", () => UI.openModal("modal-pro"));
    document.getElementById("pro-close")?.addEventListener("click", () => UI.closeModal("modal-pro"));

    if(wbTitle && opts.onTitleChange){
      wbTitle.addEventListener("change", () => opts.onTitleChange(wbTitle.value.trim()));
    }
  }

  function requireProxy(cfg){ return true; }

  function activeSourceParts(nb){
    return nb.sources.filter(s => s.active && s.state === "ACTIVE" && s.uri)
      .map(s => ({ file_data: { mime_type: s.mimeType, file_uri: s.uri } }));
  }

  return { getQueryNbId, loadNotebookOrRedirect, wireChrome, requireProxy, activeSourceParts };
})();
