window.Gemini = (function(){
  "use strict";
  function activation(){ const saved = AuthGuard.saved(); if(!saved?.code) throw new Error("التفعيل غير صالح."); return { code:saved.code, device_id:AuthGuard.deviceId() }; }
  function authHeaders(extra){
    return Object.assign({ "Content-Type":"application/json", apikey:APP_CONFIG.SUPABASE_ANON_KEY, Authorization:"Bearer " + APP_CONFIG.SUPABASE_ANON_KEY }, extra || {});
  }
  function errorMessage(data, status){ if(data?.error) return String(data.error); if(status === 403) return "التفعيل غير صالح."; return "حدث خطأ في خدمة الذكاء الاصطناعي."; }
  async function uploadSource(_base, file, onProgress){
    const auth = activation(); const path = `${auth.device_id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
    const upload = await fetch(`${APP_CONFIG.SUPABASE_URL}/storage/v1/object/user-files/${encodeURIComponent(path)}`, { method:"POST", headers:{ apikey:APP_CONFIG.SUPABASE_ANON_KEY, Authorization:`Bearer ${APP_CONFIG.SUPABASE_ANON_KEY}`, "Content-Type":file.type || "application/octet-stream", "x-upsert":"false" }, body:file });
    if(!upload.ok) throw new Error("تعذر رفع الملف إلى التخزين الآمن.");
    if(onProgress) onProgress(100);
    const response = await fetch(SUPABASE_FUNCTION("upload-to-gemini"), { method:"POST", headers:authHeaders(), body:JSON.stringify({ ...auth, storage_path:path, file_name:file.name, mime_type:file.type || "application/octet-stream", size_bytes:file.size }) });
    const data = await response.json().catch(() => null);
    if(!response.ok || !data?.file) throw new Error(errorMessage(data,response.status));
    return data.file;
  }
  async function pollUntilActive(_base, fileApiName, onState){
    const auth = activation();
    for(let i=0;i<20;i++){
      const res = await fetch(`${SUPABASE_FUNCTION("file-status")}?name=${encodeURIComponent(fileApiName)}&code=${encodeURIComponent(auth.code)}&device_id=${encodeURIComponent(auth.device_id)}`, { headers:{ apikey:APP_CONFIG.SUPABASE_ANON_KEY, Authorization:"Bearer " + APP_CONFIG.SUPABASE_ANON_KEY } });
      if(!res.ok) throw new Error("تعذر التحقق من حالة الملف.");
      const data = await res.json(); if(onState) onState(data.state);
      if(data.state === "ACTIVE" || data.state === "FAILED") return data.state;
      await new Promise(resolve => setTimeout(resolve,1000));
    }
    return "ACTIVE";
  }
  async function streamGenerate(_base, systemInstruction, contents, onChunk){
    const auth = activation();
    const res = await fetch(SUPABASE_FUNCTION("ai-chat"), { method:"POST", headers:authHeaders(), body:JSON.stringify({ ...auth, systemInstruction, contents }) });
    if(!res.ok){ const data = await res.json().catch(() => null); throw new Error(errorMessage(data,res.status)); }
    if(!res.body) throw new Error("لم تصل استجابة من خدمة الذكاء الاصطناعي.");
    const reader=res.body.getReader(), decoder=new TextDecoder(); let buf="", full="";
    while(true){ const {done,value}=await reader.read(); if(done) break; buf += decoder.decode(value,{stream:true}); const lines=buf.split("\n"); buf=lines.pop(); for(const line of lines){ const t=line.trim(); if(!t.startsWith("data:")) continue; const raw=t.slice(5).trim(); if(!raw || raw === "[DONE]") continue; try{ const obj=JSON.parse(raw); const piece=obj?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||""; full+=piece; if(onChunk) onChunk(full); }catch{} } }
    return full || "(لم يصل رد)";
  }
  async function callTTS(prompt,speechConfig){
    const auth=activation(); const res=await fetch(SUPABASE_FUNCTION("ai-tts"),{method:"POST",headers:authHeaders(),body:JSON.stringify({...auth,prompt,speechConfig})}); const data=await res.json().catch(()=>null); if(!res.ok) throw new Error(errorMessage(data,res.status)); const part=data?.candidates?.[0]?.content?.parts?.find(p=>p.inlineData||p.inline_data); const inline=part&&(part.inlineData||part.inline_data); if(!inline?.data) throw new Error("لم يرجع الموديل مقطعًا صوتيًا."); const match=/rate=(\d+)/.exec(inline.mimeType||inline.mime_type||""); return {base64:inline.data,sampleRate:match?parseInt(match[1],10):24000};
  }
  function pcmBase64ToWavBlob(base64,sampleRate){ const binary=atob(base64),pcm=new Uint8Array(binary.length); for(let i=0;i<binary.length;i++) pcm[i]=binary.charCodeAt(i); const buffer=new ArrayBuffer(44+pcm.length),view=new DataView(buffer),write=(offset,text)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));}; write(0,"RIFF");view.setUint32(4,36+pcm.length,true);write(8,"WAVE");write(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,"data");view.setUint32(40,pcm.length,true);new Uint8Array(buffer,44).set(pcm);return new Blob([buffer],{type:"audio/wav"}); }
  const PODCAST_SYSTEM="أنت كاتب سيناريو بودكاست. اكتب حوارًا قصيرًا طبيعيًا بين سارة ووليد يناقشان محتوى المصادر بأسلوب ودّي ومبسّط. كل سطر يبدأ سارة: أو وليد: ولا تكتب شيئًا خارج الحوار.";
  async function generatePodcast(_base,parts,onStage){ if(onStage)onStage("script"); const script=await streamGenerate("",PODCAST_SYSTEM,[{role:"user",parts:parts.concat([{text:"اكتب الحوار الآن."}])}],null); if(onStage)onStage("audio"); const audio=await callTTS("حوّل الحوار التالي بين سارة ووليد إلى صوت طبيعي:\n\n"+script,{multiSpeakerVoiceConfig:{speakerVoiceConfigs:[{speaker:"سارة",voiceConfig:{prebuiltVoiceConfig:{voiceName:"Kore"}}},{speaker:"وليد",voiceConfig:{prebuiltVoiceConfig:{voiceName:"Puck"}}}]}}); return {script,url:URL.createObjectURL(pcmBase64ToWavBlob(audio.base64,audio.sampleRate))}; }
  const SLIDES_SYSTEM="أنت مصمم عروض تعليمية. أرجع فقط مصفوفة JSON صالحة بهذا الشكل: [{\"title\":\"عنوان\",\"bullets\":[\"نقطة\"],\"narration\":\"شرح قصير\"}]. أنشئ 4 إلى 12 شريحة.";
  function extractJson(text){const start=text.indexOf("["),end=text.lastIndexOf("]");if(start<0||end<start)throw new Error("رد النموذج ليس بصيغة متوقعة");return JSON.parse(text.slice(start,end+1));}
  async function generateSlideDeck(_base,parts,onProgress){if(onProgress)onProgress({stage:"outline"});const raw=await streamGenerate("",SLIDES_SYSTEM,[{role:"user",parts:parts.concat([{text:"جهز الشرائح الآن."}])}],null);const outline=extractJson(raw).slice(0,12);const slides=[];for(let i=0;i<outline.length;i++){const item=outline[i];if(onProgress)onProgress({stage:"audio",index:i+1,total:outline.length});let audioUrl=null;try{const audio=await callTTS("اقرأ النص التالي بصوت تعليمي واضح:\n\n"+String(item.narration||item.title),{voiceConfig:{prebuiltVoiceConfig:{voiceName:"Kore"}}});audioUrl=URL.createObjectURL(pcmBase64ToWavBlob(audio.base64,audio.sampleRate));}catch{}slides.push({title:String(item.title||"بدون عنوان"),bullets:Array.isArray(item.bullets)?item.bullets.map(String).slice(0,5):[],narration:String(item.narration||""),audioUrl});}return {slides};}
  return {uploadSource,pollUntilActive,streamGenerate,generatePodcast,generateSlideDeck,callTTS};
})();
