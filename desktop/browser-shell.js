const copy = {
  ar: { media: "الوسائط", support: "الدعم", local: "محلي", title: "وسائط مكتشفة", empty: "لم تُكتشف وسائط بعد. شغّل فيديو أو صوتًا في الصفحة.", best: "أفضل جودة", inspect: "كل الجودات", mp3: "صوت MP3", m4a: "صوت M4A", direct: "مباشر · aria2", working: "جارٍ الفحص…", queued: "أُرسل التنزيل إلى Nexus.", noFormats: "لم يعثر yt-dlp على جودات فيديو لهذه الصفحة.", failure: "تعذر إكمال الطلب.", ready: "جاهز", localSession: "جلسة محلية · بلا وسيط سحابي", address: "عنوان أو بحث…", detected: "عناصر الوسائط", close: "إغلاق" },
  en: { media: "Media", support: "Support", local: "Local", title: "Detected media", empty: "No media detected yet. Play video or audio on the page.", best: "Best quality", inspect: "All qualities", mp3: "Audio MP3", m4a: "Audio M4A", direct: "Direct · aria2", working: "Inspecting…", queued: "Download sent to Nexus.", noFormats: "yt-dlp found no video formats for this page.", failure: "Could not complete the request.", ready: "Ready", localSession: "Local session · No cloud relay", address: "Address or search…", detected: "media item(s)", close: "Close" },
  fr: { media: "Médias", support: "Aide", local: "Local", title: "Médias détectés", empty: "Aucun média détecté. Lancez une vidéo ou un audio sur la page.", best: "Meilleure qualité", inspect: "Toutes qualités", mp3: "Audio MP3", m4a: "Audio M4A", direct: "Direct · aria2", working: "Analyse…", queued: "Téléchargement envoyé à Nexus.", noFormats: "yt-dlp n’a trouvé aucun format vidéo.", failure: "Impossible de terminer la demande.", ready: "Prêt", localSession: "Session locale · Sans relais cloud", address: "Adresse ou recherche…", detected: "média(s)", close: "Fermer" },
};
let language = "ar";
let candidates = [];
let panelOpen = false;
const $ = (id) => document.getElementById(id);
const address = $("address");
const mediaList = $("media-list");
const mediaPanel = $("media-panel");
const candidateCount = $("candidate-count");

function text(key) { return copy[language]?.[key] || copy.en[key] || key; }
function setLanguage(next) {
  language = next === "ar" || next === "fr" ? next : "en";
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  $("media-label").textContent = text("media");
  $("support-label").textContent = text("support");
  $("status-label").textContent = text("local");
  $("panel-title").textContent = text("title");
  $("footer-local").textContent = text("localSession");
  address.placeholder = text("address");
  renderCandidates();
}
function showPageState(state) {
  if (typeof state.url === "string" && !address.matches(":focus")) address.value = state.url;
  $("footer-domain").textContent = state.title || state.url || text("ready");
}
function showEmpty() {
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = text("empty");
  mediaList.append(empty);
}
function makeButton(label, action, cls = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `action-button ${cls}`;
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}
function renderCandidates() {
  candidateCount.textContent = String(candidates.length);
  $("panel-subtitle").textContent = `${candidates.length} ${text("detected")}`;
  mediaList.replaceChildren();
  if (!candidates.length) { showEmpty(); return; }
  for (const item of candidates) {
    const card = document.createElement("article");
    card.className = "media-card";
    const title = document.createElement("div");
    title.className = "media-title";
    title.textContent = item.title || item.url;
    const meta = document.createElement("div");
    meta.className = "media-meta";
    meta.textContent = `${item.kind.toUpperCase()} · ${item.mime || "media link"}`;
    const actions = document.createElement("div");
    actions.className = "media-actions";
    const status = document.createElement("div");
    status.className = "card-status";
    const qualities = document.createElement("div");
    qualities.className = "quality-list";
    card.append(title, meta, actions, qualities, status);

    actions.append(
      makeButton(text("best"), () => void sendDownload(item, { kind: "video", quality: "auto" }, status), "primary"),
      makeButton(text("inspect"), () => void inspect(item, qualities, status)),
      makeButton(text("mp3"), () => void sendDownload(item, { kind: "audio", audioFormat: "mp3" }, status), "audio"),
      makeButton(text("m4a"), () => void sendDownload(item, { kind: "audio", audioFormat: "m4a" }, status), "audio"),
    );
    if (item.direct) actions.append(makeButton(text("direct"), () => void sendDownload(item, { kind: "file", target: "computer" }, status), "direct"));
    mediaList.append(card);
  }
}
async function inspect(item, target, status) {
  status.textContent = text("working");
  target.replaceChildren();
  try {
    const result = await window.nexusBrowser.inspectMedia(item.id);
    if (!Array.isArray(result.formats) || !result.formats.length) { status.textContent = text("noFormats"); return; }
    for (const format of result.formats) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "quality-button";
      button.textContent = `${format.quality} · ${format.extension}`;
      button.addEventListener("click", () => void sendDownload(item, { kind: "video", quality: format.quality }, status));
      target.append(button);
    }
    status.textContent = result.title || "";
  } catch (error) { status.textContent = error?.message || text("failure"); }
}
async function sendDownload(item, options, status) {
  status.textContent = text("working");
  try {
    await window.nexusBrowser.downloadMedia({ id: item.id, ...options });
    status.textContent = text("queued");
  } catch (error) { status.textContent = error?.message || text("failure"); }
}
function setPanel(open) {
  panelOpen = Boolean(open);
  mediaPanel.classList.toggle("open", panelOpen);
  mediaPanel.setAttribute("aria-hidden", String(!panelOpen));
  $("media-toggle").setAttribute("aria-expanded", String(panelOpen));
  window.nexusBrowser.panelState(panelOpen);
}

$("address-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void window.nexusBrowser.navigate(address.value);
});
$("back").addEventListener("click", () => void window.nexusBrowser.goBack());
$("forward").addEventListener("click", () => void window.nexusBrowser.goForward());
$("reload").addEventListener("click", () => void window.nexusBrowser.reload());
$("media-toggle").addEventListener("click", () => setPanel(!panelOpen));
$("close-panel").addEventListener("click", () => setPanel(false));
$("support").addEventListener("click", () => void window.nexusBrowser.openSupport());
window.nexusBrowser.onMediaCandidates((payload) => { candidates = Array.isArray(payload.items) ? payload.items : []; renderCandidates(); });
window.nexusBrowser.onPageState(showPageState);
window.nexusBrowser.onLanguage(setLanguage);
setLanguage("ar");
showEmpty();
