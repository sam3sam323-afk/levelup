# مراجعة أمان LEVEL UP NEXUS

## النتيجة

تم تشديد إعدادات Tauri قبل الإصدار الحالي. لا يمكن وصف أي تطبيق بأنه محمي «بشكل مطلق»، لكن المسار الحالي يمنع حقن الأوامر الشائع ويقلل سطح الهجوم بين React وRust وSidecars.

## ما تم تفعيله

- تم تفعيل CSP مقيدة بدل `null`:
  - السكربتات من المصدر المحلي فقط.
  - الاتصال محصور في قناة Tauri IPC.
  - الصور والوسائط من الأصول المحلية أو `blob`/`data` عند الحاجة.
  - منع `object` و`frame` والـform targets الخارجية.
- capabilities تمنح spawn فقط لـ`binaries/yt-dlp` و`binaries/aria2c` كـSidecars محددة.
- لم تعد هناك صلاحية Frontend مباشرة لتشغيل `ffmpeg`; يستخدمه yt-dlp داخليًا من مجلد الموارد.
- استدعاءات Rust للعمليات تستخدم مصفوفة arguments، وليس shell command string، لذلك لا يتم تفسير URL أو المسار كأمر Shell.
- URL التنزيل والمسار يخضعان للتحقق من البروتوكول، محارف التحكم، والطول.
- React لا يستخدم Shell plugin مباشرة؛ الجسر يستدعي أوامر Tauri المسجلة فقط.

## الحدود المتبقية

- `args: true` ما زالت مطلوبة حاليًا لأن yt-dlp وaria2c يستقبلان خيارات ديناميكية ومسارات وروابط مختلفة. هذا محصور باسمَي Sidecar، لكنه أوسع من قائمة arguments بم validators منفصلة.
- Tauri Isolation Pattern غير مفعّل حاليًا. الواجهة المحلية المجمعة ليست محتوى بعيدًا، وCSP وcapabilities تقللان الخطر، لكن تفعيل Isolation Pattern مع hook يتحقق من IPC سيكون طبقة إضافية مناسبة قبل إدخال محتوى خارجي أو متصفح مدمج فعلي.
- FFmpeg وyt-dlp وaria2c ملفات تنفيذية خارجية؛ يجب الاستمرار في تثبيت نسخها والتحقق من SHA256 قبل البناء، وعدم قبول ملفات Sidecar من المستخدم.

## المراجع

[1]: https://v2.tauri.app/security/csp/ "Tauri Content Security Policy"
[2]: https://v2.tauri.app/develop/sidecar/ "Tauri Embedding External Binaries"
[3]: https://v2.tauri.app/concept/inter-process-communication/isolation/ "Tauri Isolation Pattern"
