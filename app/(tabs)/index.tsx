import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Svg, { Circle, Path, Defs, LinearGradient as SvgGradient, Stop } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { useNexusI18n, type Language } from "@/lib/i18n";
import { ReadableText as Text } from "@/lib/readable-text";
import { cancelComputerDownload, createComputerDownload, downloadDirectToPhone, getRelaySession, isLocalDesktop, relayRequest, routePhoneDownload, subscribeRelayDownloads, type EngineStatus, type Transfer } from "@/lib/relay-client";

const COLORS = {
  background: "#070D19", surface: "#0C1728", surface2: "#101F35", border: "#233550",
  text: "#F3F6FF", muted: "#A4B2C7", cyan: "#21C8F3", violet: "#8669FF", green: "#49D6A1", amber: "#F4B85A",
};
const languages: { code: Language; label: string }[] = [
  { code: "ar", label: "ع" }, { code: "en", label: "EN" }, { code: "fr", label: "FR" },
];
const qualityOptions = ["auto", "240p", "360p", "480p", "720p", "1080p", "1440p", "4K", "8K"];

type NavKey = "overview" | "downloads" | "library" | "relay" | "settings";
type Kind = "video" | "audio" | "file" | "torrent";
type CompletionToast = { id: string | null; title: string; destination: "computer" | "phone"; kind: Transfer["kind"] };

function NexusMark({ size = 38 }: { size?: number }) {
  return (
    <View style={[styles.markWrap, { width: size, height: size, borderRadius: size * 0.3 }]}>
      <Svg width={size * 0.7} height={size * 0.7} viewBox="0 0 40 40">
        <Defs>
          <SvgGradient id="nexusMark" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor={COLORS.cyan} />
            <Stop offset="1" stopColor={COLORS.violet} />
          </SvgGradient>
        </Defs>
        <Path d="M8 31V9l24 22V9" fill="none" stroke="url(#nexusMark)" strokeWidth="5.4" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M20 7v9m0-9-4 4m4-4 4 4" fill="none" stroke="#F7F8FF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx="8" cy="31" r="2.7" fill={COLORS.cyan} />
        <Circle cx="32" cy="31" r="2.7" fill={COLORS.violet} />
      </Svg>
    </View>
  );
}

function IconButton({ icon, label, onPress, active = false }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string; onPress?: () => void; active?: boolean }) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.iconButton, active && styles.iconButtonActive]}>
      <MaterialCommunityIcons name={icon} size={19} color={active ? COLORS.cyan : COLORS.muted} />
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { language, isRTL, t, setLanguage } = useNexusI18n();
  const [activeSection, setActiveSection] = useState<NavKey>("overview");
  const [kind, setKind] = useState<Kind>("video");
  const [target, setTarget] = useState<"computer" | "phone">("computer");
  const [quality, setQuality] = useState("1080p");
  const [audioFormat, setAudioFormat] = useState<"mp3" | "m4a">("mp3");
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [downloads, setDownloads] = useState<Transfer[]>([]);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [relayOnline, setRelayOnline] = useState(false);
  const [pairingInfo, setPairingInfo] = useState<{ relay: string; code: string; qrDataUrl: string; expiresAt: number } | null>(null);
  const [notice, setNotice] = useState("");
  const [completionToast, setCompletionToast] = useState<CompletionToast | null>(null);
  const [updateStatus, setUpdateStatus] = useState<{ state: string; percent?: number } | null>(null);
  const [working, setWorking] = useState(false);
  const [phoneProgress, setPhoneProgress] = useState<number | null>(null);
  const [phoneSpeed, setPhoneSpeed] = useState(0);
  const [libraryFiles, setLibraryFiles] = useState<{ name: string; sizeBytes: number; extension: string; modifiedAt: number }[]>([]);
  const previousDownloadStatuses = useRef(new Map<string, Transfer["status"]>());
  const hasDownloadBaseline = useRef(false);
  const localDesktop = isLocalDesktop();
  const isElectronDesktop = Platform.OS === "web" && typeof window !== "undefined" && window.nexusDesktop?.isElectron === true;
  const windowsChrome = isElectronDesktop && window.nexusDesktop?.platform === "win32";
  const isWide = width >= 1160;
  const isDesktop = width >= 820;

  const navItems: { key: NavKey; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; badge?: string }[] = useMemo(() => [
    { key: "overview", label: t("overview"), icon: "view-dashboard-outline" },
    { key: "downloads", label: t("downloads"), icon: "download-outline" },
    { key: "library", label: t("library"), icon: "folder-multiple-outline" },
    { key: "relay", label: t("relay"), icon: "access-point-network" },
    { key: "settings", label: t("settings"), icon: "cog-outline" },
  ], [t]);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      const session = await getRelaySession();
      if (!session) { if (mounted) { setRelayOnline(false); setDownloads([]); setEngineStatus(null); } return; }
      try {
        const [downloadData, toolsData, libraryData] = await Promise.all([
          relayRequest<{ downloads: Transfer[] }>("/api/downloads"),
          relayRequest<EngineStatus>("/api/tools"),
          relayRequest<{ files: { name: string; sizeBytes: number; extension: string; modifiedAt: number }[] }>("/api/library"),
        ]);
        if (mounted) { setRelayOnline(true); setDownloads(downloadData.downloads); setEngineStatus(toolsData); setLibraryFiles(libraryData.files); }
      } catch { if (mounted) setRelayOnline(false); }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), localDesktop ? 15000 : 1300);
    return () => { mounted = false; clearInterval(timer); };
  }, [localDesktop]);

  useEffect(() => {
    if (!localDesktop) return;
    return subscribeRelayDownloads((items) => { setDownloads(items); setRelayOnline(true); });
  }, [localDesktop]);

  useEffect(() => {
    if (!downloads.length) return;
    const nextStatuses = new Map(downloads.map((item) => [item.id, item.status]));
    if (!hasDownloadBaseline.current) {
      previousDownloadStatuses.current = nextStatuses;
      hasDownloadBaseline.current = true;
      return;
    }
    const finished = downloads
      .filter((item) => item.status === "complete" && previousDownloadStatuses.current.get(item.id) !== "complete")
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    previousDownloadStatuses.current = nextStatuses;
    if (finished) setCompletionToast({ id: finished.id, title: finished.title, destination: "computer", kind: finished.kind });
  }, [downloads]);

  useEffect(() => {
    if (!completionToast) return;
    const timer = setTimeout(() => setCompletionToast(null), 15000);
    return () => clearTimeout(timer);
  }, [completionToast]);

  useEffect(() => {
    const bridge = typeof window !== "undefined" ? window.nexusDesktop : undefined;
    if (!bridge?.isElectron) return;
    return bridge.onUpdateStatus((status) => {
      setUpdateStatus(status);
      if (status.state === "checking") setNotice(t("updateChecking"));
      else if (status.state === "available") setNotice(t("updateAvailable"));
      else if (status.state === "downloading") setNotice(`${t("updateDownloading")} ${Math.round(status.percent ?? 0)}%`);
      else if (status.state === "ready") setNotice(t("updateReady"));
      else if (status.state === "current") setNotice(t("updateCurrent"));
      else if (status.state === "error") setNotice(t("updateFailed"));
    });
  }, [t]);

  useEffect(() => {
    if (!localDesktop || typeof window === "undefined") return;
    let mounted = true;
    const loadPairing = async () => {
      try {
        const response = await fetch(`${window.location.origin}/api/pairing`, { cache: "no-store" });
        if (!response.ok) return;
        const value = await response.json();
        if (mounted && typeof value.qrDataUrl === "string") setPairingInfo(value);
      } catch { /* Relay panel keeps its offline state until it can load the local code. */ }
    };
    void loadPairing();
    const timer = setInterval(() => void loadPairing(), 30000);
    return () => { mounted = false; clearInterval(timer); };
  }, [localDesktop]);

  const refreshPairing = async () => {
    if (!localDesktop || typeof window === "undefined") return;
    try {
      await fetch(`${window.location.origin}/api/pairing/refresh`, { method: "POST" });
      const response = await fetch(`${window.location.origin}/api/pairing`, { cache: "no-store" });
      if (response.ok) setPairingInfo(await response.json());
    } catch { setNotice(t("offline")); }
  };

  const openBrowser = async () => {
    const bridge = typeof window !== "undefined" ? window.nexusDesktop : undefined;
    if (!bridge?.isElectron) return;
    try { await bridge.openBrowser(language); }
    catch { setNotice(t("browserFailed")); }
  };

  const openSupport = async () => {
    try {
      const bridge = typeof window !== "undefined" ? window.nexusDesktop : undefined;
      if (bridge?.isElectron) await bridge.openSupport();
      else await Linking.openURL("https://t.me/level_uparena_bot");
    } catch { setNotice(t("supportError")); }
  };

  const checkOrInstallUpdate = async () => {
    const bridge = typeof window !== "undefined" ? window.nexusDesktop : undefined;
    if (!bridge?.isElectron) return;
    try {
      if (updateStatus?.state === "ready") { await bridge.installUpdate(); return; }
      setNotice(t("updateChecking"));
      const result = await bridge.checkForUpdates();
      if (!result.ok) setNotice(t("updateUnavailable"));
    } catch { setNotice(t("updateFailed")); }
  };

  const openCompletedDownload = async (id: string, action: "file" | "folder") => {
    const bridge = typeof window !== "undefined" ? window.nexusDesktop : undefined;
    if (!bridge?.isElectron) return;
    try { await bridge.openDownload(id, action); if (completionToast?.id === id) setCompletionToast(null); }
    catch { setNotice(t("fileOpenFailed")); }
  };

  const startDownload = async () => {
    setNotice("");
    if (!url.trim()) { setNotice(t("enterUrl")); return; }
    setWorking(true);
    try {
      if (target === "phone") {
        if (kind !== "file") throw new Error(t("directPhoneNote"));
        if (!relayOnline) throw new Error(t("connectHint"));
        const route = await routePhoneDownload(url.trim());
        const result = await downloadDirectToPhone(route.directUrl, (percent, speedMBps) => { setPhoneProgress(percent); setPhoneSpeed(speedMBps); });
        setCompletionToast({ id: null, title: result.fileName, destination: "phone", kind: "file" });
      } else {
        if (!relayOnline) throw new Error(t("connectHint"));
        const created = await createComputerDownload({
          url: url.trim(),
          kind,
          quality: kind === "video" ? quality.toLowerCase() : undefined,
          audioFormat: kind === "audio" ? audioFormat : undefined,
        });
        setDownloads((current) => [created.download, ...current.filter((item) => item.id !== created.download.id)]);
        setNotice(t("added"));
      }
      setUrl("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("errorTitle"));
    } finally { setWorking(false); setPhoneProgress(null); setPhoneSpeed(0); }
  };
  const getSectionTitle = () => activeSection === "downloads" ? t("downloads") : activeSection === "library" ? t("libraryTitle") : activeSection === "relay" ? t("relay") : activeSection === "settings" ? t("settings") : t("controlRoom");

  const languagePicker = (
    <View style={[styles.languagePicker, width < 480 && { padding: 2 }]} accessibilityLabel={t("language")}>
      {languages.map((item) => (
        <TouchableOpacity key={item.code} onPress={() => setLanguage(item.code)} style={[styles.languageItem, width < 480 && { minWidth: 26, height: 26, paddingHorizontal: 3 }, language === item.code && styles.languageItemSelected]}>
          <Text style={[styles.languageText, width < 480 && { fontSize: 9 }, language === item.code && styles.languageTextSelected]}>{item.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const nav = (
    <View style={[styles.sidebar, !isWide && styles.sidebarCompact]}>
      <View style={styles.brandRow}>
        <NexusMark size={38} />
        <View style={{ flex: 1 }}>
          <Text style={styles.brandName}>LEVEL UP <Text style={styles.brandAccent}>NEXUS</Text></Text>
          <Text style={styles.brandCaption}>{t("compact")}</Text>
        </View>
      </View>
      <Text style={[styles.sideLabel, { textAlign: isRTL ? "right" : "left" }]}>{t("menu").toUpperCase()}</Text>
      {navItems.map((item) => {
        const selected = activeSection === item.key;
        return (
          <TouchableOpacity key={item.key} onPress={() => setActiveSection(item.key)} style={[styles.navItem, selected && styles.navItemSelected, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
            <MaterialCommunityIcons name={item.icon} size={20} color={selected ? COLORS.cyan : COLORS.muted} />
            <Text style={[styles.navLabel, selected && styles.navLabelSelected, { textAlign: isRTL ? "right" : "left" }]}>{item.label}</Text>
            {item.key === "relay" && <View style={styles.navDot} />}
          </TouchableOpacity>
        );
      })}
      <View style={styles.sidebarBottom}>
        <View style={styles.shieldIcon}><MaterialCommunityIcons name="shield-lock-outline" size={20} color={COLORS.green} /></View>
        <Text style={styles.safeTitle}>{t("security")}</Text>
        <Text style={[styles.safeText, { textAlign: isRTL ? "right" : "left" }]}>{t("noCloud")}</Text>
        <View style={styles.localPill}><View style={styles.onlineDot} /><Text style={styles.localPillText}>{t("localOnly")}</Text></View>
      </View>
    </View>
  );

  const header = (
    <View nativeID="nexus-titlebar" style={[styles.header, width < 480 && styles.headerCompact, { paddingTop: Math.max(insets.top, 8) + 8 + (windowsChrome ? 32 : 0) }]}>
      {!isDesktop && <NexusMark size={width < 360 ? 29 : 35} />}
      <View style={[styles.headerTitleBlock, width < 480 && styles.headerTitleBlockCompact, width < 390 && { maxWidth: 100 }, width < 360 && { maxWidth: 78 }]}>
        {!isDesktop && <Text style={styles.brandNameSmall}>LEVEL UP <Text style={styles.brandAccent}>NEXUS</Text></Text>}
        {isDesktop && <Text style={[styles.headerTitle, { textAlign: isRTL ? "right" : "left" }]}>{t("dashboard")}</Text>}
        {width >= 390 && <Text style={[styles.headerSub, { textAlign: isRTL ? "right" : "left" }]}>{t("tagline")}</Text>}
      </View>
      {isDesktop && (
        <View nativeID="nexus-titlebar-search" style={styles.searchShell}>
          <MaterialCommunityIcons name="magnify" size={19} color={COLORS.muted} />
          <TextInput placeholder={t("search")} placeholderTextColor="#A4B2C7" style={[styles.searchInput, { textAlign: isRTL ? "right" : "left", fontSize: 14 }]} />
          <MaterialCommunityIcons name="keyboard-return" size={16} color="#5E7190" />
        </View>
      )}
      <View nativeID="nexus-titlebar-controls" style={[styles.headerActions, width < 480 && styles.headerActionsCompact]}>
        {isElectronDesktop && <IconButton icon="web" label={t("openBrowser")} onPress={() => void openBrowser()} />}
        <IconButton icon="send-circle" label={t("support")} onPress={() => void openSupport()} />
        {isElectronDesktop && <IconButton icon={updateStatus?.state === "ready" ? "restart" : "update"} label={updateStatus?.state === "ready" ? t("installUpdate") : t("checkUpdates")} active={updateStatus?.state === "ready"} onPress={() => void checkOrInstallUpdate()} />}
        {languagePicker}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("pairPhone")} onPress={() => router.push("/pair")} style={styles.pairButton}>
          <MaterialCommunityIcons name="cellphone-link" size={17} color="#091326" />
          {width >= 390 && <Text style={styles.pairButtonText}>{t("pairPhone")}</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );

  const hero = (
    <View style={[styles.heroCard, dashboardStyles.heroCard, !isDesktop && dashboardStyles.heroCardCompact]}>
      <View style={styles.heroGlow} />
      <View style={[styles.heroContent, { maxWidth: isDesktop ? "72%" : "100%" }]}>
        <View style={styles.heroEyebrow}><View style={styles.heroEyebrowDot} /><Text style={styles.eyebrowText}>LEVEL UP • LOCAL MEDIA SYSTEM</Text></View>
        <Text style={[styles.heroTitle, dashboardStyles.heroTitle, { textAlign: isRTL ? "right" : "left" }]}>{getSectionTitle()}</Text>
        <Text style={[styles.heroSubtitle, dashboardStyles.heroSubtitle, { textAlign: isRTL ? "right" : "left" }]}>{activeSection === "overview" ? t("subtitle") : t("seeSetup")}</Text>
      </View>
      {isDesktop && <View style={styles.heroGraphic}>
        <View style={styles.orbitOuter} /><View style={styles.orbitInner} />
        <View style={styles.heroCore}><NexusMark size={56} /></View>
        <View style={[styles.orbitPoint, { top: 15, right: 28 }]} />
        <View style={[styles.orbitPoint, { bottom: 12, left: 30, backgroundColor: COLORS.violet }]} />
      </View>}
      <View style={[styles.heroFoot, { left: isRTL ? undefined : 20, right: isRTL ? 20 : undefined }]}><MaterialCommunityIcons name="wifi" size={15} color={COLORS.cyan} /><Text style={[styles.heroFootText, dashboardStyles.heroFootText]}>{t("localOnly")}</Text><View style={styles.dotSep} /><Text style={[styles.heroFootText, dashboardStyles.heroFootText]}>{t("noCloud")}</Text></View>
    </View>
  );

  const addCard = (
    <View style={dashboardStyles.downloadCard}>
      <View style={[dashboardStyles.downloadHead, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
        <View style={dashboardStyles.downloadMark}><MaterialCommunityIcons name="link-variant" size={20} color={COLORS.cyan} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[dashboardStyles.downloadTitle, { textAlign: isRTL ? "right" : "left" }]}>{t("addTitle")}</Text>
          <Text style={[dashboardStyles.downloadHint, { textAlign: isRTL ? "right" : "left" }]}>{t("videoOnComputer")}</Text>
        </View>
      </View>
      <View style={[dashboardStyles.downloadUrlRow, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
        <MaterialCommunityIcons name="link-variant" size={21} color={COLORS.cyan} />
        <TextInput value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder={t("paste")} placeholderTextColor="#A4B2C7" style={[dashboardStyles.downloadUrlInput, { textAlign: isRTL ? "right" : "left" }]} />
        <TouchableOpacity disabled={working} onPress={() => void startDownload()} style={[dashboardStyles.downloadStartButton, working && { opacity: 0.75 }]}>
          {working ? <ActivityIndicator size="small" color="#081226" /> : <MaterialCommunityIcons name="arrow-down-circle-outline" size={20} color="#081226" />}
          <Text style={dashboardStyles.downloadStartText}>{working ? t("working") : t("start")}</Text>
        </TouchableOpacity>
      </View>
      <View style={[dashboardStyles.controlsToolbar, selectorOpen && dashboardStyles.controlsToolbarOpen, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
        <View style={dashboardStyles.controlSection}>
          <Text style={[dashboardStyles.controlLabel, { textAlign: isRTL ? "right" : "left" }]}>{t("downloadType")}</Text>
          <View style={[dashboardStyles.kindGroup, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
            {([
              ["video", "movie-open-play", t("kindVideo")], ["audio", "music-note-outline", t("kindAudio")], ["file", "file-download-outline", t("kindFile")], ["torrent", "magnet", t("kindTorrent")],
            ] as [Kind, keyof typeof MaterialCommunityIcons.glyphMap, string][]).map(([value, icon, label]) => (
              <TouchableOpacity key={value} accessibilityRole="button" onPress={() => { setKind(value); setSelectorOpen(false); }} style={[dashboardStyles.kindChip, kind === value && dashboardStyles.kindChipSelected]}>
                <MaterialCommunityIcons name={icon} size={16} color={kind === value ? COLORS.cyan : COLORS.muted} />
                <Text style={[dashboardStyles.kindText, kind === value && dashboardStyles.kindTextSelected]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={dashboardStyles.controlSection}>
          <Text style={[dashboardStyles.controlLabel, { textAlign: isRTL ? "right" : "left" }]}>{t("destination")}</Text>
          <View style={[dashboardStyles.targetGroup, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
            <TouchableOpacity accessibilityRole="button" onPress={() => setTarget("computer")} style={[dashboardStyles.targetChip, target === "computer" && dashboardStyles.targetChipSelected]}>
              <MaterialCommunityIcons name="laptop" size={16} color={target === "computer" ? COLORS.cyan : COLORS.muted} />
              <Text style={[dashboardStyles.targetText, target === "computer" && dashboardStyles.targetTextSelected]}>{t("computer")}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" onPress={() => setTarget("phone")} style={[dashboardStyles.targetChip, target === "phone" && dashboardStyles.targetChipSelected]}>
              <MaterialCommunityIcons name="cellphone" size={16} color={target === "phone" ? COLORS.cyan : COLORS.muted} />
              <Text style={[dashboardStyles.targetText, target === "phone" && dashboardStyles.targetTextSelected]}>{t("phone")}</Text>
            </TouchableOpacity>
          </View>
        </View>
        {(kind === "video" || kind === "audio") && (
          <View style={dashboardStyles.controlSection}>
            <Text style={[dashboardStyles.controlLabel, { textAlign: isRTL ? "right" : "left" }]}>{kind === "video" ? t("quality") : t("audioFormat")}</Text>
            <View style={dashboardStyles.selectorWrap}>
              <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: selectorOpen }} onPress={() => setSelectorOpen((open) => !open)} style={[dashboardStyles.selectorButton, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
                <Text style={dashboardStyles.selectorValue}>{kind === "video" ? quality === "auto" ? t("qAuto") : quality : audioFormat.toUpperCase()}</Text>
                <MaterialCommunityIcons name={selectorOpen ? "chevron-up" : "chevron-down"} size={18} color={COLORS.cyan} />
              </TouchableOpacity>
              {selectorOpen && (
                <View style={[dashboardStyles.selectorMenu, isRTL ? { right: 0 } : { left: 0 }]}>
                  <ScrollView style={dashboardStyles.selectorMenuScroll} nestedScrollEnabled showsVerticalScrollIndicator>
                    {(kind === "video" ? qualityOptions : ["mp3", "m4a"]).map((item) => {
                      const selected = kind === "video" ? quality === item : audioFormat === item;
                      const label = kind === "video" ? item === "auto" ? t("qAuto") : item : item.toUpperCase();
                      return <TouchableOpacity key={item} onPress={() => { if (kind === "video") setQuality(item); else setAudioFormat(item as "mp3" | "m4a"); setSelectorOpen(false); }} style={[dashboardStyles.selectorOption, selected && dashboardStyles.selectorOptionSelected]}><Text style={[dashboardStyles.selectorOptionText, selected && dashboardStyles.selectorOptionTextSelected]}>{label}</Text></TouchableOpacity>;
                    })}
                  </ScrollView>
                </View>
              )}
            </View>
          </View>
        )}
      </View>
    </View>
  );

  const activeDownloadCount = downloads.filter((item) => item.status === "queued" || item.status === "downloading").length + (phoneProgress !== null ? 1 : 0);
  const queueCard = (
    <View style={[styles.panel, dashboardStyles.queueCard]}>
      <View style={[styles.sectionHeading, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
        <View style={{ flex: 1 }}><Text style={[styles.panelTitle, { textAlign: isRTL ? "right" : "left" }]}>{t("queue")}</Text><Text style={[styles.panelHint, { textAlign: isRTL ? "right" : "left" }]}>{t("seeSetup")}</Text></View>
        <View style={styles.queueCount}><Text style={styles.queueCountText}>{activeSection === "library" ? libraryFiles.length : activeDownloadCount}</Text></View>
        <TouchableOpacity onPress={() => setActiveSection("downloads")}><Text style={styles.viewAll}>{t("seeAll")} <MaterialCommunityIcons name={isRTL ? "arrow-left" : "arrow-right"} size={14} color={COLORS.cyan} /></Text></TouchableOpacity>
      </View>
      {activeSection === "library" ? (
        libraryFiles.length ? <View style={styles.transferList}>{libraryFiles.map((file) => <View key={`${file.name}-${file.modifiedAt}`} style={[styles.transferRow, { flexDirection: isRTL ? "row-reverse" : "row" }]}><View style={styles.transferIcon}><MaterialCommunityIcons name="file-outline" size={18} color={COLORS.cyan} /></View><View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={styles.transferTitle}>{file.name}</Text><Text style={styles.transferMeta}>{file.extension.toUpperCase() || "FILE"} · {formatBytes(file.sizeBytes)}</Text></View></View>)}</View>
          : <View style={styles.emptyState}><View style={styles.emptyIconHalo}><MaterialCommunityIcons name="folder-open-outline" size={34} color={COLORS.cyan} /></View><Text style={styles.emptyTitle}>{t("noFiles")}</Text><Text style={[styles.emptyDescription, { textAlign: "center" }]}>{t("libraryHint")}</Text></View>
      ) : downloads.length || phoneProgress !== null ? (
        <View style={styles.transferList}>
          {phoneProgress !== null && (
            <View style={styles.transferRow}>
              <View style={styles.transferIcon}><MaterialCommunityIcons name="cellphone-arrow-down" size={18} color={COLORS.cyan} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.transferTitle}>{t("phone")}</Text>
                <Text style={styles.transferMeta}>{phoneProgress.toFixed(0)}% · {phoneSpeed.toFixed(1)} MB/s</Text>
                <View style={styles.progressTrack}><View style={[styles.progressValue, { width: `${phoneProgress}%` }]} /></View>
              </View>
            </View>
          )}
          {downloads.map((item) => (
            <View key={item.id} style={styles.transferRow}>
              <View style={styles.transferIcon}><MaterialCommunityIcons name={item.kind === "video" ? "movie-play-outline" : item.kind === "audio" ? "music-note-outline" : item.kind === "torrent" ? "magnet" : "file-download-outline"} size={18} color={item.status === "failed" ? "#F28A83" : COLORS.cyan} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.transferTitleRow}><Text numberOfLines={1} style={styles.transferTitle}>{item.title}</Text><Text style={styles.transferPercent}>{item.percent.toFixed(0)}%</Text></View>
                <Text style={styles.transferMeta}>{item.engine} · {item.speedMBps.toFixed(1)} MB/s{item.etaSeconds !== null && item.etaSeconds !== undefined ? ` · ${t("remaining")} ${formatEta(item.etaSeconds)}` : ""} {item.error ? `· ${item.error}` : `· ${item.status}`}</Text>
                <View style={styles.progressTrack}><View style={[styles.progressValue, { width: `${Math.min(100, Math.max(0, item.percent))}%`, backgroundColor: item.status === "failed" ? "#F28A83" : item.status === "complete" ? COLORS.green : COLORS.cyan }]} /></View>
              </View>
              {item.status === "complete" && isElectronDesktop && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  {item.kind !== "torrent" && <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("openFile")} onPress={() => void openCompletedDownload(item.id, "file")} style={[styles.cancelButton, dashboardStyles.downloadActionButton]}><MaterialCommunityIcons name="play-box-outline" size={19} color={COLORS.cyan} /></TouchableOpacity>}
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("openFolder")} onPress={() => void openCompletedDownload(item.id, "folder")} style={[styles.cancelButton, dashboardStyles.downloadActionButton]}><MaterialCommunityIcons name="folder-open-outline" size={19} color={COLORS.cyan} /></TouchableOpacity>
                </View>
              )}
              {(item.status === "queued" || item.status === "downloading") && <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("cancel")} onPress={() => void cancelComputerDownload(item.id)} style={[styles.cancelButton, dashboardStyles.downloadActionButton]}><MaterialCommunityIcons name="close" size={18} color={COLORS.muted} /></TouchableOpacity>}
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <View style={styles.emptyIconHalo}><MaterialCommunityIcons name="download-circle-outline" size={34} color={COLORS.cyan} /></View>
          <Text style={styles.emptyTitle}>{t("emptyQueue")}</Text>
          <Text style={[styles.emptyDescription, { textAlign: "center" }]}>{t("emptyHint")}</Text>
          <View style={styles.emptyBadges}><Text style={styles.emptyBadge}>yt-dlp</Text><Text style={styles.emptyBadge}>FFmpeg</Text><Text style={styles.emptyBadge}>aria2c ×16</Text></View>
        </View>
      )}
    </View>
  );

  const aside = (
    <View style={[styles.rightRail, isWide ? dashboardStyles.rightRail : dashboardStyles.rightRailInline]}>
      <View style={[styles.relayCard, dashboardStyles.railCard]}>
        <View style={[styles.railTitleRow, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
          <View style={styles.relayIcon}><MaterialCommunityIcons name="lan-connect" size={20} color={COLORS.cyan} /></View>
          <View style={{ flex: 1 }}><Text style={[styles.railTitle, { textAlign: isRTL ? "right" : "left" }]}>{t("relay")}</Text><Text style={[styles.railSubtitle, { textAlign: isRTL ? "right" : "left" }]}>{t("localOnly")}</Text></View>
          <View style={[styles.offlineState, relayOnline && styles.onlineState]}><View style={[styles.offlineDot, relayOnline && styles.onlineStateDot]} /><Text style={[styles.offlineText, relayOnline && styles.onlineStateText]}>{relayOnline ? t("online") : t("offline")}</Text></View>
        </View>
        <View style={styles.relayVisual}>
          {pairingInfo?.qrDataUrl && localDesktop ? <Image source={{ uri: pairingInfo.qrDataUrl }} style={styles.qrImage} resizeMode="contain" /> : <View style={styles.relayRing}><NexusMark size={58} /></View>}
          <Text style={styles.relayStatus}>{pairingInfo && localDesktop ? pairingInfo.code : relayOnline ? t("paired") : t("disconnected")}</Text>
          <Text selectable style={[styles.relayHint, { textAlign: "center" }]}>{pairingInfo && localDesktop ? pairingInfo.relay : t("connectHint")}</Text>
        </View>
        <TouchableOpacity onPress={() => localDesktop ? void refreshPairing() : router.push("/pair")} style={styles.outlineButton}>
          <MaterialCommunityIcons name={localDesktop ? "refresh" : "qrcode-scan"} size={17} color={COLORS.cyan} /><Text style={styles.outlineButtonText}>{localDesktop ? t("refresh") : t("pairPhone")}</Text><MaterialCommunityIcons name="arrow-top-left" size={15} color={COLORS.muted} />
        </TouchableOpacity>
      </View>
      <View style={[styles.privacyCard, dashboardStyles.railCard]}>
        <View style={styles.privacyGlyph}><MaterialCommunityIcons name="shield-check-outline" size={22} color={COLORS.green} /></View>
        <View style={{ flex: 1 }}><Text style={[styles.privacyTitle, { textAlign: isRTL ? "right" : "left" }]}>{t("security")}</Text><Text style={[styles.privacyBody, { textAlign: isRTL ? "right" : "left" }]}>{t("privacyNote")}</Text></View>
      </View>
      <View style={[styles.enginesCard, dashboardStyles.railCard]}>
        <Text style={[styles.railTitle, { textAlign: isRTL ? "right" : "left" }]}>{t("engineStatus")}</Text>
        <EngineRow icon="movie-play-outline" name={t("videoEngine")} engines="yt-dlp + FFmpeg" color={COLORS.violet} ready={!!engineStatus?.ytDlp.installed && !!engineStatus?.ffmpeg.installed} />
        <EngineRow icon="lightning-bolt-outline" name={t("fileEngine")} engines="aria2c · 16x" color={COLORS.cyan} ready={!!engineStatus?.aria2c.installed} />
          <Text style={[styles.engineFootnote, dashboardStyles.mutedBody, { textAlign: isRTL ? "right" : "left" }]}>{engineStatus?.ytDlp.installed && engineStatus.ffmpeg.installed && engineStatus.aria2c.installed ? t("allEnginesReady") : t("engineMissing")}</Text>
      </View>
      <View style={[styles.storageCard, dashboardStyles.railCard]}>
        <View style={styles.storageTop}><MaterialCommunityIcons name="harddisk" size={18} color={COLORS.cyan} /><Text style={styles.railTitle}>{t("storage")}</Text></View>
        <Text style={[styles.storageHint, { textAlign: isRTL ? "right" : "left" }]}>{t("libraryHint")}</Text>
      </View>
    </View>
  );

  const mobileNav = !isDesktop ? (
    <View style={[styles.mobileNav, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {navItems.slice(0, 4).map((item) => (
        <TouchableOpacity key={item.key} onPress={() => setActiveSection(item.key)} style={styles.mobileNavItem}>
          <MaterialCommunityIcons name={item.icon} size={20} color={activeSection === item.key ? COLORS.cyan : COLORS.muted} />
          <Text style={[styles.mobileNavLabel, activeSection === item.key && styles.mobileNavLabelActive]}>{item.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  ) : null;

  return (
    <View style={styles.screen}>
      {header}
      <View style={styles.workspace}>
        {isWide && nav}
        <ScrollView style={styles.mainScroll} contentContainerStyle={[styles.mainContent, dashboardStyles.mainContent, !isWide && { paddingHorizontal: isDesktop ? 30 : 18 }]} showsVerticalScrollIndicator={false}>
          {isDesktop && !isWide && <View style={styles.desktopNav}>{navItems.map((item) => <TouchableOpacity key={item.key} onPress={() => setActiveSection(item.key)} style={[styles.desktopNavItem, activeSection === item.key && styles.desktopNavItemSelected]}><MaterialCommunityIcons name={item.icon} size={17} color={activeSection === item.key ? COLORS.cyan : COLORS.muted} /><Text style={[styles.desktopNavText, activeSection === item.key && styles.desktopNavTextSelected]}>{item.label}</Text></TouchableOpacity>)}</View>}
          {!isDesktop && <Text style={styles.mobileGreeting}>{getSectionTitle()}</Text>}
          {hero}
          {addCard}
          {notice ? <View style={styles.noticeBar}><MaterialCommunityIcons name="information-outline" size={16} color={COLORS.cyan} /><Text style={styles.noticeText}>{notice}</Text></View> : null}
          {!isWide && <View style={styles.inlineRelay}>{aside}</View>}
          {queueCard}
          <View style={styles.bottomNote}><MaterialCommunityIcons name="lock-check" size={14} color={COLORS.green} /><Text style={[styles.bottomNoteText, dashboardStyles.mutedBody]}>{t("noCloud")}</Text><Text style={[styles.bottomBuild, dashboardStyles.buildStamp]}>NEXUS · PHASE 03</Text></View>
        </ScrollView>
        {isWide && navItems.length > 0 && aside}
      </View>
      {mobileNav}
      {completionToast && (
        <View style={[dashboardStyles.completionToast, { bottom: isDesktop ? 22 : 82, left: isWide ? 236 : 12, right: isWide ? 300 : 12, flexDirection: isRTL ? "row-reverse" : "row" }]}>
          <View style={dashboardStyles.toastIcon}><MaterialCommunityIcons name="check-circle" size={22} color={COLORS.green} /></View>
          <View style={dashboardStyles.toastCopy}>
            <Text style={[dashboardStyles.toastTitle, { textAlign: isRTL ? "right" : "left" }]}>{completionToast.destination === "phone" ? t("phoneSaved") : t("downloadFinished")}</Text>
            <Text numberOfLines={1} style={[dashboardStyles.toastName, { textAlign: isRTL ? "right" : "left" }]}>{completionToast.title}</Text>
          </View>
          {completionToast.id && isElectronDesktop && (
            <View style={[dashboardStyles.toastActions, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
              {completionToast.kind !== "torrent" && <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("openFile")} onPress={() => void openCompletedDownload(completionToast.id!, "file")} style={dashboardStyles.toastAction}>
                <MaterialCommunityIcons name="play-box-outline" size={17} color={COLORS.cyan} /><Text style={dashboardStyles.toastActionText}>{t("openFile")}</Text>
              </TouchableOpacity>}
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("openFolder")} onPress={() => void openCompletedDownload(completionToast.id!, "folder")} style={dashboardStyles.toastAction}>
                <MaterialCommunityIcons name="folder-open-outline" size={17} color={COLORS.cyan} /><Text style={dashboardStyles.toastActionText}>{t("openFolder")}</Text>
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("dismiss")} onPress={() => setCompletionToast(null)} style={dashboardStyles.toastDismiss}>
            <MaterialCommunityIcons name="close" size={18} color={COLORS.muted} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 1) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatEta(seconds: number) {
  const total = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function EngineRow({ icon, name, engines, color, ready }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; name: string; engines: string; color: string; ready: boolean }) {
  return (
    <View style={styles.engineRow}>
      <View style={[styles.engineIcon, { borderColor: `${color}45` }]}><MaterialCommunityIcons name={icon} size={17} color={color} /></View>
      <View style={{ flex: 1 }}><Text style={styles.engineName}>{name}</Text><Text style={styles.engineCode}>{engines}</Text></View>
      <View style={[styles.engineStatusDot, ready && styles.engineStatusReady]} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  header: { minHeight: 78, paddingHorizontal: 24, paddingBottom: 12, flexDirection: "row", alignItems: "center", gap: 16, borderTopWidth: 0, borderBottomWidth: 1, borderBottomColor: "#132139", backgroundColor: COLORS.background }, headerCompact: { minHeight: 68, paddingHorizontal: 10, gap: 7 },
  headerTitleBlock: { minWidth: 150 }, headerTitleBlockCompact: { minWidth: 0, maxWidth: 126, flexShrink: 1 }, headerTitle: { color: COLORS.text, fontSize: 17, fontWeight: "700" }, headerSub: { color: COLORS.muted, fontSize: 11, marginTop: 3 },
  brandNameSmall: { color: COLORS.text, fontWeight: "800", fontSize: 14 }, brandName: { color: COLORS.text, fontWeight: "800", fontSize: 13, letterSpacing: 0.5 }, brandAccent: { color: COLORS.violet }, brandCaption: { color: COLORS.muted, fontSize: 9, marginTop: 3 },
  markWrap: { alignItems: "center", justifyContent: "center", backgroundColor: "#101E35", borderWidth: 1, borderColor: "#253A59" },
  searchShell: { flex: 1, maxWidth: 440, height: 42, marginHorizontal: 20, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "#0B1729", flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12 }, searchInput: { flex: 1, color: COLORS.text, fontSize: 13, outlineStyle: "none" as never },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8, marginLeft: "auto" }, headerActionsCompact: { gap: 4 }, languagePicker: { flexDirection: "row", alignItems: "center", backgroundColor: "#0C1728", borderRadius: 11, padding: 3, borderWidth: 1, borderColor: COLORS.border }, languageItem: { minWidth: 30, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 8, paddingHorizontal: 5 }, languageItemSelected: { backgroundColor: "#213450" }, languageText: { fontSize: 10, color: COLORS.muted, fontWeight: "700" }, languageTextSelected: { color: COLORS.text },
  iconButton: { height: 38, width: 38, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "#0C1728", borderWidth: 1, borderColor: COLORS.border }, iconButtonActive: { borderColor: "#264261" },
  pairButton: { height: 40, borderRadius: 11, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: COLORS.cyan }, pairButtonText: { color: "#071321", fontSize: 12, fontWeight: "800" },
  workspace: { flex: 1, flexDirection: "row", overflow: "hidden" },
  sidebar: { width: 208, borderRightWidth: 1, borderRightColor: "#132139", paddingHorizontal: 15, paddingVertical: 19, backgroundColor: "#080F1D" }, sidebarCompact: { width: "100%" }, brandRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 7, marginBottom: 31 }, sideLabel: { color: "#586A83", fontSize: 9, fontWeight: "800", letterSpacing: 1.3, paddingHorizontal: 10, marginBottom: 10 },
  navItem: { minHeight: 43, borderRadius: 11, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 5 }, navItemSelected: { backgroundColor: "#121F36", borderWidth: 1, borderColor: "#263C60" }, navLabel: { flex: 1, color: "#A3B1C6", fontSize: 12, fontWeight: "600" }, navLabelSelected: { color: COLORS.text }, navDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.green },
  sidebarBottom: { marginTop: "auto", borderRadius: 15, padding: 14, backgroundColor: "#0D1A2D", borderWidth: 1, borderColor: COLORS.border }, shieldIcon: { height: 32, width: 32, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "#123329", marginBottom: 10 }, safeTitle: { color: COLORS.text, fontSize: 12, fontWeight: "700" }, safeText: { color: COLORS.muted, fontSize: 10, lineHeight: 15, marginTop: 5 }, localPill: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.border }, onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.green }, localPillText: { color: COLORS.green, fontSize: 9, fontWeight: "700" },
  mainScroll: { flex: 1 }, mainContent: { padding: 22, gap: 16, paddingBottom: 30 }, desktopNav: { flexDirection: "row", gap: 6, flexWrap: "wrap" }, desktopNavItem: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 10, backgroundColor: "#0A1525" }, desktopNavItemSelected: { backgroundColor: "#13233B" }, desktopNavText: { color: COLORS.muted, fontSize: 11 }, desktopNavTextSelected: { color: COLORS.text }, mobileGreeting: { color: COLORS.text, fontSize: 23, fontWeight: "800", marginTop: 4 },
  heroCard: { minHeight: 167, overflow: "hidden", borderRadius: 18, borderWidth: 1, borderColor: "#233A64", backgroundColor: "#0D1D38", padding: 21, position: "relative", justifyContent: "center" }, heroGlow: { position: "absolute", right: -50, top: -140, width: 340, height: 300, borderRadius: 180, backgroundColor: "#211A55", opacity: 0.44 }, heroContent: { zIndex: 1, maxWidth: "74%" }, heroEyebrow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }, heroEyebrowDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.cyan }, eyebrowText: { color: "#8197BA", fontSize: 9, fontWeight: "800", letterSpacing: 1.3 }, heroTitle: { color: COLORS.text, fontSize: 24, fontWeight: "800", letterSpacing: -0.4 }, heroSubtitle: { color: "#A5B5CF", fontSize: 12, lineHeight: 19, marginTop: 7 }, heroGraphic: { position: "absolute", right: 30, top: 12, width: 154, height: 140, alignItems: "center", justifyContent: "center" }, orbitOuter: { position: "absolute", width: 128, height: 128, borderRadius: 64, borderWidth: 1, borderColor: "#45618B", opacity: 0.45 }, orbitInner: { position: "absolute", width: 95, height: 95, borderRadius: 48, borderWidth: 1, borderColor: "#5362A0", opacity: 0.5 }, heroCore: { width: 75, height: 75, alignItems: "center", justifyContent: "center", borderRadius: 24, backgroundColor: "#111F3A", borderWidth: 1, borderColor: "#344E73" }, orbitPoint: { position: "absolute", width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.cyan, boxShadow: "0px 0px 9px rgba(33, 200, 243, 0.7)" }, heroFoot: { position: "absolute", left: 20, bottom: 13, flexDirection: "row", alignItems: "center", gap: 7 }, heroFootText: { color: "#9EB0C8", fontSize: 9 }, dotSep: { width: 3, height: 3, borderRadius: 2, backgroundColor: "#536580", marginHorizontal: 2 },
  panel: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 17, borderWidth: 1, borderColor: COLORS.border }, panelHeading: { alignItems: "center", gap: 11, marginBottom: 14 }, panelIcon: { width: 35, height: 35, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "#11273A", borderWidth: 1, borderColor: "#1F3C55" }, panelTitle: { color: COLORS.text, fontSize: 15, fontWeight: "700" }, panelHint: { color: COLORS.muted, fontSize: 10, marginTop: 3 }, secureMini: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: "#10251F", borderRadius: 8 }, secureMiniText: { color: COLORS.green, fontSize: 9, fontWeight: "700" },
  urlRow: { minHeight: 52, backgroundColor: "#081321", borderWidth: 1, borderColor: "#243A59", borderRadius: 12, flexDirection: "row", alignItems: "center", padding: 5, gap: 8 }, urlIcon: { width: 38, height: 38, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "#10223A" }, urlInput: { flex: 1, minWidth: 30, color: COLORS.text, fontSize: 12, outlineStyle: "none" as never }, startButton: { height: 40, borderRadius: 9, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: COLORS.violet }, startButtonText: { color: "#FFF", fontSize: 11, fontWeight: "800" },
  optionsRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, marginTop: 13 }, kindGroup: { flexDirection: "row", alignItems: "center", gap: 5 }, kindChip: { minHeight: 31, borderRadius: 9, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#101D30", borderWidth: 1, borderColor: "transparent" }, kindChipSelected: { backgroundColor: "#112B3B", borderColor: "#1E536A" }, kindText: { color: COLORS.muted, fontSize: 9 }, kindTextSelected: { color: "#BDEEFF" }, optionDivider: { width: 1, height: 22, backgroundColor: COLORS.border }, targetGroup: { flexDirection: "row", alignItems: "center", gap: 6 }, optionLabel: { color: COLORS.muted, fontSize: 10, fontWeight: "600", marginRight: 3 }, targetChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8 }, targetChipSelected: { backgroundColor: "#132C3E" }, targetText: { color: COLORS.muted, fontSize: 9 }, targetTextSelected: { color: "#BCEBFA" }, qualityRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12, paddingTop: 11, borderTopWidth: 1, borderTopColor: "#17263B" }, qualityList: { alignItems: "center", gap: 5, paddingRight: 5 }, qualityChip: { paddingVertical: 6, paddingHorizontal: 9, borderRadius: 7, backgroundColor: "#111E31", borderWidth: 1, borderColor: "transparent" }, qualityChipSelected: { backgroundColor: "#242047", borderColor: "#5D4BC0" }, qualityText: { color: COLORS.muted, fontSize: 9, fontWeight: "700" }, qualityTextSelected: { color: "#D8D1FF" },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 9 }, queueCount: { height: 22, minWidth: 22, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "#162842" }, queueCountText: { color: COLORS.cyan, fontSize: 10, fontWeight: "800" }, viewAll: { color: COLORS.cyan, fontSize: 10 }, emptyState: { minHeight: 197, borderRadius: 13, borderWidth: 1, borderStyle: "dashed", borderColor: "#243752", alignItems: "center", justifyContent: "center", paddingHorizontal: 20, backgroundColor: "#0A1423" }, emptyIconHalo: { width: 58, height: 58, borderRadius: 20, backgroundColor: "#11263C", alignItems: "center", justifyContent: "center", marginBottom: 13 }, emptyTitle: { color: COLORS.text, fontSize: 13, fontWeight: "700" }, emptyDescription: { color: COLORS.muted, fontSize: 10, lineHeight: 15, marginTop: 5, maxWidth: 330 }, emptyBadges: { flexDirection: "row", gap: 7, marginTop: 13 }, emptyBadge: { color: "#8397B6", backgroundColor: "#132136", fontSize: 8, borderRadius: 6, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5 },
  rightRail: { width: 280, padding: 16, borderLeftWidth: 1, borderLeftColor: "#132139", backgroundColor: "#080F1D", gap: 12 }, relayCard: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 14 }, railTitleRow: { flexDirection: "row", alignItems: "center", gap: 9 }, relayIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: "#10283C", alignItems: "center", justifyContent: "center" }, railTitle: { color: COLORS.text, fontSize: 12, fontWeight: "700" }, railSubtitle: { color: COLORS.muted, fontSize: 9, marginTop: 3 }, offlineState: { flexDirection: "row", gap: 5, alignItems: "center", backgroundColor: "#291E21", paddingHorizontal: 7, paddingVertical: 5, borderRadius: 7 }, offlineDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#F28A83" }, offlineText: { color: "#F6A4A0", fontSize: 8, fontWeight: "700" }, relayVisual: { alignItems: "center", paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: COLORS.border, marginBottom: 12 }, relayRing: { width: 92, height: 92, borderRadius: 46, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#263E5C", backgroundColor: "#0A1423", marginBottom: 12 }, relayStatus: { color: COLORS.text, fontSize: 11, fontWeight: "700" }, relayHint: { color: COLORS.muted, fontSize: 9, lineHeight: 14, marginTop: 5, maxWidth: 205 }, outlineButton: { height: 37, borderRadius: 9, borderWidth: 1, borderColor: "#2A4A67", backgroundColor: "#112339", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }, outlineButtonText: { color: "#BDEEFF", fontSize: 10, fontWeight: "700" },
  privacyCard: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 13, borderRadius: 13, backgroundColor: "#0D1D1D", borderWidth: 1, borderColor: "#1B3832" }, privacyGlyph: { height: 33, width: 33, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#123029" }, privacyTitle: { color: "#D5F4E8", fontSize: 10, fontWeight: "700" }, privacyBody: { color: "#8FA99F", fontSize: 9, lineHeight: 14, marginTop: 4 },
  enginesCard: { padding: 14, borderRadius: 15, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border }, engineRow: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 12 }, engineIcon: { width: 31, height: 31, borderRadius: 9, borderWidth: 1, backgroundColor: "#101B2C", alignItems: "center", justifyContent: "center" }, engineName: { color: "#D7E1F2", fontSize: 10, fontWeight: "600" }, engineCode: { color: COLORS.muted, fontSize: 9, marginTop: 2 }, engineStatusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.amber, opacity: 0.9 }, engineFootnote: { color: "#75859C", fontSize: 8, lineHeight: 13, marginTop: 11, paddingTop: 9, borderTopWidth: 1, borderTopColor: COLORS.border },
  storageCard: { padding: 13, borderRadius: 15, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border }, storageTop: { flexDirection: "row", alignItems: "center", gap: 8 }, storageHint: { color: COLORS.muted, fontSize: 9, lineHeight: 14, marginTop: 8 },
  transferList: { gap: 9 }, transferRow: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 11, backgroundColor: "#0A1423", borderWidth: 1, borderColor: "#1A2A41" }, transferIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: "#10253A", alignItems: "center", justifyContent: "center" }, transferTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 }, transferTitle: { color: "#E8EFFB", fontSize: 11, fontWeight: "700", flex: 1 }, transferPercent: { color: COLORS.cyan, fontSize: 10, fontWeight: "700" }, transferMeta: { color: COLORS.muted, fontSize: 9, marginTop: 3 }, progressTrack: { height: 4, backgroundColor: "#1B2D47", borderRadius: 3, overflow: "hidden", marginTop: 7 }, progressValue: { height: 4, borderRadius: 3, backgroundColor: COLORS.cyan }, cancelButton: { width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: "#121F31" }, noticeBar: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: "#102038", borderWidth: 1, borderColor: "#254064" }, noticeText: { color: "#C4D5EB", fontSize: 10, flex: 1 },
  qrImage: { width: 148, height: 148, borderRadius: 10, backgroundColor: "#FFFFFF", marginBottom: 10 }, onlineState: { backgroundColor: "#10251F" }, onlineStateDot: { backgroundColor: COLORS.green }, onlineStateText: { color: COLORS.green }, engineStatusReady: { backgroundColor: COLORS.green },
  inlineRelay: { marginHorizontal: -1 }, bottomNote: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 }, bottomNoteText: { color: "#7C8DA7", fontSize: 9, flex: 1 }, bottomBuild: { color: "#40516A", fontSize: 8, letterSpacing: 1.1 }, mobileNav: { minHeight: 61, flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingTop: 8, backgroundColor: "#080F1D", borderTopWidth: 1, borderTopColor: COLORS.border }, mobileNavItem: { alignItems: "center", gap: 3, minWidth: 55 }, mobileNavLabel: { color: COLORS.muted, fontSize: 8 }, mobileNavLabelActive: { color: COLORS.cyan, fontWeight: "700" },
});


const dashboardStyles = StyleSheet.create({
  downloadCard: { position: "relative", zIndex: 2, gap: 16, padding: 22, borderRadius: 18, borderWidth: 1, borderColor: "#263954", backgroundColor: COLORS.surface },
  downloadHead: { alignItems: "center", gap: 13, marginBottom: 1 },
  downloadMark: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#10283B", borderWidth: 1, borderColor: "#24455E" },
  downloadTitle: { color: COLORS.text, fontSize: 18, fontWeight: "800" },
  downloadHint: { color: COLORS.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  downloadUrlRow: { minHeight: 62, gap: 12, padding: 7, paddingHorizontal: 14, alignItems: "center", borderRadius: 14, borderWidth: 1, borderColor: "#2A4260", backgroundColor: "#071321" },
  downloadUrlInput: { flex: 1, minWidth: 30, color: COLORS.text, fontSize: 15, outlineStyle: "none" as never },
  downloadStartButton: { minWidth: 120, minHeight: 46, paddingHorizontal: 15, gap: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: COLORS.violet },
  downloadStartText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  controlsToolbar: { position: "relative", flexWrap: "wrap", alignItems: "flex-end", gap: 16, padding: 14, borderRadius: 15, borderWidth: 1, borderColor: "#20334F", backgroundColor: "#091524" },
  controlsToolbarOpen: { zIndex: 40, elevation: 8 },
  controlSection: { minWidth: 142, gap: 8, flexGrow: 1 },
  controlLabel: { color: "#C0CCDC", fontSize: 12, fontWeight: "700" },
  kindGroup: { flexDirection: "row", flexWrap: "wrap", gap: 5, padding: 4, borderRadius: 11, borderWidth: 1, borderColor: "#233650", backgroundColor: "#08121F" },
  kindChip: { minHeight: 38, paddingHorizontal: 9, gap: 6, flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: "transparent" },
  kindChipSelected: { backgroundColor: "#153248", borderWidth: 1, borderColor: "#2A667A" },
  kindText: { color: COLORS.muted, fontSize: 12, fontWeight: "600" },
  kindTextSelected: { color: "#E4F8FF", fontWeight: "700" },
  targetGroup: { minHeight: 46, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5, padding: 4, borderRadius: 11, borderWidth: 1, borderColor: "#233650", backgroundColor: "#08121F" },
  targetChip: { minHeight: 36, paddingHorizontal: 11, gap: 6, flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: 8 },
  targetChipSelected: { backgroundColor: "#153248" },
  targetText: { color: COLORS.muted, fontSize: 12, fontWeight: "600" },
  targetTextSelected: { color: "#E4F8FF", fontWeight: "700" },
  downloadActionButton: { width: 38, height: 38, borderRadius: 10, borderWidth: 1, borderColor: "#29415F", backgroundColor: "#0E1B2B" },
  selectorWrap: { position: "relative", zIndex: 45, minWidth: 164 },
  selectorButton: { minHeight: 46, minWidth: 164, gap: 10, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 11, borderWidth: 1, borderColor: "#304666", backgroundColor: "#101F35" },
  selectorValue: { flex: 1, color: COLORS.text, fontSize: 13, fontWeight: "700" },
  selectorMenu: { position: "absolute", top: 50, minWidth: 190, maxHeight: 310, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: "#385071", backgroundColor: "#101F35", zIndex: 80, elevation: 16, boxShadow: "0px 8px 16px rgba(0, 0, 0, 0.36)" },
  selectorMenuScroll: { maxHeight: 298 },
  selectorOption: { minHeight: 40, justifyContent: "center", paddingHorizontal: 15, borderRadius: 8, marginHorizontal: 5 },
  selectorOptionSelected: { backgroundColor: "#242047" },
  selectorOptionText: { color: "#C0CCDC", fontSize: 13 },
  selectorOptionTextSelected: { color: "#E1DAFF", fontWeight: "800" },
  mainContent: { padding: 26, paddingBottom: 36, gap: 20 },
  heroCard: { minHeight: 154, padding: 24, borderRadius: 20 },
  heroCardCompact: { minHeight: 166, padding: 20, paddingBottom: 44 },
  heroTitle: { fontSize: 27, lineHeight: 34 },
  heroSubtitle: { fontSize: 14, lineHeight: 22 },
  heroFootText: { color: "#BBC9DB", fontSize: 11 },
  queueCard: { padding: 21, borderRadius: 18 },
  rightRail: { width: 300, padding: 18, gap: 16, borderLeftColor: "#1D2C42" },
  rightRailInline: { width: "100%", padding: 0, gap: 14, borderLeftWidth: 0, backgroundColor: "transparent" },
  railCard: { padding: 18, borderRadius: 18 },
  completionToast: { position: "absolute", zIndex: 120, minHeight: 80, maxWidth: 720, flexDirection: "row", alignItems: "center", gap: 12, padding: 13, borderRadius: 16, borderWidth: 1, borderColor: "#31506F", backgroundColor: "#102038", boxShadow: "0px 8px 18px rgba(0, 0, 0, 0.38)", elevation: 18 },
  toastIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#103328", borderWidth: 1, borderColor: "#28634F" },
  toastCopy: { flex: 1, minWidth: 90, gap: 3 },
  mutedBody: { color: "#A4B2C7", fontSize: 12, lineHeight: 18 },
  buildStamp: { color: "#8293AA", fontSize: 10, letterSpacing: 1 },
  toastTitle: { color: "#DDF8EC", fontSize: 14, fontWeight: "800" },
  toastName: { color: "#C0CCDC", fontSize: 12 },
  toastActions: { flexDirection: "row", alignItems: "center", gap: 7 },
  toastAction: { minHeight: 38, paddingHorizontal: 11, gap: 6, flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: 10, borderWidth: 1, borderColor: "#31516D", backgroundColor: "#142A43" },
  toastActionText: { color: "#DBF4FF", fontSize: 12, fontWeight: "700" },
  toastDismiss: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: "#162A41" },
});
