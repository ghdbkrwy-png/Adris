(function(){
  "use strict";
  const $ = UI.$;

  let notebooks = Store.loadNotebooks();
  let cfg = Store.loadCfg();
  const nb = Shared.loadNotebookOrRedirect(notebooks);
  if(!nb) return;

  UI.renderTopbar(nb);
  UI.renderTabnav("chat", nb.id);
  UI.mountModals();
  Shared.wireChrome(cfg, Store.saveCfg, {
    onTitleChange: (val) => { nb.name = val || nb.name; persist(); UI.renderTopbar(nb); }
  });

  $("send-btn").innerHTML = icon("send");

  function persist(){ Store.saveNotebooks(notebooks); }

  const SYSTEM_PROMPT = "أنت \"ادرس معي\"، مساعد قراءة ودراسة ذكي. جاوب فقط بالاعتماد على المصادر المرفقة معك بهذه المحادثة. " +
    "إذا كان الجواب غير موجود صراحة أو ضمنيًا بالمصادر، قل بوضوح إن المعلومة غير موجودة، ولا تختلق معلومات. " +
    "اقرأ الملفات كصور بصرية كاملة (نص، جداول، تخطيط) وليس فقط كنص مستخرج. جاوب بالعربية المبسّطة إلا إذا طلب المستخدم غير ذلك.";

  function buildContents(latestText){
    const parts = Shared.activeSourceParts(nb).concat([{ text: latestText }]);
    const contents = nb.chat.slice(0, -1).map(m => ({ role: m.role === "user" ? "user" : "model", parts:[{text:m.text}] }));
    contents.push({ role:"user", parts });
    return contents;
  }

  function renderChat(){
    if(nb.chat.length === 0) UI.renderChatEmpty((q) => { $("chat-input").value = q; sendMessage(); });
    else UI.renderChatHistory(nb.chat);
    UI.updateSelCount(nb);
  }

  const chatInput = $("chat-input");
  const sendBtn = $("send-btn");
  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
  });
  chatInput.addEventListener("keydown", (e) => { if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); sendMessage(); } });
  sendBtn.addEventListener("click", sendMessage);

  async function sendMessage(){
    const text = chatInput.value.trim();
    if(!text) return;
    if(!Shared.requireProxy(cfg)) return;

    if(nb.chat.length === 0) UI.renderChatHistory([]);
    nb.chat.push({ role:"user", text });
    UI.appendMsgEl("user", text);
    chatInput.value = ""; chatInput.style.height = "auto";
    persist();

    const bubble = UI.appendMsgEl("model", "");
    bubble.classList.add("streaming");
    sendBtn.disabled = true;
    try{
      const contents = buildContents(text);
      const full = await Gemini.streamGenerate("/api", SYSTEM_PROMPT, contents, (partial) => {
        bubble.textContent = partial;
        $("chat-scroll").scrollTop = $("chat-scroll").scrollHeight;
      });
      bubble.classList.remove("streaming");
      nb.chat.push({ role:"model", text: full });
      persist();
    }catch(err){
      bubble.classList.remove("streaming");
      bubble.textContent = "صار خطأ: " + (err.message || err);
    }finally{
      sendBtn.disabled = false;
    }
  }

  renderChat();
})();
