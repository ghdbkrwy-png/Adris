// إدارة الحالة المحلية (localStorage) — دفاتر المستخدم وتفضيلات العرض.
window.Store = (function(){
  const LS_NOTEBOOKS = "adrisma3i_notebooks_v1";
  const LS_CFG = "adrisma3i_cfg_v1";

  function loadNotebooks(){
    try{ return JSON.parse(localStorage.getItem(LS_NOTEBOOKS)) || []; }catch(e){ return []; }
  }
  function saveNotebooks(nbs){ localStorage.setItem(LS_NOTEBOOKS, JSON.stringify(nbs)); }

  function loadCfg(){
    let saved = {};
    try{ saved = JSON.parse(localStorage.getItem(LS_CFG)) || {}; }catch(e){}
    return Object.assign({
      theme: matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? "dark" : "light"
    }, saved);
  }
  function saveCfg(cfg){ localStorage.setItem(LS_CFG, JSON.stringify(cfg)); }

  function uid(){ return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

  return { loadNotebooks, saveNotebooks, loadCfg, saveCfg, uid };
})();
