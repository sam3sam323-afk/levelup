import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useNexusI18n } from "@/lib/i18n";
import { pairWithRelay, parsePairPayload } from "@/lib/relay-client";

const C = { bg: "#070D19", panel: "#0C1728", panel2: "#101F35", border: "#1B2B45", text: "#F3F6FF", muted: "#8293AE", cyan: "#21C8F3", violet: "#8669FF", green: "#49D6A1", red: "#F19A98" };

export default function PairScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isRTL, t } = useNexusI18n();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<"scan" | "manual">("scan");
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [working, setWorking] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState("");

  const connect = async (relayAddress = address, pairingCode = code) => {
    setWorking(true); setError("");
    try {
      await pairWithRelay(relayAddress, pairingCode);
      Alert.alert(t("paired"));
      router.replace("/(tabs)");
    } catch {
      setError(t("invalidPair"));
    } finally {
      setWorking(false);
    }
  };

  const onBarcodeScanned = ({ data }: { data: string }) => {
    if (scanned || working) return;
    const payload = parsePairPayload(data);
    if (!payload) { setScanned(true); setError(t("invalidPair")); return; }
    setScanned(true);
    setAddress(payload.relay); setCode(payload.code);
    void connect(payload.relay, payload.code);
  };

  return (
    <View style={[styles.screen, { paddingTop: Math.max(insets.top, 14), paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={[styles.topBar, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name={isRTL ? "arrow-right" : "arrow-left"} size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}><Text style={[styles.kicker, { textAlign: isRTL ? "right" : "left" }]}>LEVEL UP NEXUS</Text><Text style={[styles.topTitle, { textAlign: isRTL ? "right" : "left" }]}>{t("pairPhone")}</Text></View>
        <View style={styles.localBadge}><View style={styles.greenDot} /><Text style={styles.localBadgeText}>{t("localOnly")}</Text></View>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.intro}>
            <View style={styles.iconHalo}><MaterialCommunityIcons name="cellphone-link" size={35} color={C.cyan} /></View>
            <Text style={styles.title}>{t("pairTitle")}</Text>
            <Text style={[styles.subtitle, { textAlign: "center" }]}>{t("pairSubtitle")}</Text>
          </View>
          <View style={styles.tabSwitch}>
            <TouchableOpacity onPress={() => { setMode("scan"); setError(""); }} style={[styles.switchTab, mode === "scan" && styles.switchTabActive]}><MaterialCommunityIcons name="qrcode-scan" size={16} color={mode === "scan" ? C.cyan : C.muted} /><Text style={[styles.switchText, mode === "scan" && styles.switchTextActive]}>{t("scanQR")}</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => { setMode("manual"); setError(""); }} style={[styles.switchTab, mode === "manual" && styles.switchTabActive]}><MaterialCommunityIcons name="form-textbox" size={16} color={mode === "manual" ? C.cyan : C.muted} /><Text style={[styles.switchText, mode === "manual" && styles.switchTextActive]}>{t("manual")}</Text></TouchableOpacity>
          </View>
          {mode === "scan" ? (
            <View style={styles.scannerPanel}>
              {permission?.granted ? (
                <View style={styles.cameraFrame}>
                  <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={onBarcodeScanned} />
                  <View pointerEvents="none" style={styles.scanOverlay}><View style={styles.scanCornerTL} /><View style={styles.scanCornerTR} /><View style={styles.scanCornerBL} /><View style={styles.scanCornerBR} /><View style={styles.scanLine} /></View>
                </View>
              ) : (
                <TouchableOpacity onPress={() => void requestPermission()} style={styles.cameraPermission}>
                  <MaterialCommunityIcons name="camera-outline" size={31} color={C.cyan} />
                  <Text style={styles.permissionText}>{t("cameraDenied")}</Text>
                  <View style={styles.permissionAction}><Text style={styles.permissionActionText}>{t("scanQR")}</Text></View>
                </TouchableOpacity>
              )}
              <Text style={styles.scanHint}>{t("scanNow")}</Text>
              <TouchableOpacity onPress={() => { setScanned(false); setError(""); }} style={styles.rescanButton}><MaterialCommunityIcons name="refresh" size={15} color={C.cyan} /><Text style={styles.rescanText}>{t("refresh")}</Text></TouchableOpacity>
            </View>
          ) : (
            <View style={styles.formCard}>
              <Text style={[styles.fieldLabel, { textAlign: isRTL ? "right" : "left" }]}>{t("address")}</Text>
              <TextInput value={address} onChangeText={setAddress} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="http://192.168.1.24:8787" placeholderTextColor="#60718C" style={[styles.input, { textAlign: isRTL ? "right" : "left" }]} />
              <Text style={[styles.fieldLabel, { textAlign: isRTL ? "right" : "left", marginTop: 14 }]}>{t("code")}</Text>
              <TextInput value={code} onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" maxLength={6} placeholder="••••••" placeholderTextColor="#60718C" style={styles.codeInput} />
              <TouchableOpacity disabled={working || code.length !== 6 || !address} onPress={() => void connect()} style={[styles.connectButton, (working || code.length !== 6 || !address) && styles.connectButtonDisabled]}>
                <MaterialCommunityIcons name="lan-connect" size={17} color="#071321" /><Text style={styles.connectButtonText}>{working ? t("pairing") : t("connect")}</Text>
              </TouchableOpacity>
            </View>
          )}
          {error ? <View style={styles.errorBox}><MaterialCommunityIcons name="alert-circle-outline" size={17} color={C.red} /><Text style={styles.errorText}>{error}</Text></View> : null}
          <View style={styles.privacyNote}><MaterialCommunityIcons name="shield-check-outline" size={18} color={C.green} /><Text style={styles.privacyText}>{t("privacyNote")}</Text></View>
          <Text style={styles.noCloud}>{t("noCloud")}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg }, topBar: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: C.border }, backButton: { width: 39, height: 39, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: C.panel, borderWidth: 1, borderColor: C.border }, kicker: { color: C.cyan, fontSize: 9, fontWeight: "800", letterSpacing: 1.3 }, topTitle: { color: C.text, fontSize: 14, fontWeight: "700", marginTop: 2 }, localBadge: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 9, backgroundColor: "#10251F", borderWidth: 1, borderColor: "#1B3832" }, greenDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green }, localBadgeText: { color: C.green, fontSize: 9, fontWeight: "700" },
  content: { paddingHorizontal: 22, paddingTop: 25, paddingBottom: 30, alignItems: "center" }, intro: { width: "100%", maxWidth: 490, alignItems: "center" }, iconHalo: { width: 72, height: 72, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "#10283B", borderWidth: 1, borderColor: "#1E4159", marginBottom: 15 }, title: { color: C.text, fontSize: 23, fontWeight: "800", textAlign: "center" }, subtitle: { color: C.muted, fontSize: 12, lineHeight: 19, marginTop: 8, maxWidth: 420 },
  tabSwitch: { width: "100%", maxWidth: 450, flexDirection: "row", padding: 4, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.panel, marginTop: 24, marginBottom: 14 }, switchTab: { flex: 1, minHeight: 39, borderRadius: 9, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, switchTabActive: { backgroundColor: "#142943", borderWidth: 1, borderColor: "#28445F" }, switchText: { color: C.muted, fontSize: 11, fontWeight: "600" }, switchTextActive: { color: C.text },
  scannerPanel: { width: "100%", maxWidth: 450, padding: 13, alignItems: "center", borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.panel }, cameraFrame: { width: "100%", maxWidth: 365, height: 250, overflow: "hidden", borderRadius: 13, backgroundColor: "#03070D", position: "relative" }, scanOverlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" }, scanCornerTL: { position: "absolute", top: 23, left: 23, height: 31, width: 31, borderTopWidth: 3, borderLeftWidth: 3, borderColor: C.cyan, borderTopLeftRadius: 8 }, scanCornerTR: { position: "absolute", top: 23, right: 23, height: 31, width: 31, borderTopWidth: 3, borderRightWidth: 3, borderColor: C.cyan, borderTopRightRadius: 8 }, scanCornerBL: { position: "absolute", bottom: 23, left: 23, height: 31, width: 31, borderBottomWidth: 3, borderLeftWidth: 3, borderColor: C.cyan, borderBottomLeftRadius: 8 }, scanCornerBR: { position: "absolute", bottom: 23, right: 23, height: 31, width: 31, borderBottomWidth: 3, borderRightWidth: 3, borderColor: C.cyan, borderBottomRightRadius: 8 }, scanLine: { width: "72%", height: 1, backgroundColor: C.cyan, shadowColor: C.cyan, shadowOpacity: 0.8, shadowRadius: 8 }, cameraPermission: { width: "100%", maxWidth: 365, height: 250, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: "#0A1423", padding: 30 }, permissionText: { color: C.muted, fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 13 }, permissionAction: { paddingVertical: 8, paddingHorizontal: 15, borderRadius: 9, backgroundColor: "#142943", marginTop: 12 }, permissionActionText: { color: C.cyan, fontWeight: "700", fontSize: 10 }, scanHint: { color: C.muted, fontSize: 10, marginTop: 12, textAlign: "center" }, rescanButton: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 11, padding: 8 }, rescanText: { color: C.cyan, fontSize: 10, fontWeight: "700" },
  formCard: { width: "100%", maxWidth: 450, padding: 18, borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.panel }, fieldLabel: { color: "#B7C4D8", fontSize: 10, fontWeight: "700", marginBottom: 7 }, input: { height: 46, borderRadius: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: "#253954", backgroundColor: "#081321", color: C.text, fontSize: 12 }, codeInput: { height: 51, textAlign: "center", letterSpacing: 9, borderRadius: 10, borderWidth: 1, borderColor: "#253954", backgroundColor: "#081321", color: C.text, fontSize: 20, fontWeight: "800", marginTop: 1 }, connectButton: { height: 45, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.cyan, marginTop: 17 }, connectButtonDisabled: { opacity: 0.45 }, connectButtonText: { color: "#071321", fontSize: 12, fontWeight: "800" },
  errorBox: { width: "100%", maxWidth: 450, flexDirection: "row", alignItems: "center", gap: 8, padding: 11, borderRadius: 10, backgroundColor: "#2A191C", borderWidth: 1, borderColor: "#5A2D31", marginTop: 12 }, errorText: { color: C.red, fontSize: 10, flex: 1 }, privacyNote: { maxWidth: 450, flexDirection: "row", alignItems: "center", gap: 9, marginTop: 17, padding: 12, borderRadius: 11, backgroundColor: "#0D1D1D", borderWidth: 1, borderColor: "#1B3832" }, privacyText: { color: "#AAC2B8", fontSize: 10, lineHeight: 15, flex: 1 }, noCloud: { color: C.muted, fontSize: 9, marginTop: 12 }
});
