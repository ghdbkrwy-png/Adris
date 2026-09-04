// دوال العرض فقط — الحالة والأحداث والـ API بملفات ثانية.
window.UI = (function(){
  const $ = (id) => document.getElementById(id);

  function escapeHtml(s){
    return (s||"").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function formatBytes(b){
    if(!b && b !== 0) return "";
    if(b < 1024) return b + " B";
    if(b < 1024*1024) return (b/1024).toFixed(0) + " KB";
    return (b/1024/1024).toFixed(1) + " MB";
  }
  function toast(msg, isErr){
    const wrap = $("toast-wrap");
    if(!wrap) return;
    const t = document.createElement("div");
    t.className = "toast" + (isErr ? " err" : "");
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(()=> t.remove(), 4200);
  }
  function openModal(id){ $(id).classList.remove("hidden"); }
  function closeModal(id){ $(id).classList.add("hidden"); }

  /* ================= Shell: topbar + tabnav (shared across every page) ================= */
  function renderTopbar(nb){
    const el = $("topbar");
    const brandInner = nb
      ? `${icon("brand")}`
      : `${icon("brand")}<span class="brand-name">${APP_CONFIG.APP_NAME}</span>`;
    el.innerHTML = `
      <a href="index.html" class="brand"><span class="brand-mark">${brandInner}</span></a>
      <div class="topbar-mid">${nb ? `<input id="wb-title" class="wb-title" value="${escapeHtml(nb.name)}" spellcheck="false">` : ``}</div>
      <div class="topbar-right">
        <button class="icon-btn" id="settings-btn" title="الإعدادات">${icon("settings")}</button>
        <button class="btn btn-gold" id="pro-btn">${icon("star")} مميز</button>
      </div>`;
  }

  function renderTabnav(activeTab, nbId){
    const el = $("tabnav");
    const root = $("page-root");
    if(!nbId){
      el.classList.add("hidden");
      if(root) root.classList.add("no-tabnav");
      return;
    }
    el.classList.remove("hidden");
    if(root) root.classList.remove("no-tabnav");
    const tabs = [
      { key:"sources", href:`sources.html?nb=${encodeURIComponent(nbId)}`, label:"المصادر", ic:"folder" },
      { key:"chat", href:`chat.html?nb=${encodeURIComponent(nbId)}`, label:"الشات", ic:"chat" },
      { key:"studio", href:`studio.html?nb=${encodeURIComponent(nbId)}`, label:"استوديو", ic:"studio" }
    ];
    el.innerHTML = tabs.map(t => `<a href="${t.href}" class="${t.key===activeTab?'active':''}">${icon(t.ic)}<span>${t.label}</span></a>`).join("");
  }

  function mountModals(){
    $("modals-mount").innerHTML = `
      <div class="modal-overlay hidden" id="modal-newnb">
        <div class="modal-box">
          <h3>دفتر جديد</h3>
          <div class="field"><label>اسم الدفتر</label><input type="text" id="newnb-name" placeholder="مثلاً: أبحاث الفصل الأول"></div>
          <div class="modal-actions"><button class="btn btn-ghost" id="newnb-cancel">إلغاء</button><button class="btn btn-accent" id="newnb-create">إنشاء</button></div>
        </div>
      </div>

      <div class="modal-overlay hidden" id="modal-settings">
        <div class="modal-box">
          <h3>${icon("settings")} الإعدادات</h3>
          <p class="desc">تفضيلات العرض فقط.</p>
          <div class="field">
            <label>المظهر</label>
            <div class="theme-row">
              <div class="theme-opt" id="theme-light-opt" data-theme="light">${icon("sun")}<span>فاتح</span></div>
              <div class="theme-opt" id="theme-dark-opt" data-theme="dark">${icon("moon")}<span>داكن</span></div>
            </div>
          </div>
          <div class="modal-actions"><button class="btn btn-accent" id="settings-close">تمام</button></div>
        </div>
      </div>


      <div class="modal-overlay hidden" id="modal-pro">
        <div class="modal-box">
          <h3>${icon("star")} النسخة المميزة — قريبًا</h3>
          <p class="desc">رح نضيف تدريجيًا: نظرة صوتية وشرح سلايدات أطول وبجودة أعلى، مساحة تخزين ومصادر غير محدودة، دفاتر مشتركة مع فريقك، وأولوية بالسرعة. هالنسخة التجريبية مجانية بالكامل حاليًا.</p>
          <div class="modal-actions"><button class="btn btn-accent" id="pro-close">تمام، أرجع للتطبيق</button></div>
        </div>
      </div>
    `;
    document.querySelectorAll(".modal-overlay").forEach(ov => {
      ov.addEventListener("click", (e) => { if(e.target === ov) ov.classList.add("hidden"); });
    });
  }

  /* ================= Home ================= */
  function showSetupBanner(){ }

  function renderHome(notebooks, hasKey, onOpen, onDelete, onNew){
    const grid = $("nb-grid");
    grid.innerHTML = "";
    const newCard = document.createElement("div");
    newCard.className = "nb-card nb-new";
    newCard.innerHTML = `${icon("plus")}<span style="font-size:12.5px;font-weight:600;">دفتر جديد</span>`;
    newCard.addEventListener("click", onNew);
    grid.appendChild(newCard);
    notebooks.slice().reverse().forEach(nb => {
      const card = document.createElement("div");
      card.className = "nb-card";
      card.innerHTML = `
        <div class="nb-icon">${icon("file")}</div>
        <h3>${escapeHtml(nb.name)}</h3>
        <div class="nb-meta">${nb.sources.length} مصدر · ${new Date(nb.createdAt).toLocaleDateString('ar')}</div>
        <div class="nb-del" title="حذف">${icon("trash")}</div>`;
      card.addEventListener("click", () => onOpen(nb.id));
      card.querySelector(".nb-del").addEventListener("click", (e) => { e.stopPropagation(); onDelete(nb); });
      grid.appendChild(card);
    });
  }

  /* ================= Sources ================= */
  function renderSources(nb, handlers){
    const list = $("src-list");
    list.innerHTML = "";
    if(nb.sources.length === 0){
      list.innerHTML = `<div class="empty-hint">لا مصادر بعد.<br>اضغط "إضافة مصدر" وارفع PDF — حتى لو كان ممسوحًا ضوئيًا، ادرس معي يقرأه كصورة بصرية كاملة، مو نص مستخرج.</div>`;
      updateSelCount(nb);
      return;
    }
    nb.sources.forEach(src => {
      const el = document.createElement("div");
      el.className = "src-item" + (src.active ? " active" : "");
      const uploading = src.state === "UPLOADING";
      const statusClass = src.state === "ERROR" ? "error" : (src.state !== "ACTIVE" ? "processing" : "");
      let statusText;
      if(uploading) statusText = `جارِ الرفع… ${src.progress||0}%`;
      else if(src.state === "PROCESSING") statusText = "جارِ التحضير…";
      else if(src.state === "ERROR") statusText = "فشلت القراءة";
      else statusText = formatBytes(src.sizeBytes);

      el.innerHTML = `
        <div class="src-check">${src.active ? icon("check") : ''}</div>
        <div class="src-icon">${(src.name.split('.').pop()||'F').slice(0,3).toUpperCase()}</div>
        <div class="src-text">
          <div class="src-name">${escapeHtml(src.name)}</div>
          <div class="src-status ${statusClass}">${statusText}</div>
        </div>
        <div class="src-del" title="حذف">${icon("close")}</div>
        ${uploading ? `<div class="src-progress-track"><div class="src-progress-fill" style="width:${src.progress||0}%"></div></div>` : ''}
      `;
      el.addEventListener("click", (e) => { if(!e.target.closest(".src-del")) handlers.onToggle(src); });
      el.querySelector(".src-del").addEventListener("click", (e) => { e.stopPropagation(); handlers.onDelete(src); });
      list.appendChild(el);
    });
    updateSelCount(nb);
  }
  function updateSelCount(nb){
    const el = $("sel-count");
    if(!el) return;
    const active = nb.sources.filter(s => s.active && s.state === "ACTIVE").length;
    el.textContent = active === 0 ? "لا مصادر مُفعّلة — الإجابات ستكون عامة" : `يستخدم ${active} مصدر مُفعّل`;
  }

  /* ================= Chat ================= */
  function renderChatEmpty(onSuggest){
    const chatScroll = $("chat-scroll");
    chatScroll.innerHTML = `
      <div class="chat-empty">
        <div class="brand-mark">${icon("brand")}</div>
        <h3>اسأل ادرس معي عن مصادرك</h3>
        <p>ارفع مصدرًا من تبويب المصادر، ورح يجاوبك بالاعتماد على محتواه فقط.</p>
        <div class="suggest-row">
          <div class="suggest-chip" data-q="لخّصلي المصادر المرفوعة بأسلوب مبسّط">لخّصلي المصادر</div>
          <div class="suggest-chip" data-q="شنو أهم 5 نقاط بهذا المستند؟">أهم 5 نقاط</div>
          <div class="suggest-chip" data-q="اشرحلي هذا الموضوع كأني ما أعرف فيه شي">اشرح ببساطة</div>
        </div>
      </div>`;
    chatScroll.querySelectorAll(".suggest-chip").forEach(c => c.addEventListener("click", () => onSuggest(c.dataset.q)));
  }
  function renderChatHistory(chat){
    const chatScroll = $("chat-scroll");
    chatScroll.innerHTML = "";
    chat.forEach(m => appendMsgEl(m.role, m.text));
    chatScroll.scrollTop = chatScroll.scrollHeight;
  }
  function appendMsgEl(role, text){
    const chatScroll = $("chat-scroll");
    const wrap = document.createElement("div");
    wrap.className = "chat-msg " + role;
    wrap.innerHTML = `<div class="msg-avatar">${role === "user" ? "أنت" : icon("brand")}</div><div class="msg-bubble">${escapeHtml(text)}</div>`;
    chatScroll.appendChild(wrap);
    chatScroll.scrollTop = chatScroll.scrollHeight;
    return wrap.querySelector(".msg-bubble");
  }

  /* ================= Studio / Notes ================= */
  function renderNotes(nb, handlers){
    const list = $("notes-list");
    list.innerHTML = "";
    if(nb.notes.length === 0){
      list.innerHTML = `<div class="empty-hint">استخدم أزرار فوق لتوليد ملخّص، نقاط رئيسية، نظرة صوتية، أو شرح بالسلايدات.</div>`;
      return;
    }
    nb.notes.forEach(n => {
      const card = document.createElement("div");
      card.className = "note-card";
      if(n.type === "audio"){
        card.innerHTML = `
          <span class="note-del">${icon("close")}</span>
          <h4>${icon("mic")} ${escapeHtml(n.title)}</h4>
          <div class="audio-player">
            <button class="audio-playbtn">${icon("play")}</button>
            <div class="audio-track"><div class="audio-track-fill"></div></div>
            <a class="audio-dl" download="podcast.wav">${icon("download")}</a>
          </div>
          <audio class="hidden" src="${n.audioUrl}"></audio>`;
        wireAudioCard(card, n.audioUrl);
      }else if(n.type === "slides"){
        card.innerHTML = `
          <span class="note-del">${icon("close")}</span>
          <h4>${icon("layers")} ${escapeHtml(n.title)}</h4>
          <div class="slides-note-foot">
            <span class="slides-count">${n.slides.length} شريحة</span>
            <button class="btn btn-accent btn-sm present-btn">${icon("play")} تشغيل العرض</button>
          </div>`;
        card.querySelector(".present-btn").addEventListener("click", () => handlers.onPresent(n));
      }else{
        card.innerHTML = `
          <span class="note-del">${icon("close")}</span>
          <h4>${escapeHtml(n.title)}</h4>
          <p>${escapeHtml(n.content)}</p>`;
      }
      card.querySelector(".note-del").addEventListener("click", () => handlers.onDelete(n));
      list.appendChild(card);
    });
  }

  function wireAudioCard(card, url){
    const audio = card.querySelector("audio");
    const playBtn = card.querySelector(".audio-playbtn");
    const track = card.querySelector(".audio-track");
    const fill = card.querySelector(".audio-track-fill");
    const dl = card.querySelector(".audio-dl");
    dl.href = url;
    playBtn.addEventListener("click", () => {
      if(audio.paused){ audio.play(); playBtn.innerHTML = icon("pause"); }
      else { audio.pause(); playBtn.innerHTML = icon("play"); }
    });
    audio.addEventListener("timeupdate", () => { if(audio.duration) fill.style.width = (audio.currentTime/audio.duration*100) + "%"; });
    audio.addEventListener("ended", () => { playBtn.innerHTML = icon("play"); });
    track.addEventListener("click", (e) => {
      const rect = track.getBoundingClientRect();
      const ratio = 1 - ((e.clientX - rect.left) / rect.width); // RTL
      if(audio.duration) audio.currentTime = Math.max(0, Math.min(1, ratio)) * audio.duration;
    });
  }

  return {
    $, escapeHtml, formatBytes, toast, openModal, closeModal,
    renderTopbar, renderTabnav, mountModals,
    renderHome, showSetupBanner,
    renderSources, updateSelCount,
    renderChatEmpty, renderChatHistory, appendMsgEl,
    renderNotes
  };
})();
