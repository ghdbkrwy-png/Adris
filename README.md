# ادرس معي — GitHub Pages + Supabase

## البنية

- **Frontend:** GitHub Pages (ملفات ثابتة في `dist/`)
- **Backend:** Supabase Edge Functions (في `supabase/functions/`)
- **Database:** Supabase Database (جدول `activation_codes`)
- **Storage:** Supabase Storage (bucket باسم `user-files`)
- **AI:** Google Gemini API (عبر Edge Functions فقط)

## النشر

### GitHub Pages
1. ارفع المشروع إلى repository باسم `Adris`
2. فعّل GitHub Pages من Settings → Pages → Source: GitHub Actions
3. عند كل push على فرع `main`، سيتم البناء والنشر تلقائيًا

### Supabase Secrets
أضف هذه الأسرار في Supabase → Edge Functions → Secrets:

| Secret | الوصف |
|--------|-------|
| `GEMINI_API_KEY` | مفتاح Google Gemini API |
| `GEMINI_TEXT_MODEL` | نموذج النص (مثل `gemini-3.6-flash`) |
| `GEMINI_TTS_MODEL` | نموذج الصوت (مثل `gemini-3.1-flash-tts-preview`) |
| `GEMINI_TRANSCRIBE_MODEL` | نموذج التفريغ (مثل `gemini-3.5-transcribe`) |

ملاحظة: `SUPABASE_URL` و `SUPABASE_SERVICE_ROLE_KEY` مُهيّأة تلقائيًا.

### التطوير المحلي
```bash
npm install
npm run dev
```

### البناء
```bash
npm run build
```
الناتج في `dist/` — لا يحتوي على أي مفاتيح سرية.

## الأمان
- لا يوجد أي API Key في ملفات Frontend
- جميع طلبات Gemini تمر عبر Edge Functions
- جدول `activation_codes` محمي بـ RLS (لا قراءة مباشرة من العميل)
- التحقق من التفعيل إلزامي لكل Edge Function
- `SUPABASE_SERVICE_ROLE_KEY` موجود فقط في بيئة Edge Functions
