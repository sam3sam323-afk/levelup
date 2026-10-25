# إشعارات ومصادر البرامج الثنائية المضمّنة

يحتوي مثبّت LEVEL UP ARENA NEXUS على برامج مفتوحة المصدر مستقلة؛ يبقى ترخيص كل برنامج واجب التطبيق على مكوّنه. تُضمّن ملفات الإشعارات وأرشيفات المصدر المطابقة داخل مجلد `licenses/` في ملفات المشروع والمثبّت.

| المكوّن | الإصدار/البناء | المصدر الثنائي | الترخيص والإشعارات | مصدر الشيفرة المطابق |
| --- | --- | --- | --- | --- |
| yt-dlp | 2026.10.21، Windows x64 | [الإصدار الرسمي](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.21) | Unlicense و`THIRD_PARTY_LICENSES.txt` داخل `yt-dlp/` | `sources/yt-dlp-2026.10.21.tar.gz` من [المستودع الرسمي](https://github.com/yt-dlp/yt-dlp/tree/2026.10.21) |
| aria2 | 1.37.0، Windows x64 | [الإصدار الرسمي](https://github.com/aria2/aria2/releases/tag/release-1.37.0) | GPL-2.0-or-later في `aria2/COPYING` وإشعار OpenSSL في `aria2/LICENSE.OpenSSL` | `sources/aria2-1.37.0.tar.gz` من [المستودع الرسمي](https://github.com/aria2/aria2/tree/release-1.37.0) |
| FFmpeg | `N-127957-g935f29eaae`، BtbN LGPL Windows x64، 2026-10-23 | [أصل البناء المحدد](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-10-23-13-04) | إشعار البناء في `ffmpeg/BtbN-LICENSE.txt` ونص LGPL في `ffmpeg/COPYING.LGPLv2.1` | `sources/ffmpeg-9a9b70bb8c96c633f6e588c79f769964b10213b5.tar.gz` من [commit FFmpeg المطابق](https://github.com/FFmpeg/FFmpeg/commit/9a9b70bb8c96c633f6e588c79f769964b10213b5)؛ يذكر `ffmpeg/BtbN-LICENSE.txt` مصدر بناء BtbN |

تثبّت أداة `scripts/fetch-windows-binaries.mjs` روابط الإصدارات وبصمات SHA-256 لكل أصل ومن ثم تتحقق من كل ملف قبل تجهيزه. بصمة حزمة aria2 محسوبة ومثبتة في المشروع لأن upstream لا ينشر قيمة digest لذلك الأصل. ملف `binaries/win-x64/.nexus-binaries-manifest.json` يسجل بصمات الملفات التنفيذية الناتجة. أرشيفات المصدر المرفقة هي corresponding source للإصدارات المحددة وليست مصدرًا عائمًا من فرع حديث.

FFmpeg هنا بناء LGPL وليس بناءً مفعلًا بخيارات GPL، ويختبر سكربت التحقق غياب `--enable-gpl`. تغييرات أو إعادة بناء مخصصة قد تستلزم تحديث هذه الإشعارات ومصادر المكونات واعتماديات البناء وفق تراخيصها. لا يضم التطبيق أي مكوّن لتجاوز DRM أو التحقق أو قيود الوصول.
