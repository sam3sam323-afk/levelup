# خيارات CI/CD لبناء LEVEL UP NEXUS على Windows x64

## التوصية

الخيار الأنسب للمشروع هو **GitHub Actions باستخدام Windows hosted runner**:

```yaml
runs-on: windows-latest
```

مع `tauri-apps/tauri-action` لتشغيل `tauri build` ورفع ناتج البناء كـ artifact. هذا المسار يستخدم Windows x64 فعليًا بدل محاولة cross-compile من Ubuntu ARM64، ويزيل مشكلة غياب MSVC وWindows SDK وWebView2 من بيئة Linux الحالية.

## المقارنة

### GitHub Actions — الخيار الموصى به

GitHub يوفر runners باسم `windows-latest` و`windows-2025` و`windows-2022` بمعمارية x64. الـ hosted runner عبارة عن VM جديدة لكل job، لذلك لا نعتمد على حالة سابقة مخفية. توثيق Tauri الرسمي يوفر workflow مبنيًا على `windows-latest` مع `tauri-apps/tauri-action` لبناء Windows ورفع artifacts أو إنشاء GitHub Release.

المزايا:

- Windows x64 أصلي.
- مناسب مباشرةً لـ Tauri v2 وMSVC.
- تكامل طبيعي مع Git وPull Requests وReleases.
- دعم caching لـ pnpm وRust.
- إمكانية حفظ `.exe` و`.msi` كـ artifacts دون نشر عام.
- مناسب لمشروعنا لأن Tauri CLI موجود في `package.json` بالفعل.

النقطة المهمة: `windows-latest` قد يتغير مع تحديث صورة Windows. أثناء مرحلة التثبيت يمكن استخدام `windows-2022` أو `windows-2025` لتثبيت بيئة أكثر ثباتًا، ثم الانتقال إلى `windows-latest` عند الحاجة.

### Azure Pipelines — بديل قوي

يوفر Azure Pipelines Microsoft-hosted agents مثل `windows-latest` و`windows-2022`. كل job يعمل على VM جديدة ويتم التخلص منها بعد انتهائه. هذا مناسب للبناء المتكرر، خصوصًا إذا كان المشروع مرتبطًا أصلًا بـ Azure DevOps.

عيبه بالنسبة لمشروعنا هو أنه يضيف إعدادًا وخدمة منفصلة عن GitHub، بينما GitHub Actions لديه تكامل Tauri جاهز وتكامل مباشر مع المستودع.

### AppVeyor — بديل Windows تقليدي

AppVeyor ينشئ VM جديدة، يستنسخ المستودع، وينفذ مراحل build/test/deploy. يمكن استخدامه لبناء Windows، لكنه أقل ملاءمة من GitHub Actions هنا لأن توثيق Tauri الرسمي وخيار `tauri-action` موجه إلى GitHub Actions، ولأن إدارة artifacts والإصدارات ستكون منفصلة.

### Self-hosted Windows runner — الخيار الأكثر تحكمًا

يمكن تشغيل GitHub Actions على جهاز Windows أو VM Windows يملكها المستخدم. هذا يعطي تحكمًا كاملًا بالإصدارات وSidecars والتوقيع، لكنه يحتاج جهازًا دائمًا وصيانة وتحديثات وحماية للrunner. لا أوصي به كبداية إلا إذا احتجنا signing certificate أو بيئة ثابتة جدًا.

## مسار workflow المقترح

المرحلة الأولى لا تنشئ Release عام؛ بل تبني وتحمّل artifact فقط:

```yaml
name: Build Windows x64

on:
  workflow_dispatch:
  push:
    branches: [main]

jobs:
  build-windows:
    runs-on: windows-2022
    permissions:
      contents: read

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Enable pnpm
        run: corepack enable

      - name: Install frontend dependencies
        run: pnpm install --frozen-lockfile

      - name: Verify Sidecars
        run: pnpm verify:sidecars

      - name: Setup Rust MSVC
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: x86_64-pc-windows-msvc

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri -> target

      - name: Check frontend
        run: pnpm check

      - name: Build Tauri
        uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          projectPath: .

      - name: Upload Windows artifact
        uses: actions/upload-artifact@v4
        with:
          name: level-up-nexus-windows-x64
          path: |
            src-tauri/target/release/bundle/nsis/*.exe
            src-tauri/target/release/bundle/msi/*.msi
          if-no-files-found: error
          retention-days: 14
```

نبدأ بـ `workflow_dispatch` وartifact خاص. لا نضيف `contents: write` ولا ننشئ Release حتى يتم تأكيد البناء والاختبار. لاحقًا يمكن إضافة trigger على Git tag وإعداد signing وRelease.

## ملاحظة عن Sidecars

يجب أن تبقى الملفات ذات الأسماء التالية في المستودع أو أن يتم تنزيلها والتحقق منها داخل workflow:

```text
src-tauri/binaries/yt-dlp-x86_64-pc-windows-msvc.exe
src-tauri/binaries/aria2c-x86_64-pc-windows-msvc.exe
src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe
```

يجب تشغيل `pnpm verify:sidecars` قبل `tauri build`. لا نعتمد على PATH الخاص بالrunner.

## الخلاصة

لبناء `.exe` Windows موثوق بعيدًا عن Linux ARM64 الحالي:

1. حفظ المشروع في GitHub.
2. إضافة workflow أعلاه إلى `.github/workflows/build-windows.yml`.
3. تشغيله يدويًا أولًا.
4. تنزيل artifact وفحص وجود Sidecars داخله.
5. لاحقًا إضافة اختبار تثبيت وsigning وRelease عند الموافقة.

## المصادر

- [1] Tauri GitHub pipeline guide: https://v2.tauri.app/distribute/pipelines/github/
- [2] GitHub-hosted runners: https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- [3] GitHub artifact storage: https://docs.github.com/en/actions/using-workflows/storing-workflow-data-as-artifacts
- [4] Azure hosted agents: https://learn.microsoft.com/en-us/azure/devops/pipelines/agents/hosted?view=azure-devops
- [5] AppVeyor documentation: https://www.appveyor.com/docs/
