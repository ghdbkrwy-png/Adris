(function(){
"use strict";

const $ = UI.$;

let selectedFile = null;
let isProcessing = false;

const MAX_FILE_SIZE = 50 * 1024 * 1024;

const audioInput = $("audio-file");
const audioDrop = $("audio-drop");
const fileInfo = $("file-info");
const fileName = $("file-name");
const fileSize = $("file-size");
const removeFile = $("remove-file");

const transcribeBtn = $("transcribe-btn");
const processBox = $("process-box");
const processTitle = $("process-title-text");
const processSpinner = $("process-spinner");

const transcriptBox = $("transcript-box");
const transcriptContent = $("transcript-content");
const copyTranscript = $("copy-transcript");

const errorBox = $("transcribe-error");

/*

* الصفحة تستخدم نفس نظام الدفتر الموجود بالتطبيق.
* إذا دخل المستخدم بدون nb سيتم إعادته للرئيسية
* بواسطة Shared.loadNotebookOrRedirect.
  */
  const notebooks = Store.loadNotebooks();
  const cfg = Store.loadCfg();
  const nb = Shared.loadNotebookOrRedirect(notebooks);

if(!nb) return;

UI.renderTopbar(nb);
UI.renderTabnav("transcribe", nb.id);
UI.mountModals();

Shared.wireChrome(cfg, Store.saveCfg, {
onTitleChange: (val) => {
nb.name = val || nb.name;
Store.saveNotebooks(notebooks);
UI.renderTopbar(nb);
}
});

$("head-mic").innerHTML = icon("mic");
$("drop-mic").innerHTML = icon("mic");
$("file-mic").innerHTML = icon("mic");
$("remove-icon").innerHTML = icon("close");
$("transcribe-btn-icon").innerHTML = icon("mic");
$("copy-icon").innerHTML = icon("check");

function setStep(step){
const steps = ["upload", "analyze", "transcribe", "finish"];

steps.forEach((name, index) => {
  const el = $("step-" + name);
  if(!el) return;

  const currentIndex = steps.indexOf(step);

  el.classList.remove("active", "done");

  if(index < currentIndex){
    el.classList.add("done");
  }else if(index === currentIndex){
    el.classList.add("active");
  }
});

const titles = {
  upload: "جارِ رفع التسجيل...",
  analyze: "جاري الاستماع وتحليل التسجيل...",
  transcribe: "جاري تحويل الكلام إلى نص...",
  finish: "جاري تجهيز النص النهائي..."
};

processTitle.textContent = titles[step] || "جارِ المعالجة...";

}

function showError(message){
errorBox.textContent = message;
errorBox.classList.add("show");
}

function hideError(){
errorBox.textContent = "";
errorBox.classList.remove("show");
}

function formatSize(bytes){
if(bytes < 1024) return bytes + " B";

if(bytes < 1024 * 1024){
  return (bytes / 1024).toFixed(1) + " KB";
}

return (bytes / (1024 * 1024)).toFixed(2) + " MB";

}

function setSelectedFile(file){
hideError();

if(!file){
  clearFile();
  return;
}

if(!file.type || !file.type.startsWith("audio/")){
  showError("الملف المحدد ليس ملفًا صوتيًا.");
  clearFile();
  return;
}

if(file.size > MAX_FILE_SIZE){
  showError("حجم الملف كبير جدًا. الحد الأقصى للرفع من هذه الصفحة هو 50 MB.");
  clearFile();
  return;
}

selectedFile = file;

fileName.textContent = file.name;
fileSize.textContent = formatSize(file.size);

fileInfo.classList.add("show");
transcribeBtn.disabled = false;

transcriptBox.classList.remove("show");
transcriptContent.textContent = "";

}

function clearFile(){
selectedFile = null;

audioInput.value = "";

fileInfo.classList.remove("show");

fileName.textContent = "";
fileSize.textContent = "";

transcribeBtn.disabled = true;

transcriptBox.classList.remove("show");
transcriptContent.textContent = "";

}

audioInput.addEventListener("change", () => {
const file = audioInput.files && audioInput.files[0];
setSelectedFile(file);
});

removeFile.addEventListener("click", (e) => {
e.preventDefault();
e.stopPropagation();

if(isProcessing) return;

clearFile();

});

audioDrop.addEventListener("dragover", (e) => {
e.preventDefault();
if(!isProcessing) audioDrop.classList.add("dragging");
});

audioDrop.addEventListener("dragleave", () => {
audioDrop.classList.remove("dragging");
});

audioDrop.addEventListener("drop", (e) => {
e.preventDefault();
audioDrop.classList.remove("dragging");

if(isProcessing) return;

const file = e.dataTransfer.files && e.dataTransfer.files[0];

if(file){
  setSelectedFile(file);
}

});

async function uploadAudio(file){
  return Gemini.uploadSource("", file, null);
}

async function transcribeAudio(fileData){
  const auth = AuthGuard.saved();
  const response = await fetch(SUPABASE_FUNCTION("transcribe"), { method:"POST", headers:{ "Content-Type":"application/json", apikey:APP_CONFIG.SUPABASE_ANON_KEY, Authorization:"Bearer " + APP_CONFIG.SUPABASE_ANON_KEY }, body:JSON.stringify({ code:auth.code, device_id:AuthGuard.deviceId(), file_uri:fileData.uri, mime_type:fileData.mimeType }) });
  const data = await response.json().catch(() => null);
  if(!response.ok) throw new Error(extractError(data));
  if(typeof data?.text !== "string" || !data.text.trim()) throw new Error("لم يتم العثور على نص واضح في التسجيل.");
  return data.text.trim();
}

function extractError(data){
if(!data) return "حدث خطأ غير معروف.";

if(typeof data.error === "string"){
  return data.error;
}

if(data.error && typeof data.error.message === "string"){
  return data.error.message;
}

return "حدث خطأ أثناء معالجة التسجيل.";

}

async function startTranscription(){
if(!selectedFile || isProcessing) return;

hideError();

isProcessing = true;

transcribeBtn.disabled = true;
removeFile.disabled = true;

processBox.classList.add("show");
processSpinner.style.display = "block";

transcriptBox.classList.remove("show");
transcriptContent.textContent = "";

try{

  /*
   * المرحلة الأولى:
   * رفع التسجيل
   */
  setStep("upload");

  const fileData = await uploadAudio(selectedFile);

  /*
   * المرحلة الثانية:
   * إرسال الملف إلى نموذج التفريغ.
   * لا يوجد Progress حقيقي من Gemini لهذه المرحلة،
   * لذلك نظهر للمستخدم حالة المعالجة الحالية بدل نسبة وهمية.
   */
  setStep("analyze");

  /*
   * ننتظر قليلًا حتى تكون حالة الواجهة واضحة للمستخدم
   * قبل بدء طلب التفريغ.
   */
  await delay(350);

  setStep("transcribe");

  const text = await transcribeAudio(fileData);

  setStep("finish");

  await delay(250);

  transcriptContent.textContent = text;

  transcriptBox.classList.add("show");

  processBox.classList.remove("show");

  UI.toast("تم تفريغ التسجيل بنجاح");

  /*
   * نضع المؤشر على بداية النص.
   */
  transcriptContent.scrollTop = 0;

}catch(err){

  processBox.classList.remove("show");

  showError(
    "تعذّر تفريغ التسجيل: " +
    (err && err.message ? err.message : String(err))
  );

}finally{

  isProcessing = false;

  transcribeBtn.disabled = !selectedFile;
  removeFile.disabled = false;

}

}

function delay(ms){
return new Promise(resolve => setTimeout(resolve, ms));
}

transcribeBtn.addEventListener("click", startTranscription);

copyTranscript.addEventListener("click", async () => {

const text = transcriptContent.textContent || "";

if(!text.trim()){
  UI.toast("لا يوجد نص لنسخه", true);
  return;
}

try{

  await navigator.clipboard.writeText(text);

  UI.toast("تم نسخ النص الصوتي");

}catch(err){

  /*
   * fallback للأجهزة أو المتصفحات التي لا تسمح
   * باستخدام Clipboard API.
   */
  const textarea = document.createElement("textarea");

  textarea.value = text;

  textarea.style.position = "fixed";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);

  textarea.focus();
  textarea.select();

  try{
    document.execCommand("copy");
    UI.toast("تم نسخ النص الصوتي");
  }catch(e){
    UI.toast("تعذّر نسخ النص تلقائيًا", true);
  }

  textarea.remove();
}

});

})();
