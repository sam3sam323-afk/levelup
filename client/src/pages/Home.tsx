import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  AudioLines,
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Clock3,
  CloudDownload,
  Copy,
  FileArchive,
  FileAudio2,
  FileVideo2,
  FolderOpen,
  Gauge,
  HardDrive,
  Headphones,
  Home as HomeIcon,
  Languages,
  LayoutGrid,
  Link2,
  ListFilter,
  Menu,
  MonitorDown,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Moon,
  Trash2,
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
  type DownloadProgressEvent,
  type DownloadTask as TauriDownloadTask,
  type TauriEngine,
} from "../lib/tauriBridge";

type Language = "en" | "ar";
type NavId = "home" | "downloads" | "library" | "browser" | "utilities";
type DownloadState = "downloading" | "paused" | "completed" | "error";
type Category = "Video" | "Audio" | "Archive" | "Other";

type DownloadItem = {
  id: string;
  name: string;
  url: string;
  type: Category;
  engine: "yt-dlp" | "aria2c";
  progress: number;
  size: string;
  downloaded: string;
  speed: string;
  eta: string;
  state: DownloadState;
  accent: "cyan" | "purple" | "pink" | "amber";
  added: string;
};

const copy = {
  en: {
    appName: "LEVEL UP",
    nexus: "NEXUS",
    version: "DESKTOP SIMULATION / 2.4.0",
    workspace: "TARIK PERSONAL",
    localWorkspace: "LOCAL WORKSPACE",
    dashboard: "Dashboard",
    downloads: "Downloads",
    library: "Library",
    browser: "Browser",
    utilities: "Utilities",
    preferences: "Preferences",
    autoOrganize: "Auto organize",
    clipboardWatch: "Clipboard watch",
    secure: "LOCAL & SECURE",
    connected: "CONNECTED",
    overview: "Good evening, Tarik",
    overviewSub: "Your download orbit is calm. 3 files are moving through the queue.",
    newDownload: "New download",
    paste: "Paste",
    startDownload: "Start download",
    inputPlaceholder: "Paste a video, archive, magnet, or direct file link…",
    activeDownloads: "Active downloads",
    activeSub: "Moving through the queue",
    completed: "Completed",
    completedSub: "Ready in your library",
    totalStored: "Total stored",
    totalStoredSub: "Across 3 categories",
    currentSpeed: "Current speed",
    queue: "Live queue",
    queueSub: "Simulated transfer telemetry",
    viewAll: "View all",
    details: "Download details",
    selectHint: "Select a file to inspect its orbit",
    storage: "Storage orbit",
    storageSub: "Local workspace capacity",
    categories: "Categories",
    recentActivity: "Recent activity",
    all: "All files",
    active: "Active",
    paused: "Paused",
    done: "Completed",
    failed: "Failed",
    search: "Search files…",
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
    openFolder: "Open folder",
    copyLink: "Copy link",
    previewOnly: "Preview mode",
    simulation: "Simulation only",
    liveMode: "LIVE ENGINE",
    engine: "Routed engine",
    saveTo: "Save to",
    savePlaceholder: "Downloads / Nexus",
    addToQueue: "Add to queue",
    close: "Close",
    pairing: "Pair phone",
    pairingSub: "Scan from your phone on the same local network.",
    mockQr: "LAN pairing preview",
    browserTitle: "Embedded browser preview",
    browserSub: "A calm space for future media discovery. No page is loaded in simulation mode.",
    openExternal: "Open external",
    utilitiesTitle: "Media utilities",
    utilitiesSub: "Quick tools are staged for the next build phase.",
    ready: "Ready for the next phase",
    libraryTitle: "Local library",
    librarySub: "Your simulated files, arranged by type.",
    empty: "Nothing matches this view",
    emptySub: "Try a different filter or add a simulated download.",
    downloadAdded: "Download added to the simulated queue",
    copied: "Link copied",
    mockAction: "This is a visual simulation",
    routeVideo: "yt-dlp · stream & merge",
    routeFile: "aria2c · multi-connection",
    routeMagnet: "aria2c · torrent route",
    noTime: "Complete",
  },
  ar: {
    appName: "ليفل أب",
    nexus: "نيكسوس",
    version: "محاكاة سطح مكتب / 2.4.0",
    workspace: "مساحة طارق الشخصية",
    localWorkspace: "مساحة محلية",
    dashboard: "لوحة التحكم",
    downloads: "التنزيلات",
    library: "المكتبة",
    browser: "المتصفح",
    utilities: "الأدوات",
    preferences: "التفضيلات",
    autoOrganize: "تنظيم تلقائي",
    clipboardWatch: "مراقبة الحافظة",
    secure: "محلي وآمن",
    connected: "متصل",
    overview: "مساء الخير، طارق",
    overviewSub: "كل شيء هادئ. 3 ملفات تتحرك الآن ضمن الطابور.",
    newDownload: "تنزيل جديد",
    paste: "لصق",
    startDownload: "بدء التنزيل",
    inputPlaceholder: "ألصق رابط فيديو أو أرشيف أو magnet أو ملف مباشر…",
    activeDownloads: "تنزيلات نشطة",
    activeSub: "تتحرك ضمن الطابور",
    completed: "مكتملة",
    completedSub: "جاهزة في مكتبتك",
    totalStored: "المخزن الكلي",
    totalStoredSub: "ضمن 3 تصنيفات",
    currentSpeed: "السرعة الحالية",
    queue: "الطابور المباشر",
    queueSub: "بيانات نقل تجريبية",
    viewAll: "عرض الكل",
    details: "تفاصيل التنزيل",
    selectHint: "اختر ملفًا لفحص مداره",
    storage: "مدار التخزين",
    storageSub: "سعة المساحة المحلية",
    categories: "التصنيفات",
    recentActivity: "آخر النشاطات",
    all: "كل الملفات",
    active: "نشطة",
    paused: "متوقفة",
    done: "مكتملة",
    failed: "فاشلة",
    search: "ابحث في الملفات…",
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
    openFolder: "فتح المجلد",
    copyLink: "نسخ الرابط",
    previewOnly: "وضع المعاينة",
    simulation: "محاكاة فقط",
    liveMode: "محركات فعلية",
    engine: "المحرك الموجه",
    saveTo: "الحفظ في",
    savePlaceholder: "التنزيلات / نيكسوس",
    addToQueue: "إضافة للطابور",
    close: "إغلاق",
    pairing: "ربط الهاتف",
    pairingSub: "امسح الرمز من هاتفك على نفس الشبكة المحلية.",
    mockQr: "معاينة ربط محلي",
    browserTitle: "معاينة المتصفح المدمج",
    browserSub: "مساحة هادئة لاكتشاف الوسائط مستقبلًا. لا يتم تحميل صفحات في وضع المحاكاة.",
    openExternal: "فتح خارجيًا",
    utilitiesTitle: "أدوات الوسائط",
    utilitiesSub: "الأدوات السريعة جاهزة لمرحلة التطوير القادمة.",
    ready: "جاهز للمرحلة القادمة",
    libraryTitle: "المكتبة المحلية",
    librarySub: "ملفاتك التجريبية مرتبة حسب النوع.",
    empty: "لا توجد نتائج لهذا العرض",
    emptySub: "جرّب فلترًا مختلفًا أو أضف تنزيلًا تجريبيًا.",
    downloadAdded: "تمت إضافة التنزيل إلى الطابور التجريبي",
    copied: "تم نسخ الرابط",
    mockAction: "هذه محاكاة مرئية",
    routeVideo: "yt-dlp · سحب ودمج البث",
    routeFile: "aria2c · اتصال متعدد",
    routeMagnet: "aria2c · مسار تورنت",
    noTime: "مكتمل",
  },
} as const;

const seedDownloads: DownloadItem[] = [
  {
    id: "nexus-01",
    name: "Cyberpunk_2077_Update_v2.12.rar",
    url: "https://cdn.nexus.local/cyberpunk-update.rar",
    type: "Archive",
    engine: "aria2c",
    progress: 78,
    size: "14.2 GB",
    downloaded: "11.1 GB",
    speed: "48.2 MB/s",
    eta: "01m 45s",
    state: "downloading",
    accent: "cyan",
    added: "2 min ago",
  },
  {
    id: "nexus-02",
    name: "Unreal_Engine_Architecture.mp4",
    url: "https://youtube.com/watch?v=nexus_ue54_dev",
    type: "Video",
    engine: "yt-dlp",
    progress: 42,
    size: "3.8 GB",
    downloaded: "1.6 GB",
    speed: "14.8 MB/s",
    eta: "04m 10s",
    state: "downloading",
    accent: "purple",
    added: "8 min ago",
  },
  {
    id: "nexus-03",
    name: "Synthwave_Cyber_Mix_2026.flac",
    url: "https://soundcloud.com/chill/lofi-2026",
    type: "Audio",
    engine: "yt-dlp",
    progress: 100,
    size: "520 MB",
    downloaded: "520 MB",
    speed: "0 B/s",
    eta: "Complete",
    state: "completed",
    accent: "pink",
    added: "Yesterday",
  },
  {
    id: "nexus-04",
    name: "Blender_Assets_Pack_04.zip",
    url: "https://assets.nexus.local/blender-pack.zip",
    type: "Archive",
    engine: "aria2c",
    progress: 19,
    size: "2.4 GB",
    downloaded: "456 MB",
    speed: "0 B/s",
    eta: "Paused",
    state: "paused",
    accent: "amber",
    added: "Yesterday",
  },
];

function formatBytes(value?: number) {
  if (!value || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** index;
  const digits = index === 0 ? 0 : amount < 10 ? 2 : 1;
  return `${amount.toFixed(digits)} ${units[index]}`;
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

function taskToItem(task: TauriDownloadTask): DownloadItem {
  const type = categoryForTask(task);
  return {
    id: task.taskId,
    name: task.filename || task.url.split("/").pop()?.split("?")[0] || "Nexus Download",
    url: task.url,
    type,
    engine: task.engine,
    progress: Math.round(task.progress),
    size: formatBytes(task.totalBytes),
    downloaded: formatBytes(task.downloadedBytes),
    speed: formatSpeed(task.speedBytesPerSecond),
    eta: formatEta(task.etaSeconds),
    state: task.state === "completed" ? "completed" : task.state === "paused" ? "paused" : task.state === "failed" || task.state === "cancelled" ? "error" : "downloading",
    accent: accentForCategory(type),
    added: "Just now",
  };
}

function routeForUrl(url: string, language: Language) {
  const normalized = url.toLowerCase();
  if (normalized.startsWith("magnet:")) return copy[language].routeMagnet;
  if (/\.(zip|rar|7z|tar|gz|iso|exe|msi|dmg)(\?|$)/i.test(normalized)) return copy[language].routeFile;
  return copy[language].routeVideo;
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
    library: LayoutGrid,
    browser: MonitorDown,
    utilities: AudioLines,
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

function PairingModal({ language, onClose }: { language: Language; onClose: () => void }) {
  const t = copy[language];
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card pairing-card" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" aria-label={t.close} onClick={onClose}><X size={18} /></button>
        <div className="modal-kicker"><Wifi size={14} /> {t.mockQr}</div>
        <h2>{t.pairing}</h2>
        <p>{t.pairingSub}</p>
        <div className="qr-frame">
          <div className="qr-code" aria-label="Mock QR code">
            <span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span />
          </div>
        </div>
        <div className="pairing-pin"><span>PIN</span><strong>849 · 204</strong><CheckCircle2 size={16} /></div>
        <div className="modal-footnote"><ShieldCheck size={14} /> {t.simulation}</div>
      </div>
    </div>
  );
}

function AddDownloadModal({ language, onClose, onAdd, defaultPath }: { language: Language; onClose: () => void; onAdd: (url: string, savePath: string) => void; defaultPath?: string }) {
  const t = copy[language];
  const [value, setValue] = useState("");
  const [savePath, setSavePath] = useState<string>(defaultPath || t.savePlaceholder);
  const route = value.trim() ? routeForUrl(value, language) : t.routeVideo;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="modal-card add-card" onSubmit={(event) => { event.preventDefault(); if (value.trim()) onAdd(value.trim(), savePath); }} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label={t.close} onClick={onClose}><X size={18} /></button>
        <div className="modal-kicker"><Sparkles size={14} /> {t.previewOnly}</div>
        <h2>{t.newDownload}</h2>
        <p>{t.mockAction}</p>
        <label className="field-label">{t.inputPlaceholder}</label>
        <div className="field-with-icon"><Link2 size={16} /><input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={t.inputPlaceholder} /></div>
        <div className="route-preview"><span>{t.engine}</span><strong>{route}</strong></div>
        <label className="field-label">{t.saveTo}</label>
        <div className="field-with-icon"><FolderOpen size={16} /><input value={savePath} onChange={(event) => setSavePath(event.target.value)} /></div>
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
  const [language, setLanguage] = useState<Language>("en");
  const t = copy[language];
  const [activeNav, setActiveNav] = useState<NavId>("home");
  const [downloads, setDownloads] = useState<DownloadItem[]>(seedDownloads);
  const [selectedId, setSelectedId] = useState(seedDownloads[0].id);
  const [filter, setFilter] = useState<"all" | DownloadState>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [autoOrganize, setAutoOrganize] = useState(true);
  const [clipboardWatch, setClipboardWatch] = useState(true);
  const [modal, setModal] = useState<"add" | "pair" | null>(null);
  const [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [tauriMode, setTauriMode] = useState(false);
  const [defaultDownloadDir, setDefaultDownloadDir] = useState("");

  useEffect(() => {
    let active = true;
    const pendingProgress = new Map<string, DownloadProgressEvent>();
    let progressFrame: number | null = null;
    const cleanups: Array<() => void> = [];
    void (async () => {
      const runtime = await isTauriRuntime();
      if (!active) return;
      setTauriMode(runtime);
      if (!runtime) return;
      const [directory, tasks] = await Promise.all([
        invokeTauri<string>("get_default_download_dir"),
        invokeTauri<TauriDownloadTask[]>("list_downloads"),
      ]);
      if (!active) return;
      if (directory) setDefaultDownloadDir(directory);
      if (tasks?.length) {
        setDownloads(tasks.map(taskToItem));
        setSelectedId(tasks[0].taskId);
      }
      const upsertTask = (task: TauriDownloadTask) => setDownloads((items) => {
        const item = taskToItem(task);
        return items.some((current) => current.id === item.id) ? items.map((current) => current.id === item.id ? { ...current, ...item } : current) : [item, ...items];
      });
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
              size: formatBytes(event.totalBytes),
              speed: formatSpeed(event.speedBytesPerSecond),
              eta: formatEta(event.etaSeconds),
              state: event.state === "paused" ? "paused" : event.state === "failed" ? "error" : event.state === "completed" ? "completed" : "downloading",
              name: event.filename || current.name,
            } satisfies DownloadItem;
            const isSame = next.progress === current.progress && next.downloaded === current.downloaded && next.size === current.size && next.speed === current.speed && next.eta === current.eta && next.state === current.state && next.name === current.name;
            if (isSame) return current;
            changed = true;
            return next;
          });
          return changed ? nextItems : items;
        });
      };
      const updateProgress = (event: DownloadProgressEvent) => {
        pendingProgress.set(event.taskId, event);
        if (progressFrame === null) progressFrame = window.requestAnimationFrame(flushProgress);
      };
      const failed = (event: { taskId: string; error?: string }) => setDownloads((items) => items.map((current) => current.id === event.taskId ? { ...current, state: "error", eta: event.error || "Failed" } : current));
      for (const eventName of ["download://started", "download://completed", "download://paused", "download://resumed"]) {
        const cleanup = await listenTauri<TauriDownloadTask>(eventName, upsertTask);
        if (cleanup) cleanups.push(cleanup);
      }
      const progressCleanup = await listenTauri<DownloadProgressEvent>("download://progress", updateProgress);
      if (progressCleanup) cleanups.push(progressCleanup);
      const failedCleanup = await listenTauri<{ taskId: string; error?: string }>("download://failed", failed);
      if (failedCleanup) cleanups.push(failedCleanup);
    })().catch(() => {
      if (active) setTauriMode(false);
    });
    return () => {
      active = false;
      pendingProgress.clear();
      if (progressFrame !== null) window.cancelAnimationFrame(progressFrame);
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  useEffect(() => {
    if (tauriMode) return;
    const timer = window.setInterval(() => {
      setDownloads((items) => items.map((item) => {
        if (item.state !== "downloading") return item;
        const next = Math.min(100, item.progress + 2);
        return next === 100 ? { ...item, progress: next, state: "completed", eta: t.noTime, speed: "0 B/s", downloaded: item.size } : { ...item, progress: next };
      }));
    }, 4200);
    return () => window.clearInterval(timer);
  }, [tauriMode, t.noTime]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const activeCount = downloads.filter((item) => item.state === "downloading").length;
  const completedCount = downloads.filter((item) => item.state === "completed").length;
  const totalSpeed = downloads.filter((item) => item.state === "downloading").reduce((sum, item) => sum + Number.parseFloat(item.speed), 0);
  const selected = downloads.find((item) => item.id === selectedId) ?? downloads[0];

  const visibleDownloads = useMemo(() => {
    const query = search.trim().toLowerCase();
    return downloads
      .filter((item) => filter === "all" || item.state === filter)
      .filter((item) => !query || item.name.toLowerCase().includes(query) || item.url.toLowerCase().includes(query))
      .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "size" ? Number.parseFloat(b.size) - Number.parseFloat(a.size) : Number(b.id.replace(/\D/g, "")) - Number(a.id.replace(/\D/g, "")));
  }, [downloads, filter, search, sort]);

  const addDownload = async (url: string, requestedPath = defaultDownloadDir) => {
    const isArchive = /\.(zip|rar|7z|tar|gz|iso|exe|msi|dmg)(\?|$)/i.test(url);
    const isAudio = /soundcloud|\.flac|\.mp3/i.test(url);
    const engine: TauriEngine = isArchive || url.startsWith("magnet:") ? "aria2c" : "yt-dlp";
    if (tauriMode) {
      try {
        const task = await invokeTauri<TauriDownloadTask>("start_download", {
          url,
          engine,
          download_dir: requestedPath || defaultDownloadDir,
          options: { connections: 16, audioOnly: isAudio },
        });
        if (!task) throw new Error("Tauri runtime unavailable");
        setDownloads((items) => [taskToItem(task), ...items.filter((item) => item.id !== task.taskId)]);
        setSelectedId(task.taskId);
        setModal(null);
        setActiveNav("downloads");
        setToast(t.downloadAdded);
      } catch {
        setToast("Unable to start the real download");
      }
      return;
    }
    const newItem: DownloadItem = {
      id: `nexus-${Date.now()}`,
      name: url.split("/").pop()?.split("?")[0] || "Nexus_Simulated_Download",
      url,
      type: isArchive ? "Archive" : isAudio ? "Audio" : "Video",
      engine,
      progress: 8,
      size: isArchive ? "1.8 GB" : "860 MB",
      downloaded: isArchive ? "145 MB" : "68 MB",
      speed: "22.6 MB/s",
      eta: "02m 12s",
      state: "downloading",
      accent: isArchive ? "cyan" : "purple",
      added: "Just now",
    };
    setDownloads((items) => [newItem, ...items]);
    setSelectedId(newItem.id);
    setModal(null);
    setActiveNav("downloads");
    setToast(t.downloadAdded);
  };

  const toggleState = async (id: string) => {
    if (tauriMode) {
      const item = downloads.find((current) => current.id === id);
      if (!item) return;
      try {
        if (item.state === "downloading") await invokeTauri("pause_download", { task_id: id });
        else if (item.state === "paused") await invokeTauri("resume_download", { task_id: id });
      } catch {
        setToast("Unable to resume this download");
      }
      return;
    }
    setDownloads((items) => items.map((item) => item.id === id ? { ...item, state: item.state === "downloading" ? "paused" : item.state === "paused" ? "downloading" : item.state } : item));
  };

  const removeItem = async (id: string) => {
    if (tauriMode) {
      const item = downloads.find((current) => current.id === id);
      if (item && (item.state === "downloading" || item.state === "paused")) {
        try { await invokeTauri("cancel_download", { task_id: id }); } catch { /* task may already be closed */ }
      }
    }
    setDownloads((items) => items.filter((item) => item.id !== id));
    if (selectedId === id) setSelectedId(downloads.find((item) => item.id !== id)?.id ?? "");
    setToast(t.cancel);
  };

  const copyLink = async () => {
    if (!selected) return;
    try { await navigator.clipboard.writeText(selected.url); } catch { /* visual-only fallback */ }
    setToast(t.copied);
  };

  const navItems: { id: NavId; label: string; count?: number }[] = [
    { id: "home", label: t.dashboard },
    { id: "downloads", label: t.downloads, count: activeCount },
    { id: "library", label: t.library },
    { id: "browser", label: t.browser },
    { id: "utilities", label: t.utilities },
  ];

  return (
    <div className={`nexus-app ${theme}`} dir={language === "ar" ? "rtl" : "ltr"}>
      <header className="window-bar">
        <div className="window-brand"><NexusMark size="small" /><span>{t.appName} <b>{t.nexus}</b></span><em>{t.version}</em></div>
        <div className="window-actions"><span className="simulation-pill"><span className="pulse-dot" /> {tauriMode ? t.liveMode : t.simulation}</span><button className="theme-toggle" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={theme === "dark" ? "Light mode" : "Dark mode"}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}<span>{theme === "dark" ? "Light" : "Dark"}</span></button><button onClick={() => setLanguage(language === "en" ? "ar" : "en")} aria-label="Toggle language"><Languages size={16} /><span>{language === "en" ? "العربية" : "English"}</span></button><button className="window-icon" aria-label="Minimize">−</button><button className="window-icon" aria-label="Maximize">□</button><button className="window-icon close" aria-label="Close">×</button></div>
      </header>

      <div className="app-shell">
        <aside className={`sidebar ${mobileNav ? "is-open" : ""}`}>
          <div>
            <div className="sidebar-brand"><NexusMark /><div><strong>{t.appName}</strong><b>{t.nexus}</b></div><button className="mobile-close" onClick={() => setMobileNav(false)}><X size={18} /></button></div>
            <div className="workspace-switch"><div className="avatar">T</div><div><strong>{t.workspace}</strong><span>{t.localWorkspace}</span></div><ChevronDown size={15} /></div>
            <nav className="main-nav" aria-label="Primary navigation">
              <span className="nav-caption">WORKSPACE</span>
              {navItems.map((item) => <button key={item.id} className={`nav-item ${activeNav === item.id ? "active" : ""}`} onClick={() => { setActiveNav(item.id); setMobileNav(false); }}><span className="nav-item-icon"><SectionIcon id={item.id} /></span><span>{item.label}</span>{item.count ? <b>{item.count}</b> : null}</button>)}
            </nav>
            <div className="nav-divider" />
            <span className="nav-caption">{t.preferences.toUpperCase()}</span>
            <div className="toggle-list">
              <button className="toggle-row" onClick={() => setAutoOrganize(!autoOrganize)}><span><ListFilter size={16} />{t.autoOrganize}</span><i className={autoOrganize ? "on" : ""}><b /></i></button>
              <button className="toggle-row" onClick={() => setClipboardWatch(!clipboardWatch)}><span><Clipboard size={16} />{t.clipboardWatch}</span><i className={clipboardWatch ? "on" : ""}><b /></i></button>
            </div>
          </div>
          <div className="sidebar-footer"><div className="secure-badge"><ShieldCheck size={15} /><span>{t.secure}</span><span className="badge-dot" /></div><div className="signature"><span>DESIGNED FOR</span><strong>TARIK</strong><small>NEXUS ENGINE</small></div></div>
        </aside>

        <main className="main-content">
          <div className="mobile-top"><button onClick={() => setMobileNav(true)}><Menu size={20} /></button><NexusMark size="small" /><strong>{t.nexus}</strong><button onClick={() => setModal("add")}><Plus size={19} /></button></div>
          <div className="content-scroll">
            <div key={activeNav} className="view-transition">
            {activeNav === "browser" ? <BrowserView language={language} onOpenExternal={() => setToast(t.mockAction)} /> : activeNav === "utilities" ? <UtilitiesView language={language} /> : activeNav === "library" ? <LibraryView language={language} downloads={downloads} /> : <>
              <div className="content-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> NEXUS CONTROL ROOM</div><h1>{activeNav === "downloads" ? t.downloads : t.overview}</h1><p>{activeNav === "downloads" ? t.queueSub : t.overviewSub}</p></div><div className="heading-actions"><button className="pair-button" onClick={() => setModal("pair")}><QrCode size={16} /> {t.pairing}</button><AppButton icon={<Plus size={17} />} onClick={() => setModal("add")}>{t.newDownload}</AppButton></div></div>
              <section className="hero-card"><div className="hero-glow" /><div className="hero-copy"><div className="hero-chip"><span className="pulse-dot" /> {t.connected}</div><h2>Bring media<br /><span>into your orbit.</span></h2><p>{t.inputPlaceholder}</p><div className="quick-add"><Link2 size={17} /><input placeholder={t.inputPlaceholder} onKeyDown={(event) => { if (event.key === "Enter" && event.currentTarget.value.trim()) addDownload(event.currentTarget.value.trim()); }} /><button onClick={() => setModal("add")}><Plus size={17} /> {t.newDownload}</button></div><div className="hero-meta"><span><Zap size={13} /> {t.routeVideo}</span><span><ShieldCheck size={13} /> {tauriMode ? t.liveMode : t.previewOnly}</span></div></div><div className="hero-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="hero-logo"><NexusMark size="large" /></div><div className="float-stat float-stat-top"><span>QUEUE HEALTH</span><strong>98.4%</strong><div className="mini-bars"><i /><i /><i /><i /><i /><i /></div></div><div className="float-stat float-stat-bottom"><Activity size={13} /><span>{totalSpeed.toFixed(1)} MB/s</span><b>LIVE</b></div></div></section>

              <section className="stat-grid"><StatCard icon={<ArrowDownToLine />} label={t.activeDownloads} value={String(activeCount).padStart(2, "0")} hint={t.activeSub} color="cyan" /><StatCard icon={<CheckCircle2 />} label={t.completed} value={String(completedCount).padStart(2, "0")} hint={t.completedSub} color="purple" /><StatCard icon={<HardDrive />} label={t.totalStored} value="485.9 GB" hint={t.totalStoredSub} color="pink" /><StatCard icon={<Gauge />} label={t.currentSpeed} value={`${totalSpeed.toFixed(1)} MB/s`} hint={t.previewOnly} color="amber" /></section>

              <section className="queue-panel panel"><div className="panel-heading"><div><div className="panel-title"><span className="live-dot" /> {t.queue}</div><p>{t.queueSub}</p></div><button className="text-button" onClick={() => { setActiveNav("downloads"); setFilter("all"); }}>{t.viewAll} <ArrowUpRight size={14} /></button></div><QueueToolbar language={language} search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} />
                <div className="queue-list">{visibleDownloads.slice(0, activeNav === "home" ? 4 : undefined).map((item) => <MemoLazyDownloadRow key={item.id} item={item} language={language} selected={selectedId === item.id} onSelect={() => setSelectedId(item.id)} onToggle={() => toggleState(item.id)} onRemove={() => removeItem(item.id)} />)}</div>{visibleDownloads.length === 0 ? <EmptyState language={language} /> : null}</section>
            </>}
            </div>
          </div>
        </main>

        <aside className="right-rail"><div className="rail-section"><div className="rail-title"><span>{t.details}</span><MoreHorizontal size={17} /></div>{selected ? <><div className={`detail-file-icon ${selected.accent}`}><CategoryIcon type={selected.type} /></div><h3 className="detail-name">{selected.name}</h3><span className="detail-url">{selected.url}</span><div className="detail-progress"><div className="detail-progress-head"><span>{t.progress}</span><strong>{selected.progress}%</strong></div><div className="progress-track"><span className={`progress-fill ${selected.accent}`} style={{ width: `${selected.progress}%` }} /></div></div><div className="detail-grid"><DetailMetric icon={<Gauge size={14} />} label={t.speed} value={selected.speed} /><DetailMetric icon={<Clock3 size={14} />} label={t.eta} value={selected.eta} /><DetailMetric icon={<HardDrive size={14} />} label={t.size} value={selected.size} /><DetailMetric icon={<Zap size={14} />} label={t.engine} value={selected.engine} /></div><div className="detail-actions">{selected.state === "paused" ? <button onClick={() => toggleState(selected.id)}><Play size={15} /> {t.resumeDownload}</button> : null}<button onClick={copyLink}><Copy size={15} /> {t.copyLink}</button><button onClick={() => setToast(t.mockAction)}><FolderOpen size={15} /> {t.openFolder}</button></div></> : <div className="rail-empty">{t.selectHint}</div>}</div><div className="rail-section storage-section"><div className="rail-title"><span>{t.storage}</span><HardDrive size={16} /></div><div className="storage-amount"><strong>485.9</strong><span>GB <small>/ 1 TB</small></span></div><div className="storage-track"><span /></div><div className="storage-caption"><span>48.5% {t.totalStoredSub}</span><span>514.1 GB free</span></div><div className="category-list"><CategoryLine icon={<Video size={15} />} label="Video" value="240.5 GB" percent={49} color="cyan" /><CategoryLine icon={<Headphones size={15} />} label="Audio" value="45.2 GB" percent={19} color="pink" /><CategoryLine icon={<FileArchive size={15} />} label="Archive" value="181.8 GB" percent={32} color="purple" /></div></div><div className="rail-section activity-section"><div className="rail-title"><span>{t.recentActivity}</span><RefreshCw size={15} /></div><div className="activity-row"><span className="activity-icon cyan"><ArrowDownToLine size={13} /></span><div><strong>Update_v2.12.rar</strong><small>Added 2 min ago</small></div><b>+14.2 GB</b></div><div className="activity-row"><span className="activity-icon purple"><Check size={13} /></span><div><strong>Cyber_Mix.flac</strong><small>Completed yesterday</small></div><b>520 MB</b></div></div></aside>
      </div>

      {modal === "add" ? <AddDownloadModal language={language} defaultPath={defaultDownloadDir} onClose={() => setModal(null)} onAdd={addDownload} /> : null}
      {modal === "pair" ? <PairingModal language={language} onClose={() => setModal(null)} /> : null}
      {toast ? <div className="toast"><CheckCircle2 size={16} /> {toast}</div> : null}
    </div>
  );
}

function StatCard({ icon, label, value, hint, color }: { icon: React.ReactNode; label: string; value: string; hint: string; color: string }) {
  return <div className={`stat-card ${color}`}><div className="stat-icon">{icon}</div><div className="stat-label">{label}</div><strong>{value}</strong><span>{hint}</span><div className="stat-spark"><i /><i /><i /><i /><i /></div></div>;
}

function QueueToolbar({ language, search, setSearch, filter, setFilter, sort, setSort }: { language: Language; search: string; setSearch: (value: string) => void; filter: "all" | DownloadState; setFilter: (value: "all" | DownloadState) => void; sort: string; setSort: (value: string) => void }) {
  const t = copy[language];
  return <div className="queue-toolbar"><div className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.search} /></div><div className="filter-tabs">{([["all", t.all], ["downloading", t.active], ["paused", t.paused], ["completed", t.done]] as const).map(([value, label]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div><label className="sort-field"><span>{t.sort}</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">{t.newest}</option><option value="name">{t.name}</option><option value="size">{t.size}</option></select><ChevronDown size={13} /></label></div>;
}

type DownloadRowProps = { item: DownloadItem; language: Language; selected: boolean; onSelect: () => void; onToggle: () => void; onRemove: () => void };

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

function DownloadRow({ item, language, selected, onSelect, onToggle, onRemove }: DownloadRowProps) {
  const t = copy[language];
  return <article className={`download-row ${selected ? "selected" : ""}`} onClick={onSelect}><div className={`file-icon ${item.accent}`}><CategoryIcon type={item.type} /></div><div className="download-main"><div className="download-line"><strong title={item.name}>{item.name}</strong><span className={`state-pill ${item.state}`}>{statusLabel(item.state, language)}</span></div><div className="download-meta"><span>{item.engine}</span><i /> <span>{item.downloaded} / {item.size}</span><i /> <span>{item.added}</span></div><div className="row-progress"><span className={`progress-fill ${item.accent}`} style={{ width: `${item.progress}%` }} /></div><div className="row-bottom"><span>{item.progress}% {t.progress.toLowerCase()}</span><span>{item.state === "completed" ? t.noTime : item.eta}</span></div></div><div className="download-speed"><strong>{item.speed}</strong><span>{item.state === "completed" ? "—" : t.speed}</span></div><div className="row-actions"><button aria-label={item.state === "downloading" ? t.pause : t.resume} onClick={(event) => { event.stopPropagation(); onToggle(); }}>{item.state === "downloading" ? <Pause size={15} /> : <Play size={15} />}</button><button aria-label={t.cancel} onClick={(event) => { event.stopPropagation(); onRemove(); }}><Trash2 size={15} /></button></div></article>;
}

const areDownloadRowPropsEqual = (previous: DownloadRowProps, next: DownloadRowProps) => previous.item === next.item && previous.language === next.language && previous.selected === next.selected;
const MemoDownloadRow = memo(DownloadRow, areDownloadRowPropsEqual);
const MemoLazyDownloadRow = memo(LazyDownloadRow, areDownloadRowPropsEqual);

function DetailMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="detail-metric"><span>{icon} {label}</span><strong>{value}</strong></div>; }
function CategoryIcon({ type }: { type: Category }) { const Icon = iconForCategory(type); return <Icon size={21} strokeWidth={1.7} />; }
function CategoryLine({ icon, label, value, percent, color }: { icon: React.ReactNode; label: string; value: string; percent: number; color: string }) { return <div className="category-line"><div className="category-line-top"><span>{icon}{label}</span><strong>{value}</strong></div><div className="category-track"><i className={color} style={{ width: `${percent}%` }} /></div></div>; }

function BrowserView({ language, onOpenExternal }: { language: Language; onOpenExternal: () => void }) { const t = copy[language]; return <div className="subpage"><div className="content-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> NEXUS BROWSER</div><h1>{t.browserTitle}</h1><p>{t.browserSub}</p></div><AppButton icon={<ArrowUpRight size={16} />} onClick={onOpenExternal}>{t.openExternal}</AppButton></div><div className="browser-window panel"><div className="browser-tabs"><span className="browser-tab active"><Globe2Icon /> YouTube Media</span><span className="browser-tab"><Globe2Icon /> Archive Direct</span><Plus size={15} /></div><div className="browser-bar"><ArrowDownToLine size={15} /><span>https://youtube.com</span><RefreshCw size={14} /></div><div className="browser-empty"><div className="browser-orb"><NexusMark size="medium" /></div><h2>{t.browserTitle}</h2><p>{t.browserSub}</p><div className="browser-actions"><AppButton icon={<Sparkles size={15} />} onClick={onOpenExternal}>{t.previewOnly}</AppButton><button onClick={onOpenExternal}>{t.openExternal} <ArrowUpRight size={14} /></button></div></div></div></div>; }
function Globe2Icon() { return <span className="browser-globe"><Wifi size={12} /></span>; }
function UtilitiesView({ language }: { language: Language }) { const t = copy[language]; return <div className="subpage"><div className="content-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> NEXUS TOOLKIT</div><h1>{t.utilitiesTitle}</h1><p>{t.utilitiesSub}</p></div></div><div className="utility-grid"><UtilityCard icon={<AudioLines />} title="Audio extract" text="Prepare audio-only presets for a future engine connection." color="pink" /><UtilityCard icon={<Video />} title="Format preview" text="See how your media profile will look before starting." color="purple" /><UtilityCard icon={<Gauge />} title="Speed profile" text="Shape concurrent transfer rules in the next phase." color="cyan" /></div><div className="coming-soon panel"><Sparkles size={19} /><div><strong>{t.ready}</strong><span>{t.simulation}</span></div><ArrowUpRight size={17} /></div></div>; }
function UtilityCard({ icon, title, text, color }: { icon: React.ReactNode; title: string; text: string; color: string }) { return <div className={`utility-card ${color}`}><div className="utility-icon">{icon}</div><h3>{title}</h3><p>{text}</p><span className="utility-link">Preview only <ArrowUpRight size={13} /></span></div>; }
function LibraryView({ language, downloads }: { language: Language; downloads: DownloadItem[] }) { const t = copy[language]; return <div className="subpage"><div className="content-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> NEXUS LIBRARY</div><h1>{t.libraryTitle}</h1><p>{t.librarySub}</p></div><AppButton icon={<FolderOpen size={16} />} onClick={() => undefined}>{t.openFolder}</AppButton></div><div className="library-grid">{downloads.filter((item) => item.state === "completed").map((item) => <div className="library-card" key={item.id}><div className={`file-icon ${item.accent}`}><CategoryIcon type={item.type} /></div><strong>{item.name}</strong><span>{item.size} · {item.type}</span><button><MoreHorizontal size={16} /></button></div>)}</div></div>; }
