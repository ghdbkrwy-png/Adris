(function(){
  "use strict";
  const $ = UI.$;

  let notebooks = Store.loadNotebooks();
  let cfg = Store.loadCfg();

  UI.renderTopbar(null);
  UI.renderTabnav(null, null);
  UI.mountModals();
  Shared.wireChrome(cfg, Store.saveCfg, { onCfgSaved: () => render() });

  $("home-tagline").textContent = APP_CONFIG.APP_TAGLINE + "، حتى لو كانت ممسوحة ضوئيًا أو غير مرتبة.";

  function render(){
    UI.renderHome(notebooks, true, openNotebook, deleteNotebook, openNewNbModal);
  }

  function openNotebook(id){ location.href = `chat.html?nb=${encodeURIComponent(id)}`; }

  function deleteNotebook(nb){
    if(!confirm(`حذف دفتر "${nb.name}"؟`)) return;
    notebooks = notebooks.filter(x => x.id !== nb.id);
    Store.saveNotebooks(notebooks);
    render();
  }

  function openNewNbModal(){
    $("newnb-name").value = "";
    UI.openModal("modal-newnb");
    $("newnb-name").focus();
  }
  $("newnb-cancel").addEventListener("click", () => UI.closeModal("modal-newnb"));
  $("newnb-create").addEventListener("click", () => {
    const name = $("newnb-name").value.trim() || "دفتر بدون اسم";
    const nb = { id: Store.uid(), name, createdAt: Date.now(), sources: [], notes: [], chat: [] };
    notebooks.push(nb);
    Store.saveNotebooks(notebooks);
    UI.closeModal("modal-newnb");
    openNotebook(nb.id);
  });
  $("newnb-name").addEventListener("keydown", (e) => { if(e.key === "Enter") $("newnb-create").click(); });

  render();
})();
