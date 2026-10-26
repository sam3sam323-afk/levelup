import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Language = "ar" | "en" | "fr";
type Key = keyof typeof dictionaries.en;

const dictionaries = {
  en: {
    openBrowser: "Open browser", support: "Telegram support", checkUpdates: "Check for updates", installUpdate: "Restart to install update", openFile: "Open file", openFolder: "Show in folder", fileOpenFailed: "Could not open this downloaded item.",
    updateChecking: "Checking for updates…", updateAvailable: "An update is available. Downloading…", updateDownloading: "Downloading update",
    updateReady: "Update ready. Select the update button to restart.", updateCurrent: "You are on the latest version.", updateFailed: "Could not check for updates.",
    updateUnavailable: "Updates are available only in the installed desktop build.", browserFailed: "Could not open the internal browser.", supportError: "Could not open the support link.",
    tagline: "Your media. Your devices. One local hub.",
    overview: "Overview", downloads: "Downloads", library: "Media library", relay: "Nexus Relay", settings: "Settings",
    controlRoom: "Your media control room", subtitle: "Route every download to the right device — privately, over your local network.",
    addTitle: "Add a download", paste: "Paste a video or file link…", start: "Add to queue", kindVideo: "Video", kindAudio: "Audio only", kindFile: "Direct file", kindTorrent: "Torrent / Magnet",
    downloadType: "Download type", audioFormat: "Audio format", downloadFinished: "Download finished", dismiss: "Dismiss", destination: "Save to", computer: "Computer", phone: "This phone", quality: "Video quality", qAuto: "Best available", pairPhone: "Pair phone", localOnly: "Local network only", noCloud: "No account. No cloud relay.",
    active: "Active transfers", ready: "Ready to receive", disconnected: "Computer not paired", connectHint: "Open the desktop dashboard at localhost:8787, then scan its QR code.",
    queue: "Transfer queue", seeAll: "View all", emptyQueue: "Your queue is clear", emptyHint: "Paste a link above to send your first download to Nexus.",
    libraryTitle: "Your library", libraryHint: "Files saved on your connected computer appear here.", openRelay: "Open relay setup", refresh: "Refresh code", connecting: "Checking local relay…", online: "Relay online", offline: "Relay unavailable",
    speed: "Current speed", received: "Received", remaining: "Remaining", cancel: "Cancel", cancelConfirm: "Cancel this download?", added: "Added to your queue", phoneSaved: "Download saved on this phone", errorTitle: "Could not start download", enterUrl: "Enter a valid link first.", pairTitle: "Connect to your computer", pairSubtitle: "Scan the QR shown by Nexus Relay on your computer, or enter its local address and pairing code.", scanQR: "Scan QR", manual: "Enter manually", address: "Relay address", code: "6-digit code", connect: "Connect", cameraDenied: "Allow camera access to scan the pairing QR.", pairing: "Pairing…", paired: "Phone paired successfully", invalidPair: "Check the local address and six-digit code.", back: "Back", language: "Language", languageDetected: "Device language detected", privacyNote: "Your pairing stays on Wi‑Fi. Media is processed on your chosen device.", engineMissing: "Install yt-dlp + FFmpeg or aria2c on the computer to enable that engine.", sampleLabel: "DESIGN PREVIEW", storage: "Local storage", engineStatus: "Engine status", videoEngine: "Video engine", fileEngine: "File engine", seeSetup: "Pair a computer to view live transfers", dashboard: "Dashboard", search: "Search your files", noFiles: "No files found", chooseLanguage: "Choose language", localAddress: "Local address", pairCode: "Pairing code", scanNow: "Scan this code with the phone app", copy: "Copy", copied: "Copied", menu: "Menu", compact: "Nexus local download hub", directPhoneNote: "Phone downloads support direct HTTP/HTTPS file links.", videoOnComputer: "Video and torrent engines run on the computer.", recent: "Recent activity", yourDevices: "Your devices", security: "Private by design", status: "Status", working: "Working…", allEnginesReady: "All local engines are ready."
  },
  ar: {
    openBrowser: "فتح المتصفح", support: "دعم Telegram", checkUpdates: "تحقق من التحديثات", installUpdate: "أعد التشغيل لتثبيت التحديث", openFile: "فتح الملف", openFolder: "إظهار في المجلد", fileOpenFailed: "تعذّر فتح العنصر الذي تم تنزيله.",
    updateChecking: "جارٍ التحقق من التحديثات…", updateAvailable: "يتوفر تحديث؛ جارٍ تنزيله…", updateDownloading: "جارٍ تنزيل التحديث",
    updateReady: "التحديث جاهز. اضغط زر التحديث لإعادة التشغيل.", updateCurrent: "أنت تستخدم أحدث إصدار.", updateFailed: "تعذّر التحقق من التحديثات.",
    updateUnavailable: "التحديثات متاحة في النسخة المثبّتة لسطح المكتب فقط.", browserFailed: "تعذّر فتح المتصفح الداخلي.", supportError: "تعذّر فتح رابط الدعم.",
    tagline: "وسائطك. أجهزتك. مركز محلي واحد.",
    overview: "نظرة عامة", downloads: "التنزيلات", library: "مكتبة الوسائط", relay: "Nexus Relay", settings: "الإعدادات",
    controlRoom: "مركز التحكم بوسائطك", subtitle: "وجّه كل تنزيل إلى الجهاز المناسب — بخصوصية عبر شبكتك المحلية.",
    addTitle: "إضافة تنزيل", paste: "ألصق رابط فيديو أو ملف…", start: "أضف إلى القائمة", kindVideo: "فيديو", kindAudio: "صوت فقط", kindFile: "ملف مباشر", kindTorrent: "تورنت / Magnet",
    downloadType: "نوع التنزيل", audioFormat: "صيغة الصوت", downloadFinished: "اكتمل التنزيل", dismiss: "إغلاق", destination: "الحفظ في", computer: "الكمبيوتر", phone: "هذا الهاتف", quality: "جودة الفيديو", qAuto: "أفضل جودة متاحة", pairPhone: "اربط الهاتف", localOnly: "على الشبكة المحلية فقط", noCloud: "بلا حساب. بلا وسيط سحابي.",
    active: "النقل النشط", ready: "جاهز للاستقبال", disconnected: "الكمبيوتر غير مرتبط", connectHint: "افتح لوحة الكمبيوتر على localhost:8787 ثم امسح رمز QR.",
    queue: "قائمة النقل", seeAll: "عرض الكل", emptyQueue: "القائمة فارغة الآن", emptyHint: "ألصق رابطًا أعلاه لبدء أول تنزيل عبر Nexus.",
    libraryTitle: "مكتبتك", libraryHint: "ستظهر هنا الملفات المحفوظة على الكمبيوتر المرتبط.", openRelay: "إعداد Relay", refresh: "تحديث الرمز", connecting: "جارٍ التحقق من Relay المحلي…", online: "Relay متصل", offline: "Relay غير متاح",
    speed: "السرعة الحالية", received: "تم تنزيله", remaining: "المتبقي", cancel: "إلغاء", cancelConfirm: "هل تريد إلغاء هذا التنزيل؟", added: "أُضيف إلى القائمة", phoneSaved: "حُفظ التنزيل على هذا الهاتف", errorTitle: "تعذّر بدء التنزيل", enterUrl: "أدخل رابطًا صالحًا أولًا.", pairTitle: "اربط الهاتف بالكمبيوتر", pairSubtitle: "امسح QR الظاهر في Nexus Relay على الكمبيوتر، أو أدخل العنوان المحلي ورمز الاقتران.", scanQR: "مسح QR", manual: "إدخال يدوي", address: "عنوان Relay", code: "الرمز من 6 أرقام", connect: "اتصال", cameraDenied: "اسمح بالوصول إلى الكاميرا لمسح رمز الاقتران.", pairing: "جارٍ الاقتران…", paired: "تم ربط الهاتف بنجاح", invalidPair: "تحقق من العنوان المحلي والرمز المكوّن من ستة أرقام.", back: "رجوع", language: "اللغة", languageDetected: "تم اكتشاف لغة الجهاز", privacyNote: "اقترانك يبقى على Wi‑Fi. تتم معالجة الوسائط على الجهاز الذي تختاره.", engineMissing: "ثبّت yt-dlp وFFmpeg أو aria2c على الكمبيوتر لتفعيل المحرك.", sampleLabel: "معاينة التصميم", storage: "التخزين المحلي", engineStatus: "حالة المحركات", videoEngine: "محرك الفيديو", fileEngine: "محرك الملفات", seeSetup: "اربط كمبيوترًا لعرض النقل المباشر", dashboard: "لوحة التحكم", search: "ابحث في ملفاتك", noFiles: "لم يتم العثور على ملفات", chooseLanguage: "اختر اللغة", localAddress: "العنوان المحلي", pairCode: "رمز الاقتران", scanNow: "امسح هذا الرمز بتطبيق الهاتف", copy: "نسخ", copied: "تم النسخ", menu: "القائمة", compact: "مركز Nexus المحلي للتنزيلات", directPhoneNote: "يدعم الهاتف روابط الملفات المباشرة HTTP/HTTPS.", videoOnComputer: "تعمل محركات الفيديو والتورنت على الكمبيوتر.", recent: "النشاط الأخير", yourDevices: "أجهزتك", security: "الخصوصية أولًا", status: "الحالة", working: "جارٍ العمل…", allEnginesReady: "جميع المحركات المحلية جاهزة."
  },
  fr: {
    openBrowser: "Ouvrir le navigateur", support: "Assistance Telegram", checkUpdates: "Rechercher des mises à jour", installUpdate: "Redémarrer pour installer", openFile: "Ouvrir le fichier", openFolder: "Afficher dans le dossier", fileOpenFailed: "Impossible d’ouvrir cet élément téléchargé.",
    updateChecking: "Recherche des mises à jour…", updateAvailable: "Mise à jour disponible. Téléchargement…", updateDownloading: "Téléchargement de la mise à jour",
    updateReady: "Mise à jour prête. Sélectionnez le bouton pour redémarrer.", updateCurrent: "Vous utilisez la dernière version.", updateFailed: "Impossible de vérifier les mises à jour.",
    updateUnavailable: "Les mises à jour sont disponibles uniquement dans l’application de bureau installée.", browserFailed: "Impossible d’ouvrir le navigateur intégré.", supportError: "Impossible d’ouvrir le lien d’assistance.",
    tagline: "Vos médias. Vos appareils. Un hub local.",
    overview: "Vue d’ensemble", downloads: "Téléchargements", library: "Médiathèque", relay: "Nexus Relay", settings: "Paramètres",
    controlRoom: "Votre espace média", subtitle: "Envoyez chaque téléchargement vers le bon appareil — en privé, sur votre réseau local.",
    addTitle: "Ajouter un téléchargement", paste: "Collez un lien vidéo ou fichier…", start: "Ajouter à la file", kindVideo: "Vidéo", kindAudio: "Audio seul", kindFile: "Fichier direct", kindTorrent: "Torrent / Magnet",
    downloadType: "Type de téléchargement", audioFormat: "Format audio", downloadFinished: "Téléchargement terminé", dismiss: "Fermer", destination: "Enregistrer sur", computer: "Ordinateur", phone: "Ce téléphone", quality: "Qualité vidéo", qAuto: "Meilleure disponible", pairPhone: "Associer le téléphone", localOnly: "Réseau local uniquement", noCloud: "Sans compte. Sans relais cloud.",
    active: "Transferts actifs", ready: "Prêt à recevoir", disconnected: "Ordinateur non associé", connectHint: "Ouvrez localhost:8787 sur l’ordinateur puis scannez son QR code.",
    queue: "File de transfert", seeAll: "Tout voir", emptyQueue: "Votre file est vide", emptyHint: "Collez un lien ci-dessus pour lancer votre premier téléchargement Nexus.",
    libraryTitle: "Votre médiathèque", libraryHint: "Les fichiers enregistrés sur l’ordinateur associé apparaîtront ici.", openRelay: "Configurer le Relay", refresh: "Actualiser le code", connecting: "Vérification du Relay local…", online: "Relay connecté", offline: "Relay indisponible",
    speed: "Vitesse actuelle", received: "Reçu", remaining: "Restant", cancel: "Annuler", cancelConfirm: "Annuler ce téléchargement ?", added: "Ajouté à la file", phoneSaved: "Téléchargement enregistré sur ce téléphone", errorTitle: "Impossible de démarrer", enterUrl: "Saisissez d’abord un lien valide.", pairTitle: "Associer le téléphone", pairSubtitle: "Scannez le QR affiché par Nexus Relay sur l’ordinateur, ou saisissez son adresse locale et le code.", scanQR: "Scanner le QR", manual: "Saisie manuelle", address: "Adresse du Relay", code: "Code à 6 chiffres", connect: "Associer", cameraDenied: "Autorisez l’appareil photo pour scanner le QR.", pairing: "Association…", paired: "Téléphone associé", invalidPair: "Vérifiez l’adresse locale et le code à six chiffres.", back: "Retour", language: "Langue", languageDetected: "Langue de l’appareil détectée", privacyNote: "L’association reste sur le Wi‑Fi. Les médias sont traités sur l’appareil choisi.", engineMissing: "Installez yt-dlp + FFmpeg ou aria2c sur l’ordinateur pour activer ce moteur.", sampleLabel: "APERÇU DESIGN", storage: "Stockage local", engineStatus: "État des moteurs", videoEngine: "Moteur vidéo", fileEngine: "Moteur fichiers", seeSetup: "Associez un ordinateur pour voir les transferts en direct", dashboard: "Tableau de bord", search: "Rechercher vos fichiers", noFiles: "Aucun fichier trouvé", chooseLanguage: "Choisir la langue", localAddress: "Adresse locale", pairCode: "Code d’association", scanNow: "Scannez ce code avec l’application mobile", copy: "Copier", copied: "Copié", menu: "Menu", compact: "Hub local de téléchargements Nexus", directPhoneNote: "Le téléphone prend en charge les liens directs HTTP/HTTPS.", videoOnComputer: "Les moteurs vidéo et torrent fonctionnent sur l’ordinateur.", recent: "Activité récente", yourDevices: "Vos appareils", security: "Confidentialité intégrée", status: "État", working: "En cours…", allEnginesReady: "Tous les moteurs locaux sont prêts."
  }
} as const;

const LANG_KEY = "@levelup-nexus/language";
type I18nContextValue = { language: Language; isRTL: boolean; t: (key: Key) => string; setLanguage: (language: Language) => void };
const I18nContext = createContext<I18nContextValue | null>(null);

function supportedLanguage(value?: string | null): Language {
  const code = value?.toLowerCase().slice(0, 2);
  return code === "ar" || code === "fr" ? code : "en";
}

export function NexusI18nProvider({ children }: { children: React.ReactNode }) {
  const [language, updateLanguage] = useState<Language>("en");
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(LANG_KEY);
        const detected = Localization.getLocales()[0]?.languageCode;
        const previewLanguage = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("lang") : null;
        const initial = previewLanguage === "ar" || previewLanguage === "en" || previewLanguage === "fr"
          ? previewLanguage
          : saved === "ar" || saved === "en" || saved === "fr" ? saved : supportedLanguage(detected);
        if (mounted) updateLanguage(initial);
      } catch {
        if (mounted) updateLanguage(supportedLanguage(Localization.getLocales()[0]?.languageCode));
      }
    })();
    return () => { mounted = false; };
  }, []);
  const setLanguage = useCallback((next: Language) => {
    updateLanguage(next);
    void AsyncStorage.setItem(LANG_KEY, next).catch(() => undefined);
  }, []);
  const t = useCallback((key: Key) => dictionaries[language][key] ?? dictionaries.en[key], [language]);
  const value = useMemo(() => ({ language, isRTL: language === "ar", t, setLanguage }), [language, t, setLanguage]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useNexusI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useNexusI18n must be used inside NexusI18nProvider");
  return context;
}
