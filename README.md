# ادرس معي — Vercel

الواجهة تستخدم Vercel Serverless API في `api/[...route].js` للوصول إلى Gemini.

## Environment Variables
أضف في Vercel → Settings → Environment Variables:

```env
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
GEMINI_TEXT_MODEL=gemini-3.6-flash
GEMINI_TTS_MODEL=gemini-3.1-flash-tts-preview
```

المفتاح لا يوضع في HTML أو JavaScript الخاص بالواجهة. بعد إضافة المتغيرات نفّذ Redeploy.
