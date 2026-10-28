import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  CloudDownload,
  Copy,
  FileArchive,
  FileAudio2,
  FileVideo2,
  FolderOpen,
  Gauge,
  Globe,
  HardDrive,
  Headphones,
  Home as HomeIcon,
  Languages,
  Link2,
  Menu,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Moon,
  Trash2,
  Volume2,
  VolumeX,
  Wrench,
  Upload,
  Video,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  invokeTauri,
  isTauriRuntime,
  listenTauri,
  openBrowserWindow,
  focusBrowserTab,
  closeBrowserTab,
  listBrowserTabs,
  restoreBrowserTabs,
  minimizeAppWindow,
  toggleAppWindowMaximize,
  closeAppWindow,
  type BrowserTab,
  type DownloadProgressEvent,
  type DownloadTask as TauriDownloadTask,
  type DownloadQuality,
  type PlaylistItemProgress,
  type TauriEngine,
} from "../lib/tauriBridge";

let uiAudioContext: AudioContext | null = null;
function playUiSfx(kind: "action" | "complete" | "copy") {
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    uiAudioContext ??= new AudioContextClass();
    const context = uiAudioContext;
    if (context.state === "suspended") void context.resume();
    const notes = kind === "complete" ? [660, 880, 1175] : kind === "copy" ? [880] : [520, 660];
    const start = context.currentTime;
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const at = start + index * 0.075;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.035, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.13);
    });
  } catch { /* Audio can be unavailable or blocked by platform policy. */ }
}

type Language = "en" | "ar";
type NavId = "home" | "downloads" | "library" | "browser" | "utilities" | "settings";
type DownloadState = "downloading" | "paused" | "completed" | "error" | "cancelled";
type Category = "Video" | "Audio" | "Archive" | "Other";

type DownloadItem = {
  id: string;
  name: string;
  url: string;
  location: string;
  type: Category;
  engine: "yt-dlp" | "aria2c";
  progress: number;
  size: string;
  sizeBytes: number;
  downloaded: string;
  speed: string;
  speedBytesPerSecond: number;
  eta: string;
  state: DownloadState;
  accent: "cyan" | "purple" | "pink" | "amber";
  createdAt: string;
  playlistItems: PlaylistItemProgress[];
  playlistCurrentIndex?: number;
  playlistTotal?: number;
};

const demoPreviewBaseTime = Date.now();
const demoPreviewDownloads: DownloadItem[] = [
  {
    id: "demo-forest",
    name: "Forest_Environment.zip",
    url: "https://example.com/files/forest.zip",
    location: "D:\\Downloads\\Game Assets Pack",
    type: "Archive",
    engine: "aria2c",
    progress: 78,
    size: "1.6 GB / 2.1 GB",
    sizeBytes: 2.1 * 1024 ** 3,
    downloaded: "1.6 GB",
    speed: "12.4 MB/s",
    speedBytesPerSecond: 12.4 * 1024 ** 2,
    eta: "45s",
    state: "downloading",
    accent: "cyan",
    createdAt: new Date(demoPreviewBaseTime).toISOString(),
    playlistItems: [],
  },
  {
    id: "demo-models",
    name: "Character_Models.zip",
    url: "https://example.com/files/character-models.zip",
    location: "D:\\Downloads\\Game Assets Pack",
    type: "Archive",
    engine: "yt-dlp",
    progress: 42,
    size: "1.4 GB / 3.3 GB",
    sizeBytes: 3.3 * 1024 ** 3,
    downloaded: "1.4 GB",
    speed: "8.1 MB/s",
    speedBytesPerSecond: 8.1 * 1024 ** 2,
    eta: "2m 10s",
    state: "downloading",
    accent: "purple",
    createdAt: new Date(demoPreviewBaseTime - 60_000).toISOString(),
    playlistItems: [],
  },
  {
    id: "demo-textures",
    name: "Textures_HighRes.zip",
    url: "https://example.com/files/textures-highres.zip",
    location: "D:\\Downloads\\Textures",
    type: "Archive",
    engine: "aria2c",
    progress: 12,
    size: "2.8 GB / 23.3 GB",
    sizeBytes: 23.3 * 1024 ** 3,
    downloaded: "2.8 GB",
    speed: "3.6 MB/s",
    speedBytesPerSecond: 3.6 * 1024 ** 2,
    eta: "6m 32s",
    state: "downloading",
    accent: "pink",
    createdAt: new Date(demoPreviewBaseTime - 120_000).toISOString(),
    playlistItems: [],
  },
  {
    id: "demo-tools",
    name: "Productivity_Tools_Setup.exe",
    url: "https://example.com/files/productivity-tools.exe",
    location: "D:\\Downloads\\Installers",
    type: "Other",
    engine: "aria2c",
    progress: 100,
    size: "892 MB",
    sizeBytes: 892 * 1024 ** 2,
    downloaded: "892 MB",
    speed: "0 B/s",
    speedBytesPerSecond: 0,
    eta: "—",
    state: "completed",
    accent: "cyan",
    createdAt: new Date(demoPreviewBaseTime - 180_000).toISOString(),
    playlistItems: [],
  },
  {
    id: "demo-paper",
    name: "Research_Paper.pdf",
    url: "https://example.com/files/research-paper.pdf",
    location: "D:\\Downloads\\Documents",
    type: "Other",
    engine: "yt-dlp",
    progress: 100,
    size: "6.4 MB",
    sizeBytes: 6.4 * 1024 ** 2,
    downloaded: "6.4 MB",
    speed: "0 B/s",
    speedBytesPerSecond: 0,
    eta: "—",
    state: "completed",
    accent: "amber",
    createdAt: new Date(demoPreviewBaseTime - 240_000).toISOString(),
    playlistItems: [],
  },
  {
    id: "demo-trailer",
    name: "Movie_Trailer_4K.mp4",
    url: "https://example.com/videos/movie-trailer-4k.mp4",
    location: "D:\\Downloads\\Videos",
    type: "Video",
    engine: "yt-dlp",
    progress: 18,
    size: "3.9 GB",
    sizeBytes: 3.9 * 1024 ** 3,
    downloaded: "701 MB",
    speed: "1.2 MB/s",
    speedBytesPerSecond: 1.2 * 1024 ** 2,
    eta: "12m 6s",
    state: "error",
    accent: "purple",
    createdAt: new Date(demoPreviewBaseTime - 300_000).toISOString(),
    playlistItems: [],
  },
];

const copy = {
  en: {
    appName: "LEVEL UP",
    nexus: "NEXUS",
    version: "WINDOWS DESKTOP / 2.4.0",
    brandTitle: "Level Up Nexus",
    brandTagline: "DOWNLOAD  ·  CONVERT  ·  ENJOY",
    workspaceSection: "WORKSPACE",
    designedFor: "DESIGNED FOR",
    nexusEngine: "NEXUS ENGINE",
    navAriaLabel: "Primary navigation",
    languageToggle: "Toggle language",
    themeLight: "Light",
    themeDark: "Dark",
    minimizeWindow: "Minimize",
    maximizeWindow: "Maximize",
    closeWindow: "Close",
    workspace: "TARIK PERSONAL",
    localWorkspace: "LOCAL WORKSPACE",
    dashboard: "Dashboard",
    downloads: "Downloads",
    downloadsSub: "Manage downloads powered by yt-dlp and aria2c.",
    demoPreview: "DEMO PREVIEW · illustrative data only",
    demoReadOnly: "Demo-only item. Actions are disabled.",
    urlFieldLabel: "URL (YouTube, direct link, etc.)",
    library: "Library",
    browser: "Nexus Browser",
    utilities: "Media Tools",
    settings: "Settings",
    preferences: "Preferences",
    autoOrganize: "Auto organize",
    clipboardWatch: "Clipboard watch",
    secure: "LOCAL & SECURE",
    connected: "CONNECTED",
    overview: "Good evening, Tarik",
    overviewSub: "Manage your real download queue.",
    newDownload: "New download",
    paste: "Paste",
    startDownload: "Start download",
    inputPlaceholder: "Paste a video, archive, magnet, or direct file link…",
    activeDownloads: "Active downloads",
    activeSub: "Moving through the queue",
    completed: "Completed",
    completedSub: "Ready in your library",
    totalStored: "Total stored",
    totalStoredSub: "Across your downloaded files",
    currentSpeed: "Current speed",
    queue: "Download queue",
    queueSub: "Real-time download status",
    viewAll: "View all",
    totalDownloads: "Total downloads",
    totalSpeed: "Total speed",
    actions: "Actions",
    details: "Download details",
    selectedDownload: "Selected download",
    selectHint: "Select a download to view its details",
    storage: "Storage orbit",
    storageSub: "Local workspace capacity",
    categories: "Categories",
    recentActivity: "Recent activity",
    all: "All files",
    active: "Active",
    paused: "Paused",
    done: "Completed",
    failed: "Failed",
    search: "Search downloads…",
    sort: "Sort",
    newest: "Newest first",
    name: "Name",
    status: "Status",
    size: "Size",
    progress: "Progress",
    speed: "Speed",
    eta: "Time left",
    pause: "Pause",
    resume: "Resume",
    resumeDownload: "Resume download",
    cancel: "Cancel",
    remove: "Remove",
    openFolder: "Open folder",
    copyLink: "Copy link",
    previewOnly: "Desktop runtime required",
    liveMode: "LIVE ENGINE",
    liveEngines: "Live engines",
    online: "online",
    arabicLanguage: "Arabic",
    englishLanguage: "English",
    engine: "Routed engine",
    saveTo: "Save to",
    savePlaceholder: "Absolute folder path",
    savePathHint: "Edit the destination path directly; folder browsing is not enabled yet.",
    pasteLinkFirst: "Paste a link to determine its download engine.",
    enterUrl: "Enter a download link.",
    invalidUrl: "Use an http, https, or magnet link.",
    enterAbsolutePath: "Enter an absolute Windows folder path.",
    addToQueue: "Add to queue",
    playlist: "Download full YouTube playlist (if available)",
    playlistHint: "Download every item from a YouTube playlist",
    routePlaylist: "yt-dlp · full playlist",
    playlistProgress: "Playlist item progress",
    item: "Item",
    quality: "Quality",
    qualityBest: "Best available",
    quality1080: "Video · 1080p",
    quality720: "Video · 720p",
    quality480: "Video · 480p",
    qualityAudio320: "Audio · MP3 320 Kbps",
    qualityAudio192: "Audio · MP3 192 Kbps",
    qualityAudio128: "Audio · MP3 128 Kbps",
    close: "Close",
    browserTitle: "WebView2 browser tabs",
    browserSub: "Open and manage your browser tabs from one place.",
    openExternal: "Open new tab",
    browserQuickLaunch: "Quick launch",
    browserWindows: "Open browser tabs",
    browserNoWindows: "No browser tabs are open yet.",
    browserNewWindow: "New tab",
    browserFocus: "Focus tab",
    browserClose: "Close tab",
    browserWindowLimit: "Your saved browser tabs will be restored when available.",
    browserSecureHint: "Downloads start only after your click. Web pages cannot access the other desktop commands.",
    utilitiesTitle: "Media utilities",
    utilitiesSub: "Useful actions for your local downloads and engines.",
    settingsSub: "Adjust optional interface behaviors and privacy controls.",
    ready: "Desktop tools",
    pasteClipboard: "Paste link from clipboard",
    openDownloadsFolder: "Open downloads folder",
    checkEngines: "Check download engines",
    enginesReady: "Available download engines",
    noEngines: "No download engines are available",
    engineUnavailable: "The engine required for this link is unavailable",
    openFolderError: "Could not open the file or folder",
    clipboardReadError: "Could not read the clipboard",
    cancelled: "Download cancelled",
    cancelledFilter: "Cancelled",
    cancelDownload: "Cancel download",
    windowDesktopOnly: "Available in the Windows desktop app",
    openFile: "Open file",
    libraryTitle: "Local library",
    librarySub: "Your downloaded files, arranged by type.",
    empty: "Nothing matches this view",
    emptySub: "Start a download from the desktop app to populate the queue.",
    downloadAdded: "Download started in the real queue",
    downloadError: "Unable to start the real download",
    copied: "Link copied",
    copyFailed: "Could not copy the link",
    removed: "Download removed",
    desktopRequired: "Open the Windows desktop app to use real downloads",
    routeVideo: "yt-dlp · stream & merge",
    routeFile: "aria2c · multi-connection",
    routeMagnet: "aria2c · torrent route",
    routeAuto: "Auto · inspect remote file size",
    noTime: "Complete",
    controlRoom: "NEXUS CONTROL ROOM",
    heroTitle: "Bring media",
    heroTitleAccent: "into your orbit.",
    queueHealth: "ACTIVE TASKS",
    live: "LIVE",
    browserKicker: "NEXUS BROWSER",
    toolkitKicker: "NEXUS TOOLKIT",
    libraryKicker: "NEXUS LIBRARY",
  },
  ar: {
    appName: "ليفل أب",
    nexus: "نيكسوس",
    version: "تطبيق سطح المكتب / 2.4.0",
    brandTitle: "ليفل أب نيكسوس",
    brandTagline: "نزّل · حوّل · استمتع",
    workspaceSection: "مساحة العمل",
    designedFor: "مصمم لـ",
    nexusEngine: "محرك نيكسوس",
    navAriaLabel: "التنقل الرئيسي",
    languageToggle: "تبديل اللغة",
    themeLight: "فاتح",
    themeDark: "داكن",
    minimizeWindow: "تصغير",
    maximizeWindow: "تكبير",
    closeWindow: "إغلاق النافذة",
    workspace: "مساحة طارق الشخصية",
    localWorkspace: "مساحة محلية",
    dashboard: "لوحة التحكم",
    downloads: "التنزيلات",
    downloadsSub: "إدارة التنزيلات عبر yt-dlp وaria2c.",
    demoPreview: "معاينة تجريبية · بيانات شكلية فقط",
    demoReadOnly: "هذا عنصر تجريبي؛ الإجراء معطّل.",
    urlFieldLabel: "الرابط (يوتيوب أو رابط مباشر)",
    library: "المكتبة",
    browser: "متصفح نيكسوس",
    utilities: "أدوات الوسائط",
    settings: "الإعدادات",
    preferences: "التفضيلات",
    autoOrganize: "تنظيم تلقائي",
    clipboardWatch: "مراقبة الحافظة",
    secure: "محلي وآمن",
    connected: "متصل",
    overview: "مساء الخير، طارق",
    overviewSub: "أدر مهام التنزيل الفعلية من هنا.",
    newDownload: "تنزيل جديد",
    paste: "لصق",
    startDownload: "بدء التنزيل",
    inputPlaceholder: "ألصق رابط فيديو أو أرشيف أو magnet أو ملف مباشر…",
    activeDownloads: "تنزيلات نشطة",
    activeSub: "تتحرك ضمن الطابور",
    completed: "مكتملة",
    completedSub: "جاهزة في مكتبتك",
    totalStored: "المخزن الكلي",
    totalStoredSub: "ضمن ملفاتك المنزلة",
    currentSpeed: "السرعة الحالية",
    queue: "طابور التنزيلات",
    queueSub: "حالة التنزيلات الفعلية",
    viewAll: "عرض الكل",
    totalDownloads: "إجمالي التنزيلات",
    totalSpeed: "السرعة الإجمالية",
    actions: "إجراءات",
    details: "تفاصيل التنزيل",
    selectedDownload: "التنزيل المحدد",
    selectHint: "اختر تنزيلًا لعرض تفاصيله",
    storage: "مدار التخزين",
    storageSub: "سعة المساحة المحلية",
    categories: "التصنيفات",
    recentActivity: "آخر النشاطات",
    all: "كل الملفات",
    active: "نشطة",
    paused: "متوقفة",
    done: "مكتملة",
    failed: "فاشلة",
    search: "ابحث عن تنزيل…",
    sort: "ترتيب",
    newest: "الأحدث أولًا",
    name: "الاسم",
    status: "الحالة",
    size: "الحجم",
    progress: "التقدم",
    speed: "السرعة",
    eta: "الوقت المتبقي",
    pause: "إيقاف مؤقت",
    resume: "استئناف",
    resumeDownload: "استئناف التنزيل",
    cancel: "إلغاء",
    remove: "إزالة",
    openFolder: "فتح المجلد",
    copyLink: "نسخ الرابط",
    previewOnly: "يتطلب تطبيق سطح المكتب",
    liveMode: "محركات فعلية",
    liveEngines: "المحركات المباشرة",
    online: "متصل",
    arabicLanguage: "العربية",
    englishLanguage: "الإنجليزية",
    engine: "المحرك الموجه",
    saveTo: "الحفظ في",
    savePlaceholder: "مسار مجلد مطلق",
    savePathHint: "عدّل مسار الحفظ مباشرة؛ اختيار المجلد غير مفعّل حاليًا.",
    pasteLinkFirst: "ألصق رابطًا لتحديد محرك التنزيل المناسب.",
    enterUrl: "أدخل رابط التنزيل.",
    invalidUrl: "استخدم رابط http أو https أو magnet.",
    enterAbsolutePath: "أدخل مسار مجلد Windows مطلقًا.",
    addToQueue: "إضافة للطابور",
    playlist: "تنزيل قائمة يوتيوب كاملة (إن أمكن)",
    playlistHint: "تنزيل جميع عناصر قائمة تشغيل يوتيوب دفعة واحدة",
    routePlaylist: "yt-dlp · قائمة تشغيل كاملة",
    playlistProgress: "تقدم عناصر قائمة التشغيل",
    item: "العنصر",
    quality: "الجودة",
    qualityBest: "أفضل جودة متاحة",
    quality1080: "فيديو · 1080p",
    quality720: "فيديو · 720p",
    quality480: "فيديو · 480p",
    qualityAudio320: "صوت · MP3 ‏320 Kbps",
    qualityAudio192: "صوت · MP3 ‏192 Kbps",
    qualityAudio128: "صوت · MP3 ‏128 Kbps",
    close: "إغلاق",
    browserTitle: "تبويبات متصفح WebView2",
    browserSub: "افتح تبويبات المتصفح وأدرها من مكان واحد.",
    openExternal: "فتح تبويب جديد",
    browserQuickLaunch: "فتح سريع",
    browserWindows: "تبويبات المتصفح المفتوحة",
    browserNoWindows: "لا توجد تبويبات متصفح مفتوحة بعد.",
    browserNewWindow: "تبويب جديد",
    browserFocus: "تركيز التبويب",
    browserClose: "إغلاق التبويب",
    browserWindowLimit: "ستتم استعادة تبويباتك المحفوظة عند توفرها.",
    browserSecureHint: "لا يبدأ التنزيل إلا بعد ضغطك. ولا تصل صفحات الويب إلى أوامر سطح المكتب الأخرى.",
    utilitiesTitle: "أدوات الوسائط",
    utilitiesSub: "إجراءات مفيدة للتنزيلات والمحركات المحلية.",
    settingsSub: "تحكم بخيارات الواجهة والخصوصية الاختيارية.",
    ready: "أدوات سطح المكتب",
    pasteClipboard: "لصق رابط من الحافظة",
    openDownloadsFolder: "فتح مجلد التنزيلات",
    checkEngines: "فحص محركات التنزيل",
    enginesReady: "محركات التنزيل المتاحة",
    noEngines: "لا توجد محركات تنزيل متاحة",
    engineUnavailable: "محرك التنزيل المطلوب لهذا الرابط غير متوفر",
    openFolderError: "تعذر فتح الملف أو المجلد",
    clipboardReadError: "تعذرت قراءة الحافظة",
    cancelled: "تم إلغاء التنزيل",
    cancelledFilter: "ملغاة",
    cancelDownload: "إلغاء التنزيل",
    windowDesktopOnly: "متاح في تطبيق Windows فقط",
    openFile: "فتح الملف",
    libraryTitle: "المكتبة المحلية",
    librarySub: "ملفاتك المنزلة مرتبة حسب النوع.",
    empty: "لا توجد نتائج لهذا العرض",
    emptySub: "ابدأ تنزيلًا من تطبيق سطح المكتب لملء الطابور.",
    downloadAdded: "بدأ التنزيل ضمن الطابور الحقيقي",
    downloadError: "تعذر بدء التنزيل الحقيقي",
    copied: "تم نسخ الرابط",
    copyFailed: "تعذر نسخ الرابط",
    removed: "تمت إزالة التنزيل",
    desktopRequired: "افتح تطبيق Windows لاستخدام التنزيلات الحقيقية",
    routeVideo: "yt-dlp · سحب ودمج البث",
    routeFile: "aria2c · اتصال متعدد",
    routeMagnet: "aria2c · مسار تورنت",
    routeAuto: "تلقائي · فحص حجم الملف البعيد",
    noTime: "مكتمل",
    controlRoom: "غرفة تحكم نيكسوس",
    heroTitle: "اجلب الوسائط",
    heroTitleAccent: "إلى مدارك.",
    queueHealth: "تنزيلات نشطة",
    live: "مباشر",
    browserKicker: "متصفح نيكسوس",
    toolkitKicker: "أدوات نيكسوس",
    libraryKicker: "مكتبة نيكسوس",
  },
} as const;

function formatBytes(value?: number) {
  if (!value || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** index;
  const digits = index === 0 ? 0 : amount < 10 ? 2 : 1;
  return `${amount.toFixed(digits)} ${units[index]}`;
}

function readableCommandError(error: unknown): string {
  if (typeof error === "string") {
    try {
      const parsed = JSON.parse(error) as { code?: unknown; message?: unknown };
      if (typeof parsed.message === "string") return `${typeof parsed.code === "string" ? `${parsed.code}: ` : ""}${parsed.message}`;
    } catch { /* Tauri may reject with a plain error string. */ }
    return error;
  }
  if (error && typeof error === "object") {
    const detail = error as { code?: unknown; message?: unknown };
    if (typeof detail.message === "string") return `${typeof detail.code === "string" ? `${detail.code}: ` : ""}${detail.message}`;
    try { return JSON.stringify(error); } catch { /* Fall through to a safe generic message. */ }
  }
  return error instanceof Error ? error.message : String(error);
}

function formatSpeed(value?: number) {
  return value ? `${formatBytes(value)}/s` : "0 B/s";
}

function formatEta(value?: number) {
  if (value === undefined || value < 0) return "—";
  if (value === 0) return "Complete";
  const days = Math.floor(value / 86400);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  if (days > 0) return `${days}d ${String(hours % 24).padStart(2, "0")}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

function categoryForTask(task: Pick<TauriDownloadTask, "filename" | "engine">): Category {
  const name = task.filename?.toLowerCase() ?? "";
  if (task.engine === "aria2c" && /\.(zip|rar|7z|tar|gz|iso|exe|msi|dmg|torrent)$/.test(name)) return "Archive";
  if (/\.(mp3|flac|m4a|wav|aac|ogg)$/.test(name)) return "Audio";
  if (/\.(zip|rar|7z|tar|gz|iso|exe|msi|dmg|torrent)$/.test(name)) return "Archive";
  return "Video";
}

function accentForCategory(category: Category): DownloadItem["accent"] {
  return category === "Audio" ? "pink" : category === "Archive" ? "cyan" : category === "Video" ? "purple" : "amber";
}

function relativeTimeLabel(timestamp: string, language: Language): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 1000));
  if (!Number.isFinite(elapsedSeconds)) return "—";
  if (elapsedSeconds < 60) return language === "ar" ? "الآن" : "Just now";
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["minute", 60], ["hour", 3600], ["day", 86400]];
  const [unit, seconds] = [...units].reverse().find(([, size]) => elapsedSeconds >= size) ?? units[0];
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  return formatter.format(-Math.floor(elapsedSeconds / seconds), unit);
}

function taskToItem(task: TauriDownloadTask): DownloadItem {
  const type = categoryForTask(task);
  return {
    id: task.taskId,
    name: task.filename || task.url.split("/").pop()?.split("?")[0] || "Nexus Download",
    url: task.url,
    location: task.outputPath || task.downloadDir,
    type,
    engine: task.engine,
    progress: Math.round(task.progress),
    size: task.totalBytes == null ? "—" : formatBytes(task.totalBytes),
    sizeBytes: task.totalBytes ?? 0,
    downloaded: formatBytes(task.downloadedBytes),
    speed: formatSpeed(task.speedBytesPerSecond),
    speedBytesPerSecond: task.speedBytesPerSecond,
    eta: task.state === "downloading" && task.etaSeconds === 0 ? "—" : formatEta(task.etaSeconds),
    state: task.state === "completed" ? "completed" : task.state === "paused" ? "paused" : task.state === "cancelled" ? "cancelled" : task.state === "failed" ? "error" : "downloading",
    accent: accentForCategory(type),
    createdAt: task.createdAt,
    playlistItems: task.playlistItems ?? [],
    playlistCurrentIndex: task.playlistCurrentIndex,
    playlistTotal: task.playlistTotal,
  };
}

function routeForUrl(url: string, language: Language) {
  const normalized = url.toLowerCase();
  if (normalized.startsWith("magnet:")) return copy[language].routeMagnet;
  if (/\.(zip|rar|7z|tar|gz|iso|exe|msi|dmg)(\?|$)/i.test(normalized)) return copy[language].routeFile;
  if (isYoutubeUrl(url)) return copy[language].routeVideo;
  if (/^https?:\/\//i.test(normalized)) return copy[language].routeAuto;
  return copy[language].invalidUrl;
}

function isYoutubeUrl(url: string) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "youtu.be" || /(^|\.)youtube\.com$/.test(hostname) || /(^|\.)youtube-nocookie\.com$/.test(hostname);
  } catch {
    return false;
  }
}

function isYoutubePlaylistUrl(url: string) {
  try {
    const parsed = new URL(url);
    return /(^|\.)youtube\.com$/i.test(parsed.hostname) && parsed.searchParams.has("list");
  } catch {
    return false;
  }
}

function iconForCategory(category: Category) {
  if (category === "Video") return FileVideo2;
  if (category === "Audio") return FileAudio2;
  if (category === "Archive") return FileArchive;
  return HardDrive;
}

function statusLabel(state: DownloadState, language: Language) {
  const t = copy[language];
  if (state === "downloading") return t.active;
  if (state === "paused") return t.paused;
  if (state === "completed") return t.done;
  if (state === "cancelled") return t.cancelledFilter;
  return t.failed;
}

function NexusMark({ size = "medium" }: { size?: "small" | "medium" | "large" }) {
  return (
    <div className={`nexus-mark nexus-mark--${size}`}>
      <img src="/assets/nexus-icon.png" alt="Nexus" />
    </div>
  );
}

function SectionIcon({ id }: { id: NavId }) {
  const icons: Record<NavId, LucideIcon> = {
    home: HomeIcon,
    downloads: ArrowDownToLine,
    library: FolderOpen,
    browser: Globe,
    utilities: Wrench,
    settings: Settings2,
  };
  const Icon = icons[id];
  return <Icon size={17} strokeWidth={1.8} />;
}

function AppButton({ children, variant = "primary", onClick, icon, type = "button" }: { children: React.ReactNode; variant?: "primary" | "secondary" | "quiet"; onClick?: () => void; icon?: React.ReactNode; type?: "button" | "submit" }) {
  return (
    <button type={type} onClick={onClick} className={`app-button app-button--${variant}`}>
      {icon}
      <span>{children}</span>
    </button>
  );
}

function AddDownloadModal({ language, onClose, onAdd, defaultPath, initialUrl = "", tauriMode, engineAvailable }: { language: Language; onClose: () => void; onAdd: (url: string, savePath: string, playlist: boolean, quality: DownloadQuality) => void; defaultPath?: string; initialUrl?: string; tauriMode: boolean; engineAvailable: boolean }) {
  const t = copy[language];
  const [value, setValue] = useState(initialUrl);
  const [savePath, setSavePath] = useState<string>(defaultPath || "");
  useEffect(() => { if (defaultPath) setSavePath(defaultPath); }, [defaultPath]);
  const [playlist, setPlaylist] = useState(false);
  const [quality, setQuality] = useState<DownloadQuality>("best");
  const [formError, setFormError] = useState("");
  const route = playlist ? t.routePlaylist : value.trim() ? routeForUrl(value, language) : t.pasteLinkFirst;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="modal-card add-card" onSubmit={(event) => { event.preventDefault(); const url = value.trim(); if (!url) { setFormError(t.enterUrl); return; } if (!/^magnet:/i.test(url) && !/^https?:\/\//i.test(url)) { setFormError(t.invalidUrl); return; } if (savePath.trim() && !/^(?:[a-zA-Z]:[\\/]|\\\\)/.test(savePath.trim())) { setFormError(t.enterAbsolutePath); return; } if (!savePath.trim() && !defaultPath) { setFormError(t.enterAbsolutePath); return; } setFormError(""); onAdd(url, savePath, playlist, quality); }} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label={t.close} onClick={onClose}><X size={18} /></button>
        <div className="add-modal-intro"><span className="add-modal-icon"><CloudDownload size={20} /></span><div><div className="modal-kicker"><Sparkles size={14} /> {engineAvailable ? t.liveMode : tauriMode ? t.noEngines : t.previewOnly}</div><h2>{t.newDownload}</h2></div></div>
        <label className="field-label">{t.urlFieldLabel}</label>
        <div className="field-with-icon"><Link2 size={16} /><input autoFocus value={value} onChange={(event) => { const nextValue = event.target.value; setValue(nextValue); setFormError(""); setPlaylist(isYoutubePlaylistUrl(nextValue.trim())); }} placeholder={t.inputPlaceholder} aria-invalid={Boolean(formError)} /></div>
        {formError ? <p className="form-error" role="alert">{formError}</p> : null}
        <div className="route-preview"><span>{t.engine}</span><strong>{route}</strong></div>
        <label className="playlist-option">
          <input type="checkbox" checked={playlist} onChange={(event) => setPlaylist(event.target.checked)} />
          <span><strong>{t.playlist}</strong></span>
        </label>
        <div className="modal-field-grid">
          <div className="modal-field-group"><label className="field-label" htmlFor="download-quality">{t.quality}</label><div className="select-with-icon"><Gauge size={16} /><select id="download-quality" value={quality} onChange={(event) => setQuality(event.target.value as DownloadQuality)}><option value="best">{t.qualityBest}</option><option value="1080p">{t.quality1080}</option><option value="720p">{t.quality720}</option><option value="480p">{t.quality480}</option><option value="audio-320">{t.qualityAudio320}</option><option value="audio-192">{t.qualityAudio192}</option><option value="audio-128">{t.qualityAudio128}</option></select></div></div>
          <div className="modal-field-group"><label className="field-label" htmlFor="save-download-path">{t.saveTo}</label><div className="field-with-icon"><FolderOpen size={16} /><input id="save-download-path" className="save-path-input" dir="ltr" value={savePath} onChange={(event) => setSavePath(event.target.value)} placeholder={t.savePlaceholder} aria-label={t.saveTo} /></div><small className="save-path-hint">{t.savePathHint}</small></div>
        </div>
        <div className="modal-actions"><AppButton variant="secondary" onClick={onClose}>{t.close}</AppButton><AppButton type="submit" icon={<Plus size={16} />}>{t.addToQueue}</AppButton></div>
      </form>
    </div>
  );
}

function EmptyState({ language }: { language: Language }) {
  const t = copy[language];
  return <div className="empty-state"><div className="empty-icon"><Search size={22} /></div><strong>{t.empty}</strong><span>{t.emptySub}</span></div>;
}

export default function Home() {
  const [language, setLanguage] = useState<Language>(() => {
    try { const saved = window.localStorage.getItem("levelupnexus-language"); return saved === "en" ? "en" : "ar"; }
    catch { return "ar"; }
  });
  const t = copy[language];
  const [activeNav, setActiveNav] = useState<NavId>("downloads");
  const demoMode = typeof window !== "undefined" && !isTauriRuntime() && new URLSearchParams(window.location.search).get("demo") === "1";
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [selectedId, setSelectedId] = useState(demoMode ? demoPreviewDownloads[0].id : "");
  const [filter, setFilter] = useState<"all" | DownloadState>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [modal, setModal] = useState<"add" | null>(null);
  const [toast, setToast] = useState("");
  const [sfxEnabled, setSfxEnabled] = useState(() => { try { return window.localStorage.getItem("levelupnexus-sfx") !== "off"; } catch { return true; } });
  const [clipboardSnifferEnabled, setClipboardSnifferEnabled] = useState(() => { try { return window.localStorage.getItem("levelupnexus-clipboard-sniffer") === "on"; } catch { return false; } });
  const [clipboardCandidate, setClipboardCandidate] = useState("");
  const [celebrationId, setCelebrationId] = useState("");
  const ownClipboardWriteRef = useRef("");
  const sfxEnabledRef = useRef(sfxEnabled);
  const [mobileNav, setMobileNav] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try { return window.localStorage.getItem("levelupnexus-theme") === "light" ? "light" : "dark"; }
    catch { return "dark"; }
  });
  const [tauriMode, setTauriMode] = useState(() => isTauriRuntime());
  const [defaultDownloadDir, setDefaultDownloadDir] = useState("");
  const [engineStatus, setEngineStatus] = useState("");
  const [engineAvailability, setEngineAvailability] = useState<Record<TauriEngine, boolean>>({ "yt-dlp": false, aria2c: false });
  const availableEngineCount = Object.values(engineAvailability).filter(Boolean).length;
  const engineAvailable = availableEngineCount > 0;
  const [prefillUrl, setPrefillUrl] = useState("");
  const [quickAddUrl, setQuickAddUrl] = useState("");
  const openAddModal = (url = quickAddUrl) => {
    setPrefillUrl(url.trim());
    setModal("add");
  };

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    try { window.localStorage.setItem("levelupnexus-language", language); } catch { /* storage can be unavailable in restricted WebViews */ }
  }, [language]);

  useEffect(() => {
    try { window.localStorage.setItem("levelupnexus-theme", theme); } catch { /* storage can be unavailable in restricted WebViews */ }
  }, [theme]);

  useEffect(() => {
    sfxEnabledRef.current = sfxEnabled;
    try {
      window.localStorage.setItem("levelupnexus-sfx", sfxEnabled ? "on" : "off");
      window.localStorage.setItem("levelupnexus-clipboard-sniffer", clipboardSnifferEnabled ? "on" : "off");
    } catch { /* preferences remain usable for this session */ }
  }, [sfxEnabled, clipboardSnifferEnabled]);

  useEffect(() => {
    if (!clipboardSnifferEnabled || !tauriMode) { setClipboardCandidate(""); return; }
    let lastSeen = "";
    let busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const value = ((await invokeTauri<string>("read_clipboard_text")) ?? "").trim();
        const isLink = /^(https?:\/\/|magnet:\?)/i.test(value) && value.length <= 8192;
        if (!isLink) { lastSeen = value; setClipboardCandidate(""); }
        else if (value !== lastSeen) {
          lastSeen = value;
          if (value !== ownClipboardWriteRef.current) setClipboardCandidate(value);
          ownClipboardWriteRef.current = "";
        }
      } catch { /* clipboard can be busy or unavailable on the current platform */ }
      finally { busy = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1600);
    return () => window.clearInterval(timer);
  }, [clipboardSnifferEnabled, tauriMode]);

  useEffect(() => {
    let active = true;
    const pendingProgress = new Map<string, DownloadProgressEvent>();
    const changedDuringHydration = new Set<string>();
    let progressFrame: number | null = null;
    const cleanups: Array<() => void> = [];
    void (async () => {
      const runtime = isTauriRuntime();
      if (!active) return;
      setTauriMode(runtime);
      if (!runtime) return;
      const upsertTask = (task: TauriDownloadTask) => {
        changedDuringHydration.add(task.taskId);
        setSelectedId((current) => current || task.taskId);
        setDownloads((items) => {
        const item = taskToItem(task);
        return items.some((current) => current.id === item.id) ? items.map((current) => current.id === item.id ? { ...current, ...item } : current) : [item, ...items];
        });
      };
      const flushProgress = () => {
        progressFrame = null;
        if (!pendingProgress.size) return;
        const batch = [...pendingProgress.values()];
        pendingProgress.clear();
        const batchById = new Map(batch.map((event) => [event.taskId, event]));
        setDownloads((items) => {
          let changed = false;
          const nextItems = items.map((current) => {
            const event = batchById.get(current.id);
            if (!event) return current;
            const next = {
              ...current,
              progress: Math.round(event.progress),
              downloaded: formatBytes(event.downloadedBytes),
              size: event.totalBytes == null ? current.size : formatBytes(event.totalBytes),
              sizeBytes: event.totalBytes ?? current.sizeBytes,
              speed: formatSpeed(event.speedBytesPerSecond),
              speedBytesPerSecond: event.speedBytesPerSecond,
              eta: event.state === "downloading" && event.etaSeconds === 0 ? "—" : formatEta(event.etaSeconds),
              state: event.state === "paused" ? "paused" : event.state === "failed" ? "error" : event.state === "cancelled" ? "cancelled" : event.state === "completed" ? "completed" : "downloading",
              name: event.filename || current.name,
              playlistItems: event.playlistItems ?? current.playlistItems,
              playlistCurrentIndex: event.playlistCurrentIndex ?? current.playlistCurrentIndex,
              playlistTotal: event.playlistTotal ?? current.playlistTotal,
            } satisfies DownloadItem;
            const isSame = next.progress === current.progress && next.downloaded === current.downloaded && next.size === current.size && next.sizeBytes === current.sizeBytes && next.speed === current.speed && next.speedBytesPerSecond === current.speedBytesPerSecond && next.eta === current.eta && next.state === current.state && next.name === current.name && next.playlistItems === current.playlistItems;
            if (isSame) return current;
            changed = true;
            return next;
          });
          return changed ? nextItems : items;
        });
      };
      const updateProgress = (event: DownloadProgressEvent) => {
        changedDuringHydration.add(event.taskId);
        pendingProgress.set(event.taskId, event);
        if (progressFrame === null) progressFrame = window.requestAnimationFrame(flushProgress);
      };
      const failed = (event: { taskId: string; error?: string; playlistItem?: number }) => {
        const detail = event.error?.slice(0, 520) || (language === "ar" ? "فشل محرك التنزيل" : "Download engine failed");
        setToast(`${copy[language].downloadError}: ${detail}`);
        setDownloads((items) => items.map((current) => {
          if (current.id !== event.taskId) return current;
          const playlistItems = event.playlistItem
            ? current.playlistItems.map((item) => item.index === event.playlistItem ? { ...item, state: "failed" as const, speedBytesPerSecond: 0, etaSeconds: undefined } : item)
            : current.playlistItems;
          return { ...current, playlistItems, state: "error", speed: "0 B/s", speedBytesPerSecond: 0, eta: detail };
        }));
      };
      for (const eventName of ["download://queued", "download://started", "download://completed", "download://paused", "download://resumed", "download://cancelled"]) {
        const cleanup = await listenTauri<TauriDownloadTask>(eventName, (task) => {
          upsertTask(task);
          if (eventName === "download://completed") {
            if (sfxEnabledRef.current) playUiSfx("complete");
            setCelebrationId(task.taskId);
            window.setTimeout(() => setCelebrationId((current) => current === task.taskId ? "" : current), 1900);
          }
        });
        if (cleanup) cleanups.push(cleanup);
      }
      const progressCleanup = await listenTauri<DownloadProgressEvent>("download://progress", updateProgress);
      if (progressCleanup) cleanups.push(progressCleanup);
      const failedCleanup = await listenTauri<{ taskId: string; error?: string; playlistItem?: number }>("download://failed", failed);
      if (failedCleanup) cleanups.push(failedCleanup);
      const [directory, tasks, engineInfo] = await Promise.all([
        invokeTauri<string>("get_default_download_dir"),
        invokeTauri<TauriDownloadTask[]>("list_downloads"),
        invokeTauri<{ engines: { engine: TauriEngine; available: boolean; error?: string | null }[] }>("get_engine_status").catch((error: unknown) => { setEngineStatus(`${copy[language].noEngines}: ${readableCommandError(error)}`); return null; }),
      ]);
      if (!active) return;
      if (directory) setDefaultDownloadDir(directory);
      setEngineAvailability({
        "yt-dlp": Boolean(engineInfo?.engines.some((engine) => engine.engine === "yt-dlp" && engine.available)),
        aria2c: Boolean(engineInfo?.engines.some((engine) => engine.engine === "aria2c" && engine.available)),
      });
      if (engineInfo && !engineInfo.engines.some((engine) => engine.available)) {
        const diagnostic = engineInfo.engines.map((engine) => engine.error).filter(Boolean).join("; ");
        setEngineStatus(diagnostic ? `${copy[language].noEngines}: ${diagnostic}` : copy[language].noEngines);
      }
      if (tasks?.length) {
        setDownloads((current) => {
          const merged = new Map(tasks.map((task) => [task.taskId, taskToItem(task)]));
          current.forEach((item) => {
            if (changedDuringHydration.has(item.id) || !merged.has(item.id)) merged.set(item.id, item);
          });
          return [...merged.values()];
        });
        setSelectedId((current) => current || tasks[0].taskId);
      }
    })().catch((error: unknown) => {
      console.error("[LEVEL UP NEXUS] Failed to initialize the Tauri desktop bridge", error);
      if (active) setTauriMode(isTauriRuntime());
    });
    return () => {
      active = false;
      pendingProgress.clear();
      if (progressFrame !== null) window.cancelAnimationFrame(progressFrame);
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const visibleSourceDownloads = demoMode ? demoPreviewDownloads : downloads;
  const activeCount = visibleSourceDownloads.filter((item) => item.state === "downloading").length;
  const completedCount = visibleSourceDownloads.filter((item) => item.state === "completed").length;
  const totalSpeed = visibleSourceDownloads.filter((item) => item.state === "downloading").reduce((sum, item) => sum + item.speedBytesPerSecond, 0);
  const totalStored = visibleSourceDownloads.filter((item) => item.state === "completed").reduce((sum, item) => sum + item.sizeBytes, 0);
  const selected = visibleSourceDownloads.find((item) => item.id === selectedId) ?? null;

  const visibleDownloads = useMemo(() => {
    const query = search.trim().toLowerCase();
    return visibleSourceDownloads
      .filter((item) => filter === "all" || item.state === filter)
      .filter((item) => !query || item.name.toLowerCase().includes(query) || item.url.toLowerCase().includes(query))
      .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, language) : sort === "size" ? b.sizeBytes - a.sizeBytes : Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [visibleSourceDownloads, filter, search, sort, language]);

  const addDownload = async (url: string, requestedPath = defaultDownloadDir, playlist = false, quality: DownloadQuality = "best") => {
    if (demoMode) { setToast(t.demoReadOnly); return; }
    const isAudio = /soundcloud|\.flac|\.mp3/i.test(url);
    if (!tauriMode) {
      setToast(t.desktopRequired);
      return;
    }
    if (sfxEnabled) playUiSfx("action");
    try {
      const task = await invokeTauri<TauriDownloadTask>("start_download", {
        url,
        downloadDir: requestedPath || defaultDownloadDir,
        options: { connections: 16, audioOnly: isAudio, playlist, quality },
      });
      if (!task) throw new Error("Tauri runtime unavailable");
      setDownloads((items) => [taskToItem(task), ...items.filter((item) => item.id !== task.taskId)]);
      setSelectedId(task.taskId);
      if (quickAddUrl.trim() === url.trim()) setQuickAddUrl("");
      setPrefillUrl("");
      setModal(null);
      setActiveNav("downloads");
      setToast(t.downloadAdded);
    } catch (error) {
      const detail = readableCommandError(error).slice(0, 220);
      console.error("[LEVEL UP NEXUS] start_download failed", error);
      setToast(`${t.downloadError}: ${detail}`);
    }
  };

  const toggleState = async (id: string) => {
    if (demoMode) { setToast(t.demoReadOnly); return; }
    if (tauriMode) {
      const item = downloads.find((current) => current.id === id);
      if (!item) return;
      try {
        if (item.state === "downloading") await invokeTauri("pause_download", { taskId: id });
        else if (item.state === "paused") await invokeTauri("resume_download", { taskId: id });
      } catch {
        setToast(t.downloadError);
      }
      return;
    }
    setToast(t.desktopRequired);
  };

  const removeItem = async (id: string) => {
    if (demoMode) { setToast(t.demoReadOnly); return; }
    if (tauriMode) {
      try {
        await invokeTauri("remove_download", { taskId: id });
      } catch (error) {
        console.error("[LEVEL UP NEXUS] Could not remove download", error);
        setToast(t.downloadError);
        return;
      }
    }
    setDownloads((items) => items.filter((item) => item.id !== id));
    if (selectedId === id) setSelectedId(downloads.find((item) => item.id !== id)?.id ?? "");
    setToast(t.removed);
  };

  const copyLink = async () => {
    if (demoMode) { setToast(t.demoReadOnly); return; }
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.url);
      ownClipboardWriteRef.current = selected.url;
      if (sfxEnabled) playUiSfx("copy");
      setToast(t.copied);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = selected.url;
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      const copied = document.execCommand("copy");
      textArea.remove();
      if (copied) { ownClipboardWriteRef.current = selected.url; if (sfxEnabled) playUiSfx("copy"); }
      setToast(copied ? t.copied : t.copyFailed);
    }
  };

  const runWindowAction = async (action: () => Promise<void>) => {
    if (!tauriMode) { setToast(t.windowDesktopOnly); return; }
    try { await action(); } catch (error) { console.error("[LEVEL UP NEXUS] Window action failed", error); setToast(t.windowDesktopOnly); }
  };

  const openSelectedFolder = async () => {
    if (demoMode) { setToast(t.demoReadOnly); return; }
    if (!selected || !tauriMode) {
      setToast(t.desktopRequired);
      return;
    }
    try {
      await invokeTauri("open_file_location", { path: selected.location });
    } catch {
      setToast(t.openFolderError);
    }
  };

  const cancelDownload = async (id: string) => {
    if (demoMode) { setToast(t.demoReadOnly); return; }
    if (!tauriMode) { setToast(t.desktopRequired); return; }
    try {
      const task = await invokeTauri<TauriDownloadTask>("cancel_download", { taskId: id });
      if (task) setDownloads((items) => items.map((item) => item.id === id ? taskToItem(task) : item));
      setToast(t.cancelled);
    } catch { setToast(t.downloadError); }
  };

  const pasteClipboardLink = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) { setToast(t.copyFailed); return; }
      openAddModal(text);
    } catch { setToast(t.clipboardReadError); }
  };

  const openDownloadsFolder = async () => {
    if (!tauriMode) { setToast(t.desktopRequired); return; }
    try {
      const path = defaultDownloadDir || await invokeTauri<string>("get_default_download_dir");
      if (!path) throw new Error("Downloads folder is unavailable");
      await invokeTauri("open_file_location", { path });
    } catch { setToast(t.openFolderError); }
  };

  const checkEngines = async () => {
    if (!tauriMode) { setEngineStatus(t.desktopRequired); return; }
    try {
      const result = await invokeTauri<{ engines: { engine: string; available: boolean }[] }>("get_engine_status");
      const available = result?.engines.filter((engine) => engine.available).map((engine) => engine.engine) ?? [];
      setEngineAvailability({
        "yt-dlp": Boolean(result?.engines.some((engine) => engine.engine === "yt-dlp" && engine.available)),
        aria2c: Boolean(result?.engines.some((engine) => engine.engine === "aria2c" && engine.available)),
      });
      setEngineStatus(available.length ? `${t.enginesReady}: ${available.join(" · ")}` : t.noEngines);
    } catch (error) {
      const detail = typeof error === "string" ? error : error && typeof error === "object" && "message" in error ? String(error.message) : "";
      setEngineStatus(`${t.noEngines}${detail ? ` — ${detail}` : ""}`);
    }
  };

  const navItems: { id: NavId; label: string; count?: number }[] = [
    { id: "downloads", label: t.downloads, count: activeCount },
    { id: "library", label: t.library },
    { id: "browser", label: t.browser },
    { id: "utilities", label: t.utilities },
  ];

  return (
    <div className={`nexus-app ${theme}`} dir={language === "ar" ? "rtl" : "ltr"}>
      <header className="window-bar">
        <div className="window-brand">
          <NexusMark size="small" />
          <span className="window-brand-copy"><strong>{t.brandTitle}</strong><small>{t.brandTagline}</small></span>
        </div>
        <div className="window-actions">
          <span className={`engine-indicator ${tauriMode && availableEngineCount === 2 ? "online" : tauriMode && availableEngineCount > 0 ? "partial" : "offline"}`}>
            <span className="engine-indicator-dot" />
            <span>{!tauriMode ? t.previewOnly : availableEngineCount ? `${t.liveEngines}: ${availableEngineCount}/2 ${t.online}` : t.noEngines}</span>
          </span>
          <div className="header-segment" role="group" aria-label={language === "ar" ? "المظهر" : "Appearance"}>
            <button type="button" className={theme === "dark" ? "active" : ""} aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}><Moon size={14} />{t.themeDark}</button>
            <button type="button" className={theme === "light" ? "active" : ""} aria-pressed={theme === "light"} onClick={() => setTheme("light")}><Sun size={14} />{t.themeLight}</button>
          </div>
          <div className="header-segment language-segment" role="group" aria-label={t.languageToggle}>
            <button type="button" className={language === "ar" ? "active" : ""} aria-pressed={language === "ar"} onClick={() => setLanguage("ar")}>{t.arabicLanguage}</button>
            <button type="button" className={language === "en" ? "active" : ""} aria-pressed={language === "en"} onClick={() => setLanguage("en")}>{t.englishLanguage}</button>
          </div>
          <button className="window-icon" aria-label={t.minimizeWindow} disabled={!tauriMode} title={!tauriMode ? t.windowDesktopOnly : undefined} onClick={() => void runWindowAction(minimizeAppWindow)}>−</button>
          <button className="window-icon" aria-label={t.maximizeWindow} disabled={!tauriMode} title={!tauriMode ? t.windowDesktopOnly : undefined} onClick={() => void runWindowAction(toggleAppWindowMaximize)}>□</button>
          <button className="window-icon close" aria-label={t.closeWindow} disabled={!tauriMode} title={!tauriMode ? t.windowDesktopOnly : undefined} onClick={() => void runWindowAction(closeAppWindow)}>×</button>
        </div>
      </header>

      <div className="app-shell">
        <aside className={`sidebar ${mobileNav ? "is-open" : ""}`}>
          <button className="mobile-close" aria-label={t.close} onClick={() => setMobileNav(false)}><X size={18} /></button>
          <nav className="main-nav" aria-label={t.navAriaLabel}>
            {navItems.map((item) => <button key={item.id} className={`nav-item ${activeNav === item.id ? "active" : ""}`} aria-current={activeNav === item.id ? "page" : undefined} onClick={() => { setActiveNav(item.id); setMobileNav(false); }}><span className="nav-item-icon"><SectionIcon id={item.id} /></span><span>{item.label}</span>{item.count ? <b>{item.count}</b> : null}</button>)}
          </nav>
          <div className="sidebar-footer">
            <button className={`nav-item settings-nav ${activeNav === "settings" ? "active" : ""}`} aria-current={activeNav === "settings" ? "page" : undefined} onClick={() => { setActiveNav("settings"); setMobileNav(false); }}><span className="nav-item-icon"><Settings2 size={17} strokeWidth={1.8} /></span><span>{t.settings}</span></button>
          </div>
        </aside>

        <main className="main-content">
          <div className="mobile-top"><button onClick={() => setMobileNav(true)}><Menu size={20} /></button><NexusMark size="small" /><strong>{t.nexus}</strong><button onClick={() => openAddModal()}><Plus size={19} /></button></div>
          <div className="content-scroll">
            <div key={activeNav} className="view-transition">
            {activeNav === "downloads" ? <DownloadsView language={language} demoMode={demoMode} downloads={visibleSourceDownloads} visibleDownloads={visibleDownloads} selectedId={selectedId} filter={filter} setFilter={setFilter} search={search} setSearch={setSearch} sort={sort} setSort={setSort} activeCount={activeCount} completedCount={completedCount} pausedCount={visibleSourceDownloads.filter((item) => item.state === "paused").length} failedCount={visibleSourceDownloads.filter((item) => item.state === "error").length} totalSpeed={totalSpeed} onNewDownload={() => openAddModal()} onSelect={setSelectedId} onToggle={(id) => void toggleState(id)} onCancel={(id) => void cancelDownload(id)} onRemove={(id) => void removeItem(id)} /> : activeNav === "browser" ? <BrowserView language={language} /> : (activeNav === "utilities" || activeNav === "settings") ? <UtilitiesView language={language} settingsOnly={activeNav === "settings"} pasteClipboardLink={pasteClipboardLink} openDownloadsFolder={openDownloadsFolder} checkEngines={checkEngines} engineStatus={engineStatus} sfxEnabled={sfxEnabled} setSfxEnabled={setSfxEnabled} clipboardSnifferEnabled={clipboardSnifferEnabled} setClipboardSnifferEnabled={setClipboardSnifferEnabled} /> : activeNav === "library" ? <LibraryView language={language} downloads={downloads} onOpen={async (item) => { setSelectedId(item.id); setActiveNav("downloads"); try { await invokeTauri("open_file_location", { path: item.location }); } catch { setToast(t.openFolder); } }} /> : <>
              <div className="content-heading"><div><div className="eyebrow control-room-eyebrow"><span className="eyebrow-line" /> {t.controlRoom}</div><h1>{t.overview}</h1><p>{t.overviewSub}</p></div><div className="heading-actions"><AppButton icon={<Plus size={17} />} onClick={() => openAddModal()}>{t.newDownload}</AppButton></div></div>
              <section className="hero-card"><div className="hero-glow" /><div className="hero-copy"><div className="hero-chip"><span className="pulse-dot" /> {engineAvailable ? t.connected : tauriMode ? t.noEngines : t.previewOnly}</div><h2>{t.heroTitle}<br /><span>{t.heroTitleAccent}</span></h2><p>{t.inputPlaceholder}</p><div className="quick-add"><Link2 size={17} /><input value={quickAddUrl} onChange={(event) => setQuickAddUrl(event.target.value)} placeholder={t.inputPlaceholder} onKeyDown={(event) => { if (event.key === "Enter" && quickAddUrl.trim()) void addDownload(quickAddUrl.trim()); }} /><button onClick={() => openAddModal()}><Plus size={17} /> {t.newDownload}</button></div><div className="hero-meta"><span><Zap size={13} /> {t.routeVideo}</span><span><ShieldCheck size={13} /> {engineAvailable ? t.liveMode : tauriMode ? t.noEngines : t.previewOnly}</span></div></div><div className="hero-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="hero-logo"><NexusMark size="large" /></div><div className="float-stat float-stat-top"><span>{t.queueHealth}</span><strong>{activeCount}</strong></div><div className="float-stat float-stat-bottom"><Activity size={13} /><span>{formatSpeed(totalSpeed)}</span><b>{activeCount > 0 ? t.live : "—"}</b></div></div></section>

              <section className="stat-grid"><StatCard icon={<ArrowDownToLine />} label={t.activeDownloads} value={String(activeCount).padStart(2, "0")} hint={t.activeSub} color="cyan" onClick={() => { setActiveNav("downloads"); setFilter("downloading"); }} /><StatCard icon={<CheckCircle2 />} label={t.completed} value={String(completedCount).padStart(2, "0")} hint={t.completedSub} color="purple" onClick={() => { setActiveNav("downloads"); setFilter("completed"); }} /><StatCard icon={<HardDrive />} label={t.totalStored} value={formatBytes(totalStored)} hint={t.totalStoredSub} color="pink" onClick={() => setActiveNav("library")} /><StatCard icon={<Gauge />} label={t.currentSpeed} value={formatSpeed(totalSpeed)} hint={engineAvailable ? t.liveMode : tauriMode ? t.noEngines : t.previewOnly} color="amber" onClick={() => { setActiveNav("downloads"); setFilter("downloading"); }} /></section>

              <section className="queue-panel panel"><div className="panel-heading"><div><div className="panel-title"><span className="live-dot" /> {t.queue}</div><p>{t.queueSub}</p></div><button className="text-button" onClick={() => { setActiveNav("downloads"); setFilter("all"); }}>{t.viewAll} <ArrowUpRight size={14} /></button></div><QueueToolbar language={language} search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} />
                <div className="queue-list">{visibleDownloads.slice(0, activeNav === "home" ? 4 : undefined).map((item) => <MemoLazyDownloadRow key={item.id} item={item} language={language} selected={selectedId === item.id} onSelect={() => setSelectedId(item.id)} onToggle={() => toggleState(item.id)} onCancel={() => void cancelDownload(item.id)} onRemove={() => removeItem(item.id)} />)}</div>{visibleDownloads.length === 0 ? <EmptyState language={language} /> : null}</section>
            </>}
            </div>
          </div>
        </main>

        <aside className="right-rail">
          <div className="rail-section detail-sidebar">
            <div className="rail-title"><span>{t.selectedDownload}</span><button type="button" className="detail-close" aria-label={t.close} onClick={() => setSelectedId("")}><X size={17} /></button></div>
            {selected ? <>
              <div className="detail-selected-header"><div className={`detail-file-icon ${selected.accent}`}><CategoryIcon type={selected.type} /></div><h3 className="detail-name" title={selected.name}>{selected.name}</h3></div>
              <span className="detail-field-label">URL</span>
              <div className="detail-url-row"><span className="detail-url" dir="ltr" title={selected.url}>{selected.url}</span><button type="button" aria-label={t.copyLink} disabled={demoMode} title={demoMode ? t.demoReadOnly : undefined} onClick={copyLink}><Copy size={15} /></button></div>
              <div className="detail-progress"><div className="detail-progress-head"><span>{t.progress}</span><strong>{selected.progress}%</strong></div><div className="progress-track"><span className={`progress-fill ${selected.accent}`} style={{ width: `${selected.progress}%` }} /></div></div>
              <div className="detail-meta-list">
                <div className="detail-meta-row"><span>{t.speed}</span><strong>{selected.speed}</strong></div>
                <div className="detail-meta-row"><span>{t.eta}</span><strong>{selected.state === "completed" ? t.noTime : selected.eta}</strong></div>
                <div className="detail-meta-row"><span>{t.size}</span><strong>{selected.size}</strong></div>
                <div className="detail-meta-row"><span>{t.engine}</span><strong>{selected.engine}</strong></div>
                <div className="detail-meta-row"><span>{t.status}</span><strong className={`detail-status-value ${selected.state}`}><i />{statusLabel(selected.state, language)}</strong></div>
                <div className="detail-meta-row detail-save-row"><span>{t.saveTo}</span><strong dir="ltr" title={selected.location}>{selected.location}</strong></div>
              </div>
              <PlaylistProgressList items={selected.playlistItems} language={language} currentIndex={selected.playlistCurrentIndex} taskState={selected.state} onToggle={() => toggleState(selected.id)} />
              <div className="detail-actions">
                {selected.state === "downloading" ? <button type="button" className="detail-action-primary" disabled={demoMode} title={demoMode ? t.demoReadOnly : undefined} onClick={() => void toggleState(selected.id)}><Pause size={15} /> {t.pause}</button> : selected.state === "paused" ? <button type="button" className="detail-action-primary" disabled={demoMode} title={demoMode ? t.demoReadOnly : undefined} onClick={() => void toggleState(selected.id)}><Play size={15} /> {t.resumeDownload}</button> : null}
                <button type="button" disabled={demoMode} title={demoMode ? t.demoReadOnly : undefined} onClick={copyLink}><Copy size={15} /> {t.copyLink}</button>
                <button type="button" disabled={demoMode} title={demoMode ? t.demoReadOnly : undefined} onClick={openSelectedFolder}><FolderOpen size={15} /> {t.openFolder}</button>
              </div>
            </> : <div className="rail-empty">{t.selectHint}</div>}
          </div>
        </aside>
      </div>

      {modal === "add" ? <AddDownloadModal language={language} defaultPath={defaultDownloadDir} initialUrl={prefillUrl} tauriMode={tauriMode} engineAvailable={engineAvailable} onClose={() => { setModal(null); setPrefillUrl(""); }} onAdd={addDownload} /> : null}
      {toast ? <div className={`toast ${toast.startsWith(t.downloadError) ? "toast--error" : ""}`}>{toast.startsWith(t.downloadError) ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />} {toast}</div> : null}
      {clipboardCandidate ? <div className="clipboard-toast" role="status"><div><strong>{language === "ar" ? "رابط جديد في الحافظة" : "Link detected in clipboard"}</strong><span dir="ltr">{clipboardCandidate.length > 100 ? `${clipboardCandidate.slice(0, 100)}…` : clipboardCandidate}</span></div><button type="button" onClick={() => { const link = clipboardCandidate; setClipboardCandidate(""); void addDownload(link, defaultDownloadDir); if (sfxEnabled) playUiSfx("action"); }}>{language === "ar" ? "تنزيل" : "Download"}</button><button type="button" className="clipboard-dismiss" aria-label={language === "ar" ? "إغلاق" : "Dismiss"} onClick={() => setClipboardCandidate("")}>×</button></div> : null}
      {celebrationId ? <div className="download-celebration" key={celebrationId} aria-hidden="true">{Array.from({ length: 22 }, (_, index) => <i key={index} style={{ "--x": `${(index % 11 - 5) * 22}px`, "--y": `${-95 - (index % 5) * 35}px`, "--hue": `${(index * 37) % 360}` } as React.CSSProperties} />)}</div> : null}
    </div>
  );
}

function StatCard({ icon, label, value, hint, color, onClick }: { icon: React.ReactNode; label: string; value: string; hint: string; color: string; onClick: () => void }) {
  const previousValue = useRef(value);
  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    if (previousValue.current === value) return;
    previousValue.current = value;
    setUpdating(true);
    const timer = window.setTimeout(() => setUpdating(false), 650);
    return () => window.clearTimeout(timer);
  }, [value]);
  return <button type="button" className={`stat-card ${color}${updating ? " is-updating" : ""}`} onClick={onClick}><span className="stat-icon">{icon}</span><span className="stat-label">{label}</span><strong>{value}</strong><span className="stat-hint">{hint}</span><span className="stat-spark" aria-hidden="true"><i /><i /><i /><i /><i /></span></button>;
}

function QueueToolbar({ language, search, setSearch, filter, setFilter, sort, setSort }: { language: Language; search: string; setSearch: (value: string) => void; filter: "all" | DownloadState; setFilter: (value: "all" | DownloadState) => void; sort: string; setSort: (value: string) => void }) {
  const t = copy[language];
  return <div className="queue-toolbar"><div className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.search} /></div><div className="filter-tabs">{([["all", t.all], ["downloading", t.active], ["paused", t.paused], ["completed", t.done], ["error", t.failed], ["cancelled", t.cancelledFilter]] as const).map(([value, label]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div><label className="sort-field"><span>{t.sort}</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">{t.newest}</option><option value="name">{t.name}</option><option value="size">{t.size}</option></select><ChevronDown size={13} /></label></div>;
}

type DownloadsViewProps = {
  language: Language;
  demoMode: boolean;
  downloads: DownloadItem[];
  visibleDownloads: DownloadItem[];
  selectedId: string;
  filter: "all" | DownloadState;
  setFilter: (value: "all" | DownloadState) => void;
  search: string;
  setSearch: (value: string) => void;
  sort: string;
  setSort: (value: string) => void;
  activeCount: number;
  completedCount: number;
  pausedCount: number;
  failedCount: number;
  totalSpeed: number;
  onNewDownload: () => void;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
};

function DownloadsView(props: DownloadsViewProps) {
  const { language, demoMode, downloads, visibleDownloads, filter, setFilter, search, setSearch, sort, setSort, activeCount, completedCount, pausedCount, failedCount, totalSpeed, onNewDownload, onSelect, onToggle, onCancel, onRemove } = props;
  const t = copy[language];
  useEffect(() => {
    const focusDownloadsSearch = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f") return;
      const input = document.querySelector<HTMLInputElement>(".download-heading-search input");
      if (!input) return;
      event.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener("keydown", focusDownloadsSearch);
    return () => window.removeEventListener("keydown", focusDownloadsSearch);
  }, []);
  const metrics = [
    { label: t.totalDownloads, value: String(downloads.length), accent: "blue" },
    { label: t.active, value: String(activeCount), accent: "cyan" },
    { label: t.completed, value: String(completedCount), accent: "green" },
    { label: t.paused, value: String(pausedCount), accent: "amber" },
    { label: t.failed, value: String(failedCount), accent: "red" },
    { label: t.totalSpeed, value: formatSpeed(totalSpeed), accent: "slate" },
  ];
  const filters = [["all", t.all], ["downloading", t.active], ["paused", t.paused], ["completed", t.done], ["error", t.failed]] as const;
  return <section className="downloads-view" dir={language === "ar" ? "rtl" : "ltr"}>
    <div className="content-heading downloads-heading">
      <div><h1>{t.downloads}</h1><p>{t.downloadsSub}</p>{props.demoMode ? <span className="demo-only-badge">{t.demoPreview}</span> : null}</div>
      <div className="heading-actions downloads-heading-actions">
        <label className="search-field download-heading-search"><Search size={16} /><input id="downloads-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.search} aria-label={t.search} /><kbd>Ctrl+F</kbd></label>
        <AppButton icon={<Plus size={17} />} onClick={onNewDownload}>{t.newDownload}</AppButton>
      </div>
    </div>
    <div className="download-summary">{metrics.map((metric) => <div className={`download-summary-card ${metric.accent}`} key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}</div>
    <section className="panel downloads-panel" aria-label={t.queue}>
      <div className="downloads-toolbar">
        <div className="downloads-filter-tabs" role="tablist" aria-label={t.status}>{filters.map(([value, label]) => <button type="button" role="tab" aria-selected={filter === value} key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}<span>{value === "all" ? downloads.length : downloads.filter((item) => item.state === value).length}</span></button>)}</div>
        <label className="sort-field"><span>{t.sort}</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">{t.newest}</option><option value="name">{t.name}</option><option value="size">{t.size}</option></select><ChevronDown size={13} /></label>
      </div>
      <div className="downloads-table-wrap"><div className="downloads-table-head" aria-hidden="true"><span>{t.name}</span><span>{t.progress}</span><span>{t.speed}</span><span>{t.eta}</span><span>{t.size}</span><span>{t.engine}</span><span>{t.status}</span><span>{t.actions}</span></div>
        {visibleDownloads.length ? <div className="downloads-table-body">{visibleDownloads.map((item) => <DownloadsTableRow key={item.id} item={item} language={language} selected={props.selectedId === item.id} onSelect={() => onSelect(item.id)} onToggle={() => onToggle(item.id)} onCancel={() => onCancel(item.id)} onRemove={() => onRemove(item.id)} demoMode={demoMode} />)}</div> : <EmptyState language={language} />}
      </div>
    </section>
  </section>;
}

function DownloadsTableRow({ item, language, selected, onSelect, onToggle, onCancel, onRemove, demoMode = false }: DownloadRowProps) {
  const t = copy[language];
  const unknownSize = item.state === "downloading" && item.sizeBytes <= 0;
  return <article className={`downloads-table-row${selected ? " selected" : ""}`} role="group" aria-label={item.name} tabIndex={0} onClick={onSelect} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelect(); } }}>
    <div className="downloads-name-cell"><span className={`file-icon ${item.accent}`}><CategoryIcon type={item.type} /></span><span className="downloads-file-name" title={item.name}>{item.name}</span></div>
    <div className="downloads-progress-cell"><div><strong>{unknownSize ? item.downloaded : `${item.progress}%`}</strong><span className={`row-progress${unknownSize ? " is-indeterminate" : ""}`}><i className={`progress-fill ${item.accent}`} style={{ width: unknownSize ? "34%" : `${item.progress}%` }} /></span></div></div>
    <span className="downloads-speed-cell">{item.speed}</span><span className="downloads-eta-cell">{item.state === "completed" ? t.noTime : item.eta}</span><span className="downloads-size-cell">{item.size}</span><span className="downloads-engine-cell">{item.engine}</span><span className={`downloads-status-cell ${item.state}`}><i />{statusLabel(item.state, language)}</span>
    <div className="downloads-row-actions">{item.state === "downloading" || item.state === "paused" ? <><button type="button" aria-label={item.state === "downloading" ? t.pause : t.resume} disabled={demoMode} title={demoMode ? t.demoReadOnly : undefined} onClick={(event) => { event.stopPropagation(); onToggle(); }}>{item.state === "downloading" ? <Pause size={14} /> : <Play size={14} />}</button><button type="button" aria-label={t.cancelDownload} disabled={demoMode} title={demoMode ? t.demoReadOnly : undefined} onClick={(event) => { event.stopPropagation(); onCancel(); }}><X size={14} /></button></> : null}<button type="button" aria-label={t.remove} disabled={demoMode} title={demoMode ? t.demoReadOnly : undefined} onClick={(event) => { event.stopPropagation(); onRemove(); }}><Trash2 size={14} /></button></div>
  </article>;
}

type DownloadRowProps = { item: DownloadItem; language: Language; selected: boolean; onSelect: () => void; onToggle: () => void; onCancel: () => void; onRemove: () => void; demoMode?: boolean };

function LazyDownloadRow(props: DownloadRowProps) {
  const [isVisible, setIsVisible] = useState(false);
  const placeholderRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isVisible) return;
    const target = placeholderRef.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }
    const root = target.closest(".content-scroll");
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
        observer.disconnect();
      }
    }, { root, rootMargin: "240px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [isVisible]);

  if (isVisible) return <MemoDownloadRow {...props} />;
  return <article ref={placeholderRef} className="download-row download-row--placeholder" aria-hidden="true"><span /><div><span /><span /><i /></div><span /><span /></article>;
}

function DownloadRow({ item, language, selected, onSelect, onToggle, onCancel, onRemove }: DownloadRowProps) {
  const t = copy[language];
  const added = relativeTimeLabel(item.createdAt, language);
  return <article className={`download-row ${selected ? "selected" : ""}`} role="group" aria-label={item.name} tabIndex={0} onClick={onSelect} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelect(); } }}><div className={`file-icon ${item.accent}`}><CategoryIcon type={item.type} /></div><div className="download-main"><div className="download-line"><strong title={item.name}>{item.name}</strong><span className={`state-pill ${item.state}`}>{statusLabel(item.state, language)}</span></div><div className="download-meta"><span>{item.engine}</span><i /> <span>{item.downloaded} / {item.size}</span><i /> <span>{added}</span></div><div className={`row-progress${item.state === "downloading" && item.sizeBytes <= 0 ? " is-indeterminate" : ""}`}><span className={`progress-fill ${item.accent}`} style={{ width: item.state === "downloading" && item.sizeBytes <= 0 ? "34%" : `${item.progress}%` }} /></div><div className="row-bottom"><span>{item.sizeBytes <= 0 && item.state === "downloading" ? `${item.downloaded} · ${language === "ar" ? "جارٍ التقدير" : "estimating"}` : `${item.progress}% ${t.progress.toLowerCase()}`}</span><span>{item.state === "completed" ? t.noTime : item.eta}</span></div></div><div className="download-speed"><strong>{item.speed}</strong><span>{item.state === "completed" ? "—" : t.speed}</span></div><div className="row-actions">{item.state === "downloading" || item.state === "paused" ? <button aria-label={item.state === "downloading" ? t.pause : t.resume} onClick={(event) => { event.stopPropagation(); onToggle(); }}>{item.state === "downloading" ? <Pause size={15} /> : <Play size={15} />}</button> : null}{item.state === "downloading" || item.state === "paused" ? <button aria-label={t.cancelDownload} onClick={(event) => { event.stopPropagation(); onCancel(); }}><X size={14} /></button> : null}<button aria-label={t.remove} onClick={(event) => { event.stopPropagation(); onRemove(); }}><Trash2 size={15} /></button></div></article>;
}

const areDownloadRowPropsEqual = (previous: DownloadRowProps, next: DownloadRowProps) => previous.item === next.item && previous.language === next.language && previous.selected === next.selected;
const MemoDownloadRow = memo(DownloadRow, areDownloadRowPropsEqual);
const MemoLazyDownloadRow = memo(LazyDownloadRow, areDownloadRowPropsEqual);


function PlaylistProgressList({ items, language, currentIndex, taskState, onToggle }: { items: PlaylistItemProgress[]; language: Language; currentIndex?: number; taskState: DownloadState; onToggle: () => void }) {
  const t = copy[language];
  if (!items.length) return null;
  return <div className="playlist-progress"><div className="playlist-progress-heading"><span>{t.playlistProgress}</span><strong>{items.filter((item) => item.state === "completed").length}/{items.length}</strong></div><div className="playlist-progress-list">{items.map((item) => { const current = item.index === currentIndex; const paused = current && taskState === "paused"; return <div className="playlist-progress-item" key={item.index}><div className="playlist-item-line"><span>{item.index}. {item.title || `${t.item} ${item.index}`}</span><strong>{Math.round(item.progress)}%</strong></div><div className="playlist-item-track"><span style={{ width: `${item.progress}%` }} /></div><div className="playlist-item-status"><small>{item.state === "completed" ? t.done : paused ? t.paused : item.state === "failed" ? t.failed : item.speedBytesPerSecond ? formatSpeed(item.speedBytesPerSecond) : t.active}</small>{current && (taskState === "downloading" || taskState === "paused") ? <button type="button" onClick={onToggle} aria-label={paused ? t.resume : t.pause}>{paused ? <Play size={12} /> : <Pause size={12} />}</button> : null}</div></div>; })}</div></div>;
}
function CategoryIcon({ type }: { type: Category }) { const Icon = iconForCategory(type); return <Icon size={21} strokeWidth={1.7} />; }
function CategoryLine({ icon, label, value, percent, color }: { icon: React.ReactNode; label: string; value: string; percent: number; color: string }) { return <div className="category-line"><div className="category-line-top"><span>{icon}{label}</span><strong>{value}</strong></div><div className="category-track"><i className={color} style={{ width: `${percent}%` }} /></div></div>; }

function BrowserView({ language }: { language: Language }) {
  const t = copy[language];
  const [url, setUrl] = useState("https://www.youtube.com");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([]);
  useEffect(() => {
    let active = true;
    let unlistenUpdated: (() => void) | null = null;
    let unlistenClosed: (() => void) | null = null;
    const mergeTab = (tab: BrowserTab) => setBrowserTabs((current) => {
      const merged = current.filter((item) => item.label !== tab.label);
      return tab.active ? [tab, ...merged.map((item) => ({ ...item, active: false }))] : [...merged, tab];
    });
    void (async () => {
      const [updated, closed] = await Promise.all([
        listenTauri<BrowserTab>("browser://tab-updated", (tab) => { if (active) mergeTab(tab); }),
        listenTauri<string>("browser://tab-closed", (label) => { if (active) setBrowserTabs((current) => current.filter((tab) => tab.label !== label)); }),
      ]);
      if (!active) { updated?.(); closed?.(); return; }
      unlistenUpdated = updated;
      unlistenClosed = closed;
      try {
        const restored = await restoreBrowserTabs();
        if (active) setBrowserTabs(restored.length ? restored : await listBrowserTabs());
      } catch (reason) {
        if (!active) return;
        try { setBrowserTabs(await listBrowserTabs()); } catch { setBrowserTabs([]); }
        const detail = typeof reason === "string" ? reason : reason && typeof reason === "object" && "message" in reason ? String(reason.message) : "";
        setError(detail || (language === "ar" ? "تعذرت استعادة جلسة المتصفح" : "Could not restore browser session"));
      }
    })();
    return () => { active = false; unlistenUpdated?.(); unlistenClosed?.(); };
  }, []);
  const open = async (target = url) => {
    const requestedUrl = target.trim();
    if (!requestedUrl) return;
    setBusy(true);
    try {
      const label = await openBrowserWindow(requestedUrl);
      if (!label) { setError(t.desktopRequired); return; }
      let title = label;
      try { title = new URL(requestedUrl).hostname.replace(/^www\./, "") || label; } catch { /* URL validation reports below */ }
      setBrowserTabs((current) => [{ label, url: requestedUrl, title, active: true }, ...current.filter((tab) => tab.label !== label).map((tab) => ({ ...tab, active: false }))]);
      setUrl(requestedUrl);
      setError("");
    } catch (reason) {
      const detail = typeof reason === "string" ? reason : reason && typeof reason === "object" && "message" in reason ? String(reason.message) : "";
      setError(detail || (language === "ar" ? "أدخل رابط http أو https صالحًا" : "Enter a valid http or https URL"));
    } finally { setBusy(false); }
  };
  const closeTab = async (label: string) => {
    try { await closeBrowserTab(label); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const focusTab = async (label: string) => {
    try {
      const focused = await focusBrowserTab(label);
      if (!focused) throw new Error(language === "ar" ? "تعذر إعادة فتح التبويب" : "Could not reopen browser tab");
      setBrowserTabs((current) => current.map((tab) => ({ ...tab, active: tab.label === label })));
      setError("");
    } catch (reason) {
      const detail = typeof reason === "string" ? reason : reason && typeof reason === "object" && "message" in reason ? String(reason.message) : "";
      setError(detail || (language === "ar" ? "تعذر إعادة فتح التبويب" : "Could not reopen browser tab"));
    }
  };
  const quickSites = [
    { name: "YouTube", url: "https://www.youtube.com" },
    { name: "Facebook", url: "https://www.facebook.com" },
    { name: "Vimeo", url: "https://vimeo.com" },
  ];
  return <div className="subpage browser-page">
    <div className="content-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> {t.browserKicker}</div><h1>{t.browserTitle}</h1><p>{t.browserSub}</p></div><div className="browser-live-tag"><span className="pulse-dot" /> WEBVIEW2 · TABS</div></div>
    <section className="browser-studio panel">
      <div className="browser-studio-glow" />
      <div className="browser-studio-top"><div className="browser-studio-brand"><div className="browser-orb"><NexusMark size="medium" /></div><div><strong>NEXUS BROWSER</strong><span>{language === "ar" ? "إدارة تبويبات المتصفح" : "Browser tab management"}</span></div></div><div className="browser-studio-chip"><Sparkles size={14} /> {language === "ar" ? "التبويبات المحفوظة" : "Saved tabs"}</div></div>
      <div className="browser-launchbar"><span className="browser-launch-icon"><Link2 size={17} /></span><input dir="ltr" value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void open(); }} aria-label={t.browserTitle} placeholder="https://www.youtube.com" /><button type="button" onClick={() => void open()} disabled={busy}>{busy ? <RefreshCw size={15} className="browser-spin" /> : <ArrowUpRight size={16} />}<span>{busy ? t.ready : t.openExternal}</span></button></div>
      <div className="browser-quick-sites"><span>{t.browserQuickLaunch}</span>{quickSites.map((site) => <button type="button" key={site.name} onClick={() => void open(site.url)} disabled={busy}><Globe2Icon />{site.name}</button>)}</div>
      {error ? <p className="browser-error" role="alert">{error}</p> : null}
      <div className="browser-secure-note"><ShieldCheck size={15} /><span>{t.browserSecureHint}</span></div>
    </section>
    <section className="browser-sessions">
      <div className="browser-sessions-heading"><div><span className="eyebrow-line" /><h2>{t.browserWindows}</h2></div><span className="browser-window-count">{browserTabs.length}</span></div>
      {browserTabs.length ? <div className="browser-session-grid">{browserTabs.map((tab) => <article className={`browser-session-card ${tab.active ? "is-active" : ""}`} key={tab.label}><div className="browser-session-main"><span className="browser-session-mark"><Globe2Icon /></span><div><strong>{tab.title || tab.label}</strong><small dir="ltr">{tab.url}</small></div><span className="browser-session-dot" title={tab.active ? (language === "ar" ? "نشط" : "Active") : undefined} /></div><div className="browser-session-actions"><button type="button" onClick={() => void focusTab(tab.label)} aria-label={`${t.browserFocus}: ${tab.title || tab.label}`}><ArrowUpRight size={14} />{t.browserFocus}</button><button type="button" aria-label={`${t.browserClose}: ${tab.title || tab.label}`} title={t.browserClose} onClick={() => void closeTab(tab.label)}><X size={15} /></button></div></article>)}</div> : <div className="browser-sessions-empty"><div className="browser-empty-icon"><Video size={20} /></div><strong>{t.browserNoWindows}</strong><span>{t.browserWindowLimit}</span></div>}
    </section>
  </div>;
}
function Globe2Icon() { return <span className="browser-globe"><Wifi size={12} /></span>; }
function UtilitiesView({ language, settingsOnly = false, pasteClipboardLink, openDownloadsFolder, checkEngines, engineStatus, sfxEnabled, setSfxEnabled, clipboardSnifferEnabled, setClipboardSnifferEnabled }: { language: Language; settingsOnly?: boolean; pasteClipboardLink: () => void; openDownloadsFolder: () => void; checkEngines: () => void; engineStatus: string; sfxEnabled: boolean; setSfxEnabled: (value: boolean) => void; clipboardSnifferEnabled: boolean; setClipboardSnifferEnabled: (value: boolean) => void }) {
  const t = copy[language];
  const ar = language === "ar";
  return (
    <div className="subpage">
      <div className="content-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> {settingsOnly ? t.preferences : t.toolkitKicker}</div>
          <h1>{settingsOnly ? t.preferences : t.utilitiesTitle}</h1>
          <p>{settingsOnly ? t.settingsSub : t.utilitiesSub}</p>
        </div>
      </div>
      {settingsOnly ? (
        <section className="utility-settings">
          <h2>{ar ? "تفاعلات التطبيق" : "App interactions"}</h2>
          <label className="utility-setting">
            <span><strong>{ar ? "الأصوات التفاعلية" : "Interface sounds"}</strong><small>{ar ? "نغمات خفيفة عند الإضافة والنسخ والاكتمال" : "Subtle tones on add, copy, and completion"}</small></span>
            <input type="checkbox" checked={sfxEnabled} onChange={(event) => setSfxEnabled(event.target.checked)} />
          </label>
          <label className="utility-setting">
            <span><strong>{ar ? "رصد روابط الحافظة" : "Clipboard link detection"}</strong><small>{ar ? "يفحص نص الحافظة محليًا كل 1.6 ثانية؛ متوقف افتراضيًا" : "Checks clipboard text locally every 1.6 seconds; off by default"}</small></span>
            <input type="checkbox" checked={clipboardSnifferEnabled} onChange={(event) => setClipboardSnifferEnabled(event.target.checked)} />
          </label>
        </section>
      ) : (
        <>
          <div className="utility-actions">
            <button className="utility-action" onClick={pasteClipboardLink}><Link2 size={18} /><span>{t.pasteClipboard}</span></button>
            <button className="utility-action" onClick={openDownloadsFolder}><FolderOpen size={18} /><span>{t.openDownloadsFolder}</span></button>
            <button className="utility-action" onClick={checkEngines}><Activity size={18} /><span>{t.checkEngines}</span></button>
          </div>
          {engineStatus ? <p className="engine-status" role="status">{engineStatus}</p> : null}
        </>
      )}
    </div>
  );
}
function LibraryView({ language, downloads, onOpen }: { language: Language; downloads: DownloadItem[]; onOpen: (item: DownloadItem) => void }) {
  const t = copy[language];
  return <div className="subpage"><div className="content-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> {t.libraryKicker}</div><h1>{t.libraryTitle}</h1><p>{t.librarySub}</p></div></div><div className="library-grid">{downloads.filter((item) => item.state === "completed").map((item) => <div className="library-card" key={item.id}><div className={`file-icon ${item.accent}`}><CategoryIcon type={item.type} /></div><strong>{item.name}</strong><span>{item.size} · {item.type}</span><button type="button" className="library-open" onClick={() => onOpen(item)} aria-label={t.openFile}><FolderOpen size={15} />{t.openFile}</button></div>)}</div>{downloads.some((item) => item.state === "completed") ? null : <EmptyState language={language} />}</div>;
}
