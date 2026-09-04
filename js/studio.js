(function(){
  "use strict";
  const $ = UI.$;

  let notebooks = Store.loadNotebooks();
  let cfg = Store.loadCfg();
  const nb = Shared.loadNotebookOrRedirect(notebooks);
  if(!nb) return;

  UI.renderTopbar(nb);
  UI.renderTabnav("studio", nb.id);
  UI.mountModals();
  Shared.wireChrome(cfg, Store.saveCfg, {
    onTitleChange: (val) => { nb.name = val || nb.name; persist(); UI.renderTopbar(nb); }
  });

  function persist(){ Store.saveNotebooks(notebooks); }

  const SYSTEM_PROMPT = "أنت \"ادرس معي\"، مساعد قراءة ودراسة ذكي. جاوب فقط بالاعتماد على المصادر المرفقة معك بهذه المحادثة.";

  $("studio-actions").innerHTML = `
    <button class="studio-action" data-action="summary">${icon("summary","a-icon")} ملخّص المصادر</button>
    <button class="studio-action" data-action="faq">${icon("faq","a-icon")} أسئلة شائعة</button>
    <button class="studio-action" data-action="keypoints">${icon("keypoints","a-icon")} أهم النقاط</button>
    <button class="studio-action" data-action="podcast">${icon("mic","a-icon")} نظرة صوتية<span class="beta-badge">تجريبي</span></button>
    <button class="studio-action" data-action="slides" style="grid-column:1/-1;">${icon("layers","a-icon")} شرح بالسلايدات (صوت لكل شريحة)<span class="beta-badge">تجريبي</span></button>
  `;

  $("studio-actions").addEventListener("click", (e) => {
    const btn = e.target.closest(".studio-action");
    if(btn) runStudioAction(btn.dataset.action, btn);
  });

  const STUDIO_PROMPTS = {
    summary: { title:"ملخّص المصادر", prompt:"لخّص كل المصادر المُفعّلة بشكل منظم وواضح، بفقرات قصيرة." },
    faq: { title:"أسئلة شائعة", prompt:"استخرج من المصادر المُفعّلة أهم 6 أسئلة متوقعة مع إجاباتها المختصرة، بصيغة سؤال وجواب." },
    keypoints: { title:"أهم النقاط", prompt:"استخرج أهم النقاط الرئيسية من المصادر المُفعّلة كقائمة نقطية مرتبة حسب الأهمية." }
  };

  async function runStudioAction(action, btn){
    if(!Shared.requireProxy(cfg)) return;
    const parts = Shared.activeSourceParts(nb);
    if(parts.length === 0){ UI.toast("فعّل مصدر واحد على الأقل من تبويب المصادر أولًا", true); return; }

    if(action === "podcast") return runPodcast(parts, btn);
    if(action === "slides") return runSlides(parts, btn);

    const conf = STUDIO_PROMPTS[action];
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.textContent = "جارِ التحضير…";
    try{
      const contents = [{ role:"user", parts: parts.concat([{text: conf.prompt}]) }];
      const full = await Gemini.streamGenerate("/api", SYSTEM_PROMPT, contents, null);
      nb.notes.unshift({ id: Store.uid(), type:"text", title: conf.title, content: full, createdAt: Date.now() });
      persist(); renderNotes();
      UI.toast(`تمت إضافة "${conf.title}" للملاحظات`);
    }catch(err){
      UI.toast("صار خطأ: " + (err.message||err), true);
    }finally{
      btn.disabled = false; btn.innerHTML = orig;
    }
  }

  async function runPodcast(parts, btn){
    btn.disabled = true;
    const orig = btn.innerHTML;
    try{
      const result = await Gemini.generatePodcast("/api", parts, (stage) => {
        btn.textContent = stage === "audio" ? "جارِ توليد الصوت…" : "جارِ كتابة النص…";
      });
      nb.notes.unshift({ id: Store.uid(), type:"audio", title:"نظرة صوتية", audioUrl: result.url, content: result.script, createdAt: Date.now() });
      persist(); renderNotes();
      UI.toast("النظرة الصوتية جاهزة");
    }catch(err){
      UI.toast("تعذّر توليد الصوت: " + (err.message||err), true);
    }finally{
      btn.disabled = false; btn.innerHTML = orig;
    }
  }

  async function runSlides(parts, btn){
    btn.disabled = true;
    const orig = btn.innerHTML;
    try{
      const result = await Gemini.generateSlideDeck("/api", parts, (p) => {
        btn.textContent = p.stage === "outline" ? "جارِ إعداد مخطط الشرائح…" : `جارِ توليد صوت الشريحة ${p.index} من ${p.total}…`;
      });
      nb.notes.unshift({ id: Store.uid(), type:"slides", title:"شرح بالسلايدات", slides: result.slides, createdAt: Date.now() });
      persist(); renderNotes();
      UI.toast(`جاهز! ${result.slides.length} شريحة بصوت مستقل لكل وحدة`);
    }catch(err){
      UI.toast("تعذّر إعداد الشرائح: " + (err.message||err), true);
    }finally{
      btn.disabled = false; btn.innerHTML = orig;
    }
  }

  function renderNotes(){
    UI.renderNotes(nb, {
      onDelete: (n) => { nb.notes = nb.notes.filter(x => x.id !== n.id); persist(); renderNotes(); },
      onPresent: (n) => openPresentation(n)
    });
  }

  /* ---------- Slide presentation overlay ---------- */
  function openPresentation(note){
    const slides = note.slides;
    const overlay = $("slide-present");
    let idx = 0;

    function renderSlide(autoplay){
      const s = slides[idx];
      overlay.innerHTML = `
        <div class="slide-box">
          <div class="slide-top">
            <span class="slide-count">${idx+1} / ${slides.length}</span>
            <button class="icon-btn" id="slide-close">${icon("close")}</button>
          </div>
          <div class="slide-body">
            <h3>${UI.escapeHtml(s.title)}</h3>
            <ul>${s.bullets.map(b => `<li>${UI.escapeHtml(b)}</li>`).join("")}</ul>
          </div>
          <div class="slide-controls">
            <button class="slide-navbtn" id="slide-back" ${idx===0?"disabled":""} title="السابقة">${icon("chevronNext")}</button>
            <button class="slide-playbtn" id="slide-play" ${!s.audioUrl?"disabled":""} title="تشغيل">${icon("play")}</button>
            <div class="slide-progress"><div class="slide-progress-fill" id="slide-progress-fill"></div></div>
            <button class="slide-navbtn" id="slide-fwd" ${idx===slides.length-1?"disabled":""} title="التالية">${icon("chevronPrev")}</button>
          </div>
        </div>
        <audio id="slide-audio" class="hidden" ${s.audioUrl?`src="${s.audioUrl}"`:""}></audio>
      `;
      const audio = $("slide-audio");
      const fill = $("slide-progress-fill");
      audio.addEventListener("timeupdate", () => { if(audio.duration) fill.style.width = (audio.currentTime/audio.duration*100) + "%"; });
      audio.addEventListener("ended", () => {
        const playBtn = $("slide-play");
        if(playBtn) playBtn.innerHTML = icon("play");
        if(idx < slides.length - 1) goTo(idx+1, true);
      });
      if(autoplay && s.audioUrl){ audio.play().catch(()=>{}); $("slide-play").innerHTML = icon("pause"); }
    }

    function goTo(newIdx, autoplay){
      idx = Math.max(0, Math.min(slides.length-1, newIdx));
      renderSlide(!!autoplay);
    }

    function handleClick(e){
      if(e.target === overlay){ close(); return; }
      if(e.target.closest("#slide-close")){ close(); return; }
      if(e.target.closest("#slide-fwd")){ goTo(idx+1, isPlaying()); return; }
      if(e.target.closest("#slide-back")){ goTo(idx-1, isPlaying()); return; }
      if(e.target.closest("#slide-play")){ togglePlay(); return; }
    }
    function isPlaying(){ const a = $("slide-audio"); return !!(a && !a.paused && a.currentTime > 0); }
    function togglePlay(){
      const a = $("slide-audio"); const btn = $("slide-play");
      if(!a || !a.src) return;
      if(a.paused){ a.play(); btn.innerHTML = icon("pause"); }
      else { a.pause(); btn.innerHTML = icon("play"); }
    }
    function close(){
      const a = $("slide-audio"); if(a) a.pause();
      overlay.classList.add("hidden");
      overlay.innerHTML = "";
      overlay.removeEventListener("click", handleClick);
    }

    overlay.addEventListener("click", handleClick);
    overlay.classList.remove("hidden");
    renderSlide(false);
  }

  renderNotes();
})();
