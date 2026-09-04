(function(){
  "use strict";
  const $ = UI.$;

  let notebooks = Store.loadNotebooks();
  let cfg = Store.loadCfg();
  const nb = Shared.loadNotebookOrRedirect(notebooks);
  if(!nb) return;

  UI.renderTopbar(nb);
  UI.renderTabnav("sources", nb.id);
  UI.mountModals();
  Shared.wireChrome(cfg, Store.saveCfg, {
    onTitleChange: (val) => { nb.name = val || nb.name; persist(); UI.renderTopbar(nb); }
  });

  $("src-add-btn").innerHTML = icon("plus") + " إضافة مصدر";

  function persist(){ Store.saveNotebooks(notebooks); }
  function render(){ UI.renderSources(nb, { onToggle, onDelete }); }

  function onToggle(src){ src.active = !src.active; persist(); render(); }
  function onDelete(src){ nb.sources = nb.sources.filter(s => s.id !== src.id); persist(); render(); }

  $("src-add-btn").addEventListener("click", () => {
    if(!Shared.requireProxy(cfg)) return;
    $("file-input").click();
  });
  $("file-input").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    for(const f of files){ await addSource(f); }
  });

  async function addSource(file){
    const src = { id: Store.uid(), name: file.name, mimeType: file.type || "application/pdf",
                  sizeBytes: file.size, state: "UPLOADING", progress: 0, uri: null, fileApiName: null, active: true };
    nb.sources.push(src);
    persist(); render();
    try{
      const fileObj = await Gemini.uploadSource("/api", file, (pct) => { src.progress = pct; render(); });
      src.uri = fileObj.uri;
      src.fileApiName = fileObj.name;
      src.state = fileObj.state || "PROCESSING";
      persist(); render();

      const finalState = await Gemini.pollUntilActive("/api", src.fileApiName, (state) => { src.state = state; persist(); render(); });
      src.state = finalState === "FAILED" ? "ERROR" : "ACTIVE";
      persist(); render();
      UI.toast(`تمت إضافة "${file.name}" بنجاح`);
    }catch(err){
      console.error(err);
      src.state = "ERROR";
      persist(); render();
      UI.toast(`تعذّرت قراءة "${file.name}": ${err.message || err}`, true);
    }
  }

  render();
})();
