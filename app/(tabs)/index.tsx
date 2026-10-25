import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Svg, { Circle, Path, Defs, LinearGradient as SvgGradient, Stop } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { useNexusI18n, type Language } from "@/lib/i18n";
import { cancelComputerDownload, createComputerDownload, downloadDirectToPhone, getRelaySession, isLocalDesktop, relayRequest, routePhoneDownload, subscribeRelayDownloads, type EngineStatus, type Transfer } from "@/lib/relay-client";

const COLORS = {
  background: "#070D19", surface: "#0C1728", surface2: "#101F35", border: "#1B2B45",
  text: "#F3F6FF", muted: "#8293AE", cyan: "#21C8F3", violet: "#8669FF", green: "#49D6A1", amber: "#F4B85A",
};
const languages: { code: Language; label: string }[] = [
  { code: "ar", label: "ع" }, { code: "en", label: "EN" }, { code: "fr", label: "FR" },
];
const qualityOptions = ["240p", "360p", "480p", "720p", "1080p", "1440p", "4K", "8K"];

type NavKey = "overview" | "downloads" | "library" | "relay" | "settings";
type Kind = "video" | "file" | "torrent";

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
  const [url, setUrl] = useState("");
  const [downloads, setDownloads] = useState<Transfer[]>([]);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [relayOnline, setRelayOnline] = useState(false);
  const [pairingInfo, setPairingInfo] = useState<{ relay: string; code: string; qrDataUrl: string; expiresAt: number } | null>(null);
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [phoneProgress, setPhoneProgress] = useState<number | null>(null);
  const [phoneSpeed, setPhoneSpeed] = useState(0);
  const [libraryFiles, setLibraryFiles] = useState<{ name: string; sizeBytes: number; extension: string; modifiedAt: number }[]>([]);
  const localDesktop = isLocalDesktop();
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
        setNotice(`${t("phoneSaved")}: ${result.fileName}`);
      } else {
        if (!relayOnline) throw new Error(t("connectHint"));
        const created = await createComputerDownload({ url: url.trim(), kind, quality: quality === "Best" ? "auto" : quality.toLowerCase() });
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
    <View style={styles.languagePicker} accessibilityLabel={t("language")}>
      {languages.map((item) => (
        <TouchableOpacity key={item.code} onPress={() => setLanguage(item.code)} style={[styles.languageItem, language === item.code && styles.languageItemSelected]}>
          <Text style={[styles.languageText, language === item.code && styles.languageTextSelected]}>{item.label}</Text>
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
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) + 8 }]}>
      {!isDesktop && <NexusMark size={35} />}
      <View style={styles.headerTitleBlock}>
        {!isDesktop && <Text style={styles.brandNameSmall}>LEVEL UP <Text style={styles.brandAccent}>NEXUS</Text></Text>}
        {isDesktop && <Text style={[styles.headerTitle, { textAlign: isRTL ? "right" : "left" }]}>{t("dashboard")}</Text>}
        <Text style={[styles.headerSub, { textAlign: isRTL ? "right" : "left" }]}>{t("tagline")}</Text>
      </View>
      {isDesktop && (
        <View style={styles.searchShell}>
          <MaterialCommunityIcons name="magnify" size={19} color={COLORS.muted} />
          <TextInput placeholder={t("search")} placeholderTextColor="#62738D" style={[styles.searchInput, { textAlign: isRTL ? "right" : "left" }]} />
          <MaterialCommunityIcons name="keyboard-return" size={16} color="#5E7190" />
        </View>
      )}
      <View style={styles.headerActions}>
        {languagePicker}
        <IconButton icon="bell-outline" label="Notifications" />
        <TouchableOpacity onPress={() => router.push("/pair")} style={styles.pairButton}>
          <MaterialCommunityIcons name="cellphone-link" size={17} color="#091326" />
          <Text style={styles.pairButtonText}>{t("pairPhone")}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const hero = (
    <View style={styles.heroCard}>
      <View style={styles.heroGlow} />
      <View style={styles.heroContent}>
        <View style={styles.heroEyebrow}><View style={styles.heroEyebrowDot} /><Text style={styles.eyebrowText}>LEVEL UP • LOCAL MEDIA SYSTEM</Text></View>
        <Text style={[styles.heroTitle, { textAlign: isRTL ? "right" : "left" }]}>{getSectionTitle()}</Text>
        <Text style={[styles.heroSubtitle, { textAlign: isRTL ? "right" : "left" }]}>{activeSection === "overview" ? t("subtitle") : t("seeSetup")}</Text>
      </View>
      <View style={styles.heroGraphic}>
        <View style={styles.orbitOuter} /><View style={styles.orbitInner} />
        <View style={styles.heroCore}><NexusMark size={56} /></View>
        <View style={[styles.orbitPoint, { top: 15, right: 28 }]} />
        <View style={[styles.orbitPoint, { bottom: 12, left: 30, backgroundColor: COLORS.violet }]} />
      </View>
      <View style={styles.heroFoot}><MaterialCommunityIcons name="wifi" size={15} color={COLORS.cyan} /><Text style={styles.heroFootText}>{t("localOnly")}</Text><View style={styles.dotSep} /><Text style={styles.heroFootText}>{t("noCloud")}</Text></View>
    </View>
  );

  const addCard = (
    <View style={styles.panel}>
      <View style={[styles.panelHeading, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
        <View style={styles.panelIcon}><MaterialCommunityIcons name="link-variant" size={18} color={COLORS.cyan} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.panelTitle, { textAlign: isRTL ? "right" : "left" }]}>{t("addTitle")}</Text>
          <Text style={[styles.panelHint, { textAlign: isRTL ? "right" : "left" }]}>{t("videoOnComputer")}</Text>
        </View>
        <View style={styles.secureMini}><MaterialCommunityIcons name="lock-outline" size={13} color={COLORS.green} /><Text style={styles.secureMiniText}>{t("localOnly")}</Text></View>
      </View>
      <View style={[styles.urlRow, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
        <View style={styles.urlIcon}><MaterialCommunityIcons name="link" size={21} color={COLORS.cyan} /></View>
        <TextInput value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder={t("paste")} placeholderTextColor="#73839C" style={[styles.urlInput, { textAlign: isRTL ? "right" : "left" }]} />
        <TouchableOpacity disabled={working} onPress={() => void startDownload()} style={[styles.startButton, working && { opacity: 0.75 }]}>
          {working ? <ActivityIndicator size="small" color="#081226" /> : <MaterialCommunityIcons name="arrow-down-circle-outline" size={18} color="#081226" />}
          <Text style={styles.startButtonText}>{working ? t("working") : t("start")}</Text>
        </TouchableOpacity>
      </View>
      <View style={[styles.optionsRow, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
        <View style={styles.kindGroup}>
          {([
            ["video", "movie-open-play", t("kindVideo")], ["file", "file-download-outline", t("kindFile")], ["torrent", "magnet", t("kindTorrent")],
          ] as [Kind, keyof typeof MaterialCommunityIcons.glyphMap, string][]).map(([value, icon, label]) => (
            <TouchableOpacity key={value} onPress={() => setKind(value)} style={[styles.kindChip, kind === value && styles.kindChipSelected]}>
              <MaterialCommunityIcons name={icon} size={15} color={kind === value ? COLORS.cyan : COLORS.muted} />
              {isDesktop && <Text style={[styles.kindText, kind === value && styles.kindTextSelected]}>{label}</Text>}
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.optionDivider} />
        <View style={styles.targetGroup}>
          <Text style={styles.optionLabel}>{t("destination")}</Text>
          <TouchableOpacity onPress={() => setTarget("computer")} style={[styles.targetChip, target === "computer" && styles.targetChipSelected]}>
            <MaterialCommunityIcons name="laptop" size={15} color={target === "computer" ? COLORS.cyan : COLORS.muted} />
            <Text style={[styles.targetText, target === "computer" && styles.targetTextSelected]}>{t("computer")}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setTarget("phone")} style={[styles.targetChip, target === "phone" && styles.targetChipSelected]}>
            <MaterialCommunityIcons name="cellphone" size={15} color={target === "phone" ? COLORS.cyan : COLORS.muted} />
            <Text style={[styles.targetText, target === "phone" && styles.targetTextSelected]}>{t("phone")}</Text>
          </TouchableOpacity>
        </View>
      </View>
      {kind === "video" && (
        <View style={[styles.qualityRow, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
          <Text style={styles.optionLabel}>{t("quality")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.qualityList}>
            {qualityOptions.map((item) => (
              <TouchableOpacity key={item} onPress={() => setQuality(item)} style={[styles.qualityChip, quality === item && styles.qualityChipSelected]}>
                <Text style={[styles.qualityText, quality === item && styles.qualityTextSelected]}>{item}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );

  const activeDownloadCount = downloads.filter((item) => item.status === "queued" || item.status === "downloading").length + (phoneProgress !== null ? 1 : 0);
  const queueCard = (
    <View style={styles.panel}>
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
          {downloads.map((item) => <View key={item.id} style={styles.transferRow}><View style={styles.transferIcon}><MaterialCommunityIcons name={item.kind === "video" ? "movie-play-outline" : item.kind === "torrent" ? "magnet" : "file-download-outline"} size={18} color={item.status === "failed" ? "#F28A83" : COLORS.cyan} /></View><View style={{ flex: 1, minWidth: 0 }}><View style={styles.transferTitleRow}><Text numberOfLines={1} style={styles.transferTitle}>{item.title}</Text><Text style={styles.transferPercent}>{item.percent.toFixed(0)}%</Text></View><Text style={styles.transferMeta}>{item.engine} · {item.speedMBps.toFixed(1)} MB/s {item.error ? `· ${item.error}` : `· ${item.status}`}</Text><View style={styles.progressTrack}><View style={[styles.progressValue, { width: `${Math.min(100, Math.max(0, item.percent))}%`, backgroundColor: item.status === "failed" ? "#F28A83" : item.status === "complete" ? COLORS.green : COLORS.cyan }]} /></View></View>{(item.status === "queued" || item.status === "downloading") && <TouchableOpacity onPress={() => void cancelComputerDownload(item.id)} style={styles.cancelButton}><MaterialCommunityIcons name="close" size={16} color={COLORS.muted} /></TouchableOpacity>}</View>)}
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
    <View style={styles.rightRail}>
      <View style={styles.relayCard}>
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
      <View style={styles.privacyCard}>
        <View style={styles.privacyGlyph}><MaterialCommunityIcons name="shield-check-outline" size={22} color={COLORS.green} /></View>
        <View style={{ flex: 1 }}><Text style={[styles.privacyTitle, { textAlign: isRTL ? "right" : "left" }]}>{t("security")}</Text><Text style={[styles.privacyBody, { textAlign: isRTL ? "right" : "left" }]}>{t("privacyNote")}</Text></View>
      </View>
      <View style={styles.enginesCard}>
        <Text style={[styles.railTitle, { textAlign: isRTL ? "right" : "left" }]}>{t("engineStatus")}</Text>
        <EngineRow icon="movie-play-outline" name={t("videoEngine")} engines="yt-dlp + FFmpeg" color={COLORS.violet} ready={!!engineStatus?.ytDlp.installed && !!engineStatus?.ffmpeg.installed} />
        <EngineRow icon="lightning-bolt-outline" name={t("fileEngine")} engines="aria2c · 16x" color={COLORS.cyan} ready={!!engineStatus?.aria2c.installed} />
        <Text style={[styles.engineFootnote, { textAlign: isRTL ? "right" : "left" }]}>{engineStatus?.ytDlp.installed && engineStatus.ffmpeg.installed && engineStatus.aria2c.installed ? t("allEnginesReady") : t("engineMissing")}</Text>
      </View>
      <View style={styles.storageCard}>
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
        <ScrollView style={styles.mainScroll} contentContainerStyle={[styles.mainContent, !isWide && { paddingHorizontal: isDesktop ? 28 : 18 }]} showsVerticalScrollIndicator={false}>
          {isDesktop && !isWide && <View style={styles.desktopNav}>{navItems.map((item) => <TouchableOpacity key={item.key} onPress={() => setActiveSection(item.key)} style={[styles.desktopNavItem, activeSection === item.key && styles.desktopNavItemSelected]}><MaterialCommunityIcons name={item.icon} size={17} color={activeSection === item.key ? COLORS.cyan : COLORS.muted} /><Text style={[styles.desktopNavText, activeSection === item.key && styles.desktopNavTextSelected]}>{item.label}</Text></TouchableOpacity>)}</View>}
          {!isDesktop && <Text style={styles.mobileGreeting}>{getSectionTitle()}</Text>}
          {hero}
          {addCard}
          {notice ? <View style={styles.noticeBar}><MaterialCommunityIcons name="information-outline" size={16} color={COLORS.cyan} /><Text style={styles.noticeText}>{notice}</Text></View> : null}
          {!isWide && <View style={styles.inlineRelay}>{aside}</View>}
          {queueCard}
          <View style={styles.bottomNote}><MaterialCommunityIcons name="lock-check" size={14} color={COLORS.green} /><Text style={styles.bottomNoteText}>{t("noCloud")}</Text><Text style={styles.bottomBuild}>NEXUS · PHASE 01</Text></View>
        </ScrollView>
        {isWide && navItems.length > 0 && aside}
      </View>
      {mobileNav}
    </View>
  );
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 1) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
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
  header: { minHeight: 78, paddingHorizontal: 24, paddingBottom: 12, flexDirection: "row", alignItems: "center", gap: 16, borderBottomWidth: 1, borderBottomColor: "#132139", backgroundColor: "#080F1D" },
  headerTitleBlock: { minWidth: 150 }, headerTitle: { color: COLORS.text, fontSize: 17, fontWeight: "700" }, headerSub: { color: COLORS.muted, fontSize: 11, marginTop: 3 },
  brandNameSmall: { color: COLORS.text, fontWeight: "800", fontSize: 14 }, brandName: { color: COLORS.text, fontWeight: "800", fontSize: 13, letterSpacing: 0.5 }, brandAccent: { color: COLORS.violet }, brandCaption: { color: COLORS.muted, fontSize: 9, marginTop: 3 },
  markWrap: { alignItems: "center", justifyContent: "center", backgroundColor: "#101E35", borderWidth: 1, borderColor: "#253A59" },
  searchShell: { flex: 1, maxWidth: 440, height: 42, marginHorizontal: 20, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "#0B1729", flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12 }, searchInput: { flex: 1, color: COLORS.text, fontSize: 13, outlineStyle: "none" as never },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8, marginLeft: "auto" }, languagePicker: { flexDirection: "row", alignItems: "center", backgroundColor: "#0C1728", borderRadius: 11, padding: 3, borderWidth: 1, borderColor: COLORS.border }, languageItem: { minWidth: 30, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 8, paddingHorizontal: 5 }, languageItemSelected: { backgroundColor: "#213450" }, languageText: { fontSize: 10, color: COLORS.muted, fontWeight: "700" }, languageTextSelected: { color: COLORS.text },
  iconButton: { height: 38, width: 38, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "#0C1728", borderWidth: 1, borderColor: COLORS.border }, iconButtonActive: { borderColor: "#264261" },
  pairButton: { height: 40, borderRadius: 11, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: COLORS.cyan }, pairButtonText: { color: "#071321", fontSize: 12, fontWeight: "800" },
  workspace: { flex: 1, flexDirection: "row", overflow: "hidden" },
  sidebar: { width: 208, borderRightWidth: 1, borderRightColor: "#132139", paddingHorizontal: 15, paddingVertical: 19, backgroundColor: "#080F1D" }, sidebarCompact: { width: "100%" }, brandRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 7, marginBottom: 31 }, sideLabel: { color: "#586A83", fontSize: 9, fontWeight: "800", letterSpacing: 1.3, paddingHorizontal: 10, marginBottom: 10 },
  navItem: { minHeight: 43, borderRadius: 11, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 5 }, navItemSelected: { backgroundColor: "#121F36", borderWidth: 1, borderColor: "#263C60" }, navLabel: { flex: 1, color: "#A3B1C6", fontSize: 12, fontWeight: "600" }, navLabelSelected: { color: COLORS.text }, navDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.green },
  sidebarBottom: { marginTop: "auto", borderRadius: 15, padding: 14, backgroundColor: "#0D1A2D", borderWidth: 1, borderColor: COLORS.border }, shieldIcon: { height: 32, width: 32, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "#123329", marginBottom: 10 }, safeTitle: { color: COLORS.text, fontSize: 12, fontWeight: "700" }, safeText: { color: COLORS.muted, fontSize: 10, lineHeight: 15, marginTop: 5 }, localPill: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.border }, onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.green }, localPillText: { color: COLORS.green, fontSize: 9, fontWeight: "700" },
  mainScroll: { flex: 1 }, mainContent: { padding: 22, gap: 16, paddingBottom: 30 }, desktopNav: { flexDirection: "row", gap: 6, flexWrap: "wrap" }, desktopNavItem: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 10, backgroundColor: "#0A1525" }, desktopNavItemSelected: { backgroundColor: "#13233B" }, desktopNavText: { color: COLORS.muted, fontSize: 11 }, desktopNavTextSelected: { color: COLORS.text }, mobileGreeting: { color: COLORS.text, fontSize: 23, fontWeight: "800", marginTop: 4 },
  heroCard: { minHeight: 167, overflow: "hidden", borderRadius: 18, borderWidth: 1, borderColor: "#233A64", backgroundColor: "#0D1D38", padding: 21, position: "relative", justifyContent: "center" }, heroGlow: { position: "absolute", right: -50, top: -140, width: 340, height: 300, borderRadius: 180, backgroundColor: "#211A55", opacity: 0.44 }, heroContent: { zIndex: 1, maxWidth: "74%" }, heroEyebrow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }, heroEyebrowDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.cyan }, eyebrowText: { color: "#8197BA", fontSize: 9, fontWeight: "800", letterSpacing: 1.3 }, heroTitle: { color: COLORS.text, fontSize: 24, fontWeight: "800", letterSpacing: -0.4 }, heroSubtitle: { color: "#A5B5CF", fontSize: 12, lineHeight: 19, marginTop: 7 }, heroGraphic: { position: "absolute", right: 30, top: 12, width: 154, height: 140, alignItems: "center", justifyContent: "center" }, orbitOuter: { position: "absolute", width: 128, height: 128, borderRadius: 64, borderWidth: 1, borderColor: "#45618B", opacity: 0.45 }, orbitInner: { position: "absolute", width: 95, height: 95, borderRadius: 48, borderWidth: 1, borderColor: "#5362A0", opacity: 0.5 }, heroCore: { width: 75, height: 75, alignItems: "center", justifyContent: "center", borderRadius: 24, backgroundColor: "#111F3A", borderWidth: 1, borderColor: "#344E73" }, orbitPoint: { position: "absolute", width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.cyan, shadowColor: COLORS.cyan, shadowOpacity: 0.7, shadowRadius: 9 }, heroFoot: { position: "absolute", left: 20, bottom: 13, flexDirection: "row", alignItems: "center", gap: 7 }, heroFootText: { color: "#9EB0C8", fontSize: 9 }, dotSep: { width: 3, height: 3, borderRadius: 2, backgroundColor: "#536580", marginHorizontal: 2 },
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
