# LEVEL UP NEXUS — Tauri v2 Backend Core Prompt

## الهدف والنطاق

ابنِ الطبقة الخلفية لتطبيق سطح المكتب LEVEL UP NEXUS باستخدام Tauri v2 وRust، مع استهداف Windows x64 كمنصة أولى. يجب أن تبقى واجهة React الحالية قابلة للعمل في وضع المحاكاة إلى أن يتم اعتماد المرحلة الخاصة بربط المحركات فعليًا. لا يتم إنشاء مثبت أو نشر نسخة إنتاجية قبل اجتياز فحوصات البناء والاختبار.

## مراحل التنفيذ الإلزامية

### المرحلة 1 — الهيكل والعقود

أنشئ بنية `src-tauri` كاملة، ملفات Tauri v2، إعدادات Cargo، capabilities محدودة، نماذج المهام والأحداث، ومديرًا لإدارة المهام والمحركات. لا تشغّل أي محرك في هذه المرحلة ولا تحذف المحاكاة من React. يجب أن تنجح فحوصات TypeScript وRust عند توفر toolchain.

### المرحلة 2 — Sidecars والتحقق

ضمّن نسخ Windows x64 التالية داخل `src-tauri/binaries/` باستخدام أسماء Tauri target-triple:

```text
src-tauri/binaries/yt-dlp-x86_64-pc-windows-msvc.exe
src-tauri/binaries/aria2c-x86_64-pc-windows-msvc.exe
src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe
```

يستخدم `tauri.conf.json` قيمة `bundle.externalBin` لهذه المحركات. لا تعتمد على وجودها في PATH. عند تشغيل التطبيق، افحص وجود كل Sidecar وصلاحية التنفيذ ونسخته، وأرسل حالة المحركات إلى React. يجب الحفاظ على حقوق التوزيع والتراخيص لكل من yt-dlp وaria2c وffmpeg.

### المرحلة 3 — مدير المهام والمحركات

أنشئ مديرًا مركزيًا للمهام يحتفظ بـ:

```text
task_id, url, engine, download_dir, output_path, state,
progress, downloaded_bytes, total_bytes, speed_bytes_per_second,
eta_seconds, filename, pid, created_at, updated_at, last_error
```

الحالات المسموحة:

```text
queued, starting, downloading, paused, completed, cancelled, failed
```

يجب أن يكون مدير المهام آمنًا مع تعدد الخيوط، وأن يمنع task_id المكرر، وأن يمنع تشغيل أكثر من عملية لنفس المهمة في الوقت نفسه. احفظ الحالة محليًا في App Data بصيغة JSON أو SQLite في مرحلة لاحقة، مع تنظيف السجلات القديمة دون حذف الملفات المكتملة.

### أوامر Tauri المطلوبة

```rust
start_download(url: String, engine: EngineType, download_dir: String, options: DownloadOptions) -> Result<DownloadTask, DownloadError>
pause_download(task_id: String) -> Result<DownloadTask, DownloadError>
resume_download(task_id: String) -> Result<DownloadTask, DownloadError>
cancel_download(task_id: String) -> Result<(), DownloadError>
get_download(task_id: String) -> Result<DownloadTask, DownloadError>
list_downloads() -> Result<Vec<DownloadTask>, DownloadError>
get_engine_status() -> Result<EngineStatus, DownloadError>
get_system_drives() -> Result<Vec<SystemDrive>, DownloadError>
open_file_location(path: String) -> Result<(), DownloadError>
```

لا تستخدم سلسلة أوامر shell واحدة. ابنِ arguments كمصفوفة منفصلة، ولا تستخدم `shell=true`. تحقّق من كل input قبل تشغيل العملية.

## اختيار المحرك والخيارات

### aria2c

يستخدم للروابط المباشرة والأرشيف وملفات torrent وmagnet. القيم الافتراضية:

```text
-x 16
-s 16
-k 1M
--continue=true
--summary-interval=1
--allow-overwrite=false
```

اجعل عدد الاتصالات قابلًا للتعديل بين 1 و16، ولا تفترض أن كل خادم يدعم 16 اتصالًا.

### yt-dlp

يستخدم لفحص وتنزيل الوسائط. شغّل ffmpeg المرفق عبر مسار مطلق آمن:

```text
--newline
--progress
--continue
--no-part
--ffmpeg-location <resolved-ffmpeg-directory>
```

يجب فصل فحص metadata عن بدء التنزيل، وعدم اعتبار اسم الملف القادم من الرابط مسارًا موثوقًا قبل تنظيفه.

## الإيقاف والاستئناف على Windows x64

لا تستخدم `SIGSTOP` أو إشارات Unix. خزّن PID ومعلومات العملية.

- `aria2c`: الأفضل تشغيله بوضع JSON-RPC محلي أو استخدام ملف جلسة، ثم إيقاف المهمة عبر API/عملية مدارة، مع حفظ الملف الجزئي وإعادة الاستئناف باستخدام `--continue`.
- `yt-dlp`: لا تفترض وجود pause حقيقي داخل العملية. نفّذ pause كإيقاف مداري آمن للعملية، واترك الملف الجزئي، ثم resume بإعادة تشغيل yt-dlp على نفس المهمة مع `--continue` واسم الإخراج نفسه.
- `cancel`: أرسل إيقافًا لطيفًا أولًا، ثم انتظر timeout قصيرًا، ثم force kill عند الحاجة. لا تحذف الملف الجزئي تلقائيًا إلا إذا طلب المستخدم ذلك.
- امنع race conditions بين pause/resume/cancel باستخدام lock لكل مهمة وحالة انتقال مسموحة.
- عند إغلاق التطبيق، أرسل shutdown للمهام وأوقف عمليات الأطفال دون ترك عمليات orphan.

## أحداث Tauri إلى React

استخدم أسماء ثابتة:

```text
download://queued
download://started
download://progress
download://paused
download://resumed
download://completed
download://cancelled
download://failed
engine://status
```

شكل حدث التقدم:

```json
{
  "taskId": "nexus-123",
  "state": "downloading",
  "progress": 42.5,
  "downloadedBytes": 1600000000,
  "totalBytes": 3800000000,
  "speedBytesPerSecond": 14800000,
  "etaSeconds": 250,
  "filename": "video.mp4",
  "engine": "yt-dlp",
  "error": null
}
```

أرسل progress بحد أقصى كل 250–500ms لكل مهمة، لا عند كل سطر stdout. لا تنشئ task أو thread جديدًا لكل event. تعامل مع stdout وstderr في threads غير حاجبة، وحوّل parsing failures إلى event خطأ واضح بدل إسقاط المهمة.

## Capabilities والأمان

اجعل الصلاحيات أقل ما يمكن. يجب أن تتضمن capability مخصصة للتطبيق وتسمح فقط بما يحتاجه التطبيق:

- core default/invoke.
- تشغيل Sidecars المحددة فقط إن استُخدم Tauri shell plugin.
- لا تسمح بـ arbitrary shell commands.
- لا تسمح بكتابة عامة خارج مجلد الحفظ أو App Data.
- لا تسمح بقراءة ملفات المستخدم إلا عند أمر صريح مطلوب.
- افتح المجلد عبر Rust command يتحقق من المسار، وليس عبر HTML URL غير موثوق.

تحقق من:

- البروتوكولات المسموحة: `https`, `http`, `magnet`, و`.torrent` عند الحاجة.
- رفض `javascript:`, `file:`, `data:`, وshell metacharacters غير اللازمة.
- تنظيف أسماء الملفات ومنع `..` وpath traversal.
- canonicalization للمجلد قبل الكتابة.
- عدم تمرير URL أو اسم الملف كسلسلة shell.
- عدم عرض stderr الخام للمستخدم قبل تنقيته.
- تحديد timeout وحجم أقصى للبيانات القادمة من stdout/stderr.

## Frontend Integration

أنشئ bridge TypeScript واحدًا يستعمل `invoke` و`listen` من `@tauri-apps/api`. يجب أن يدعم وضعين:

1. Tauri runtime: يستدعي Rust ويستقبل الأحداث الحقيقية.
2. Browser preview: يبقى على المحاكاة الحالية دون أخطاء import أو crash.

لا تحذف mock mode قبل وجود detection واضح لبيئة Tauri ونجاح `get_engine_status`.

## تحسين الحجم

```toml
[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
panic = "abort"
strip = true
```

قارن حجم Rust binary منفصلًا عن حجم Sidecars. لا تعتبر ضغط Rust حلًا لتصغير ffmpeg. استخدم bundling فعليًا لكل target triple، ولا تضغط الملفات التنفيذية بطريقة تمنع تشغيلها.

## التحقق المطلوب قبل الدمج

- `pnpm check`
- `cargo fmt --check`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `cargo test`
- `pnpm tauri build` على Windows x64
- اختبار تشغيل المحركات، pause/resume/cancel، الإغلاق وإعادة الفتح، المسارات العربية، الأقراص المختلفة، الروابط الفاشلة، وانقطاع الشبكة.

لا تعتبر Backend جاهزًا 100% قبل نجاح اختبارات Windows x64 ووجود Sidecars مرخصة ومختبرة.
