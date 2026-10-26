# Tauri v2 Backend Core — Phase 1 / Sidecars

الهدف الحالي هو Windows x64 باستخدام target triple:

```text
x86_64-pc-windows-msvc
```

## Sidecars المضافة

```text
src-tauri/binaries/yt-dlp-x86_64-pc-windows-msvc.exe
src-tauri/binaries/aria2c-x86_64-pc-windows-msvc.exe
src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe
```

تم تثبيت الإصدارات والبصمات وروابط المصدر في [`sidecars.manifest.json`](./sidecars.manifest.json). لا يتم تضمين `ffprobe` حاليًا لأنه غير مطلوب لعملية الدمج الأساسية وسيضيف حجمًا كبيرًا إلى التطبيق.

## التحقق

من جذر المشروع:

```bash
node scripts/verify-sidecars.mjs
```

التحقق يقارن SHA-256 للملفات الموجودة مع manifest. بصمة yt-dlp مطابقة لملف `SHA2-256SUMS` الرسمي. aria2c لا ينشر checksum asset في إصدار GitHub المستخدم، لذلك manifest يثبت البصمة المحلية مع رابط الإصدار الرسمي ويجب إعادة التحقق منه من مصدر موثوق قبل النشر العام.

## إعداد Tauri

`tauri.conf.json` يستخدم أسماء Sidecars الأساسية التالية:

```json
{
  "bundle": {
    "externalBin": [
      "binaries/yt-dlp",
      "binaries/aria2c",
      "binaries/ffmpeg"
    ]
  }
}
```

Tauri يطابقها مع الملفات ذات لاحقة target triple.

## ما لم ينفذ بعد

- تشغيل aria2c عبر JSON-RPC.
- اختبار `cargo check` و`tauri build` على Windows x64.

## التشغيل المضاف في هذه المرحلة

يتم تشغيل `yt-dlp` و`aria2c` من Rust عبر `tauri-plugin-shell`، مع قراءة stdout/stderr في مهمة خلفية غير حاجبة. يستخدم yt-dlp `--progress-template` ثابتًا، بينما يلتقط aria2c النسبة والسرعة وETA من console readout مؤقتًا إلى أن نضيف JSON-RPC في المرحلة التالية.

`pause` يوقف العملية الحالية ويحافظ على الملف الجزئي، و`cancel` ينهي العملية. `resume` يعيد تشغيل الـSidecar بنفس خيارات المهمة مع `--continue`، لذلك يستطيع yt-dlp وaria2c متابعة الملف الجزئي.

يستخدم التطبيق `tauri-plugin-store` لحفظ قائمة المهام وخياراتها في `level-up-nexus.json`. عند الإقلاع تعاد المهام التي كانت `starting` أو `downloading` إلى `paused`، ثم يمكن للمستخدم استئنافها يدويًا من الواجهة.
