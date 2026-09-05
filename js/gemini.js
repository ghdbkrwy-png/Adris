// كل التعامل مع الذكاء الاصطناعي — بس هالمرة بدون ما يشوف المتصفح مفتاح API إطلاقًا.
// كل طلب يروح لخادم API الآمن على Vercel يلي يحمل المفتاح باسم متغيرات بيئة،
// رفع الملف نفسه يمر عبر Vercel حتى ما يعتمد المتصفح على CORS الخاص بـGoogle.
window.Gemini = (function(){

  /* ---------- 1) رفع الملف عبر Vercel بدون كشف المفتاح ---------- */

  function uploadBytesWithProgress(proxyBase, file, onProgress){
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${proxyBase}/upload`, true);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
      xhr.setRequestHeader("X-File-Size", String(file.size));
      xhr.upload.onprogress = (e) => {
        if(e.lengthComputable && onProgress) onProgress(Math.round((e.loaded/e.total)*100));
      };
      xhr.onload = () => {
        if(xhr.status >= 200 && xhr.status < 300){
          try{
            const data = JSON.parse(xhr.responseText);
            if(data.file) resolve(data.file);
            else reject(new Error("رد غير متوقع من رفع الملف"));
          }catch(e){ reject(new Error("رد غير متوقع من الرفع")); }
        }else{
          reject(new Error("فشل رفع الملف (" + xhr.status + "): " + xhr.responseText.slice(0,200)));
        }
      };
      xhr.onerror = () => reject(new Error("انقطع الاتصال أثناء الرفع"));
      xhr.send(file);
    });
  }

  async function uploadSource(proxyBase, file, onProgress){
    return uploadBytesWithProgress(proxyBase, file, onProgress);
  }

  async function pollUntilActive(proxyBase, fileApiName, onState){
    for(let i=0;i<15;i++){
      const res = await fetch(`${proxyBase}/file-status?name=${encodeURIComponent(fileApiName)}`);
      if(!res.ok) break;
      const data = await res.json();
      if(onState) onState(data.state);
      if(data.state === "ACTIVE" || data.state === "FAILED") return data.state;
      await new Promise(r => setTimeout(r, 1000));
    }
    return "ACTIVE";
  }

  /* ---------- 2) المحادثة النصية (streaming عبر الوسيط) ---------- */

  function parseProxyError(text, status){
    try{
      const o = JSON.parse(text);
      if(o?.error) return typeof o.error === "string" ? o.error : (o.error.message || JSON.stringify(o.error));
    }catch(e){}
    if(status === 404) return "ما قدرنا نوصل إلى API الآمن على Vercel";
    if(status === 500) return "خطأ بخادم Gemini — تأكد إن GEMINI_API_KEY مضاف صح بمتغيرات Vercel";
    return "خطأ (" + status + ")";
  }

  async function streamGenerate(proxyBase, systemInstruction, contents, onChunk){
    const res = await fetch(`${proxyBase}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemInstruction, contents })
    });
    if(!res.ok){ const t = await res.text(); throw new Error(parseProxyError(t, res.status)); }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "", full = "";
    while(true){
      const { done, value } = await reader.read();
      if(done) break;
      buf += decoder.decode(value, {stream:true});
      const lines = buf.split("\n");
      buf = lines.pop();
      for(const line of lines){
        const t = line.trim();
        if(!t.startsWith("data:")) continue;
        const j = t.slice(5).trim();
        if(!j || j === "[DONE]") continue;
        try{
          const obj = JSON.parse(j);
          const piece = obj?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("") || "";
          full += piece;
          if(onChunk) onChunk(full);
        }catch(e){}
      }
    }
    return full || "(لم يصل رد)";
  }

  /* ---------- 3) الصوت (عبر الوسيط أيضًا) ---------- */

  async function callTTS(proxyBase, prompt, speechConfig){
    const res = await fetch(`${proxyBase}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, speechConfig })
    });
    if(!res.ok){ const t = await res.text(); throw new Error(parseProxyError(t, res.status)); }
    const data = await res.json();
    const part = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData || p.inline_data);
    const inline = part && (part.inlineData || part.inline_data);
    if(!inline || !inline.data) throw new Error("ما رجع الموديل مقطع صوتي — جرّب مرة ثانية");
    const mime = inline.mimeType || inline.mime_type || "audio/L16;rate=24000";
    const rateMatch = /rate=(\d+)/.exec(mime);
    const sampleRate = rateMatch ? parseInt(rateMatch[1],10) : 24000;
    return { base64: inline.data, sampleRate };
  }

  function generateSpeechFromScript(proxyBase, scriptText){
    const prompt = "حوّل الحوار التالي بين سارة ووليد إلى صوت بنبرة طبيعية وودودة، كل متحدث بصوته:\n\n" + scriptText;
    return callTTS(proxyBase, prompt, {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: [
          { speaker: "سارة", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
          { speaker: "وليد", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } }
        ]
      }
    });
  }

  function generateSingleVoiceSpeech(proxyBase, text, voiceName){
    const prompt = "اقرأ النص التالي بصوت راوٍ واضح وهادئ ومناسب لعرض تعليمي:\n\n" + text;
    return callTTS(proxyBase, prompt, { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName || "Kore" } } });
  }

  function pcmBase64ToWavBlob(base64, sampleRate){
    const binary = atob(base64);
    const len = binary.length;
    const pcm = new Uint8Array(len);
    for(let i=0;i<len;i++) pcm[i] = binary.charCodeAt(i);
    const numChannels = 1, bitDepth = 16;
    const blockAlign = numChannels * (bitDepth/8);
    const byteRate = sampleRate * blockAlign;
    const buffer = new ArrayBuffer(44 + pcm.length);
    const view = new DataView(buffer);
    const ws = (off, str) => { for(let i=0;i<str.length;i++) view.setUint8(off+i, str.charCodeAt(i)); };
    ws(0,"RIFF"); view.setUint32(4, 36+pcm.length, true); ws(8,"WAVE");
    ws(12,"fmt "); view.setUint32(16,16,true); view.setUint16(20,1,true);
    view.setUint16(22,numChannels,true); view.setUint32(24,sampleRate,true);
    view.setUint32(28,byteRate,true); view.setUint16(32,blockAlign,true); view.setUint16(34,bitDepth,true);
    ws(36,"data"); view.setUint32(40, pcm.length, true);
    new Uint8Array(buffer, 44).set(pcm);
    return new Blob([buffer], { type: "audio/wav" });
  }

  /* ---------- 4) النظرة الصوتية (بودكاست بمتحدثين) ---------- */

  const PODCAST_SYSTEM = "أنت كاتب سيناريو بودكاست. اكتب حوار قصير طبيعي بين متحدثين، سارة ووليد، " +
    "يناقشان محتوى المصادر المرفقة بأسلوب ودّي ومبسّط وكأنهما يشرحان الموضوع لمستمع لأول مرة. " +
    "شرط مهم: لا تتجاوز 10 إلى 12 سطر حوار متبادل بالمجموع (النسخة الحالية تجريبية ومحدودة الطول). " +
    "كل سطر يبدأ باسم المتحدث متبوعًا بنقطتين تمامًا هكذا:\nسارة: ...\nوليد: ...\n" +
    "ابدأ بترحيب قصير واختم بخلاصة قصيرة. لا تكتب أي شيء خارج صيغة الحوار.";

  async function generatePodcastScript(proxyBase, activeSourceParts){
    const contents = [{ role:"user", parts: [...activeSourceParts, {text:"اكتب حوار البودكاست الآن."}] }];
    return streamGenerate(proxyBase, PODCAST_SYSTEM, contents, null);
  }

  async function generatePodcast(proxyBase, activeSourceParts, onStage){
    if(onStage) onStage("script");
    const script = await generatePodcastScript(proxyBase, activeSourceParts);
    if(onStage) onStage("audio");
    const { base64, sampleRate } = await generateSpeechFromScript(proxyBase, script);
    const blob = pcmBase64ToWavBlob(base64, sampleRate);
    return { script, url: URL.createObjectURL(blob) };
  }

  /* ---------- 5) شرح بالسلايدات — كل شريحة بصوت مستقل ---------- */

  const SLIDES_SYSTEM = "أنت مصمم عروض تقديمية تعليمية. بناءً على المصادر المرفقة، جهّز عرض شرائح مبسّط. " +
    "أرجع فقط مصفوفة JSON صالحة بدون أي نص أو شرح أو Markdown حولها، بالضبط بهذا الشكل:\n" +
    '[{"title":"عنوان الشريحة","bullets":["نقطة 1","نقطة 2","نقطة 3"],"narration":"جملتان أو ثلاث جمل بصيغة طبيعية للتحدث بصوت عالٍ تشرح الشريحة"}]\n' +
    "الحد الأدنى 4 شرائح، الحد الأقصى 12 شريحة. كل bullets لا يتجاوز 4 نقاط قصيرة. أول شريحة مقدمة، آخر شريحة خلاصة.";

  function extractJsonArray(text){
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if(start === -1 || end === -1 || end < start) throw new Error("رد النموذج ما كان بصيغة JSON متوقعة");
    return JSON.parse(text.slice(start, end+1));
  }

  async function generateSlidesOutline(proxyBase, activeSourceParts){
    const contents = [{ role:"user", parts: activeSourceParts.concat([{text:"جهّز عرض الشرائح الآن."}]) }];
    const raw = await streamGenerate(proxyBase, SLIDES_SYSTEM, contents, null);
    const arr = extractJsonArray(raw);
    if(!Array.isArray(arr) || arr.length === 0) throw new Error("ما قدر النموذج يجهّز شرائح من هالمصادر");
    return arr.slice(0, 12).map(s => ({
      title: String(s.title || "بدون عنوان"),
      bullets: Array.isArray(s.bullets) ? s.bullets.map(String).slice(0,5) : [],
      narration: String(s.narration || s.title || "")
    }));
  }

  async function generateSlideDeck(proxyBase, activeSourceParts, onProgress){
    if(onProgress) onProgress({ stage:"outline" });
    const outline = await generateSlidesOutline(proxyBase, activeSourceParts);
    const slides = [];
    for(let i=0;i<outline.length;i++){
      if(onProgress) onProgress({ stage:"audio", index:i+1, total:outline.length });
      const s = outline[i];
      let audioUrl = null;
      try{
        const { base64, sampleRate } = await generateSingleVoiceSpeech(proxyBase, s.narration, "Kore");
        audioUrl = URL.createObjectURL(pcmBase64ToWavBlob(base64, sampleRate));
      }catch(e){ /* شريحة وحدة تفشل ما توقف الباقي */ }
      slides.push({ title:s.title, bullets:s.bullets, narration:s.narration, audioUrl });
    }
    return { slides };
  }

  return {
    uploadSource, pollUntilActive,
    streamGenerate,
    generatePodcast,
    generateSlideDeck
  };
})();
