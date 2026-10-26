(() => {
  const sessionToken = __NEXUS_SESSION_TOKEN__;
  const getInvoke = () => window.__TAURI__?.core?.invoke;
  if (window.top !== window || !/^https?:$/.test(window.location.protocol) || window.__NEXUS_BROWSER_INSTALLED__) return;
  window.__NEXUS_BROWSER_INSTALLED__ = true;
  const supportedDomains = ["youtube.com", "youtu.be", "facebook.com", "fb.watch", "vimeo.com", "tiktok.com", "instagram.com", "dailymotion.com", "twitter.com", "x.com", "twitch.tv"];
  const mediaCaptureAllowed = () => supportedDomains.some((domain) => location.hostname === domain || location.hostname.endsWith(`.${domain}`));

  const isArabic = () => /^ar/i.test(document.documentElement?.lang || navigator.language || "");
  const words = () => isArabic()
    ? { address: "ابحث أو أدخل رابطًا", back: "رجوع", forward: "تقدّم", refresh: "تحديث", mute: "كتم الصوت", unmute: "إلغاء كتم الصوت", discovered: "فاحص الوسائط · عرض الجودات", choose: "الجودات المتاحة فعليًا", loadingFormats: "جارٍ فحص الصيغ من yt-dlp…", noFormats: "لم يعثر yt-dlp على صيغ قابلة للتنزيل", working: "جارٍ بدء التنزيل…", queued: "أُضيف التنزيل إلى الطابور", unavailable: "تعذّر بدء التنزيل", desktop: "ميزة التنزيل تتطلب تطبيق سطح المكتب", dark: "الوضع الداكن مفعل" }
    : { address: "Search or enter a URL", back: "Back", forward: "Forward", refresh: "Refresh", mute: "Mute", unmute: "Unmute", discovered: "NEXUS media · show formats", choose: "Available formats", loadingFormats: "Inspecting formats with yt-dlp…", noFormats: "yt-dlp found no downloadable formats", working: "Starting download…", queued: "Download added to queue", unavailable: "Could not start download", desktop: "Downloads require the desktop app", dark: "Dark mode is on" };
  const I = {
    back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
    forward: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9a7 7 0 0 1 12-2L20 12M4 12l2.5 5a7 7 0 0 0 12-2"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6m0-6-5 6"/></svg>',
    sound: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7m3-10a9 9 0 0 1 0 13"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.1 0l3-3A5 5 0 0 0 13 2.9l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.1 0l-3 3A5 5 0 0 0 11 21.1l1.7-1.7"/></svg>'
  };
  const styleText = `:host{all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;color:#eaf0ff;font:13px/1.4 Inter,Segoe UI,Arial,sans-serif;color-scheme:dark}*{box-sizing:border-box}.nexus-top{position:fixed;top:12px;left:50%;transform:translateX(-50%);width:min(980px,calc(100vw - 28px));pointer-events:auto;border:1px solid rgba(125,170,255,.2);border-radius:16px;background:rgba(8,12,27,.73);box-shadow:0 14px 42px rgba(0,0,0,.32),inset 0 1px rgba(255,255,255,.08);backdrop-filter:blur(22px) saturate(155%);-webkit-backdrop-filter:blur(22px) saturate(155%);overflow:hidden}.nexus-toolbar{height:54px;display:flex;align-items:center;gap:7px;padding:7px 10px}.nexus-brand{display:flex;align-items:center;gap:7px;padding:0 8px;color:#cdd7f4;font-size:10px;font-weight:800;letter-spacing:.13em;white-space:nowrap}.nexus-mark{width:23px;height:23px;display:grid;place-items:center;border-radius:8px;background:linear-gradient(145deg,#071025,#171d45);border:1px solid rgba(62,220,255,.24);color:#5ee8ff;box-shadow:0 0 16px rgba(34,192,255,.13)}.nexus-mark svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2}.nexus-btn{width:32px;height:32px;flex:0 0 auto;display:grid;place-items:center;border:1px solid transparent;border-radius:9px;background:transparent;color:#aab6d4;cursor:pointer;transition:background .18s,border-color .18s,color .18s,transform .18s}.nexus-btn:hover{background:rgba(104,128,255,.14);border-color:rgba(126,151,255,.2);color:#eff5ff}.nexus-btn:active{transform:scale(.94)}.nexus-btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.nexus-address{height:36px;min-width:0;flex:1;display:flex;align-items:center;gap:8px;padding:0 11px;border:1px solid rgba(130,150,207,.15);border-radius:11px;background:rgba(2,5,15,.4);transition:border-color .2s,box-shadow .2s}.nexus-address:focus-within{border-color:rgba(55,220,255,.58);box-shadow:0 0 0 3px rgba(40,199,255,.09),0 0 20px rgba(40,199,255,.12)}.nexus-address svg{width:15px;height:15px;flex:0 0 auto;stroke:#5bdfff;fill:none;stroke-width:1.8}.nexus-url{width:100%;min-width:0;border:0;outline:0;background:transparent;color:#eaf0ff;font:12px/1.2 Inter,Segoe UI,Arial,sans-serif;direction:ltr;text-align:left}.nexus-url::selection{background:rgba(42,197,255,.34)}.nexus-url::placeholder{color:#8490b0}.nexus-progress{height:2px;width:100%;background:rgba(255,255,255,.045)}.nexus-progress i{display:block;width:14%;height:100%;background:linear-gradient(90deg,#38def7,#5a9dff,#bd62ff);box-shadow:0 0 12px #44cfff;transition:width .35s ease,opacity .6s}.nexus-progress.loading i{width:76%;animation:glide 1.15s ease-in-out infinite alternate}.nexus-progress.done i{width:100%;opacity:.5}.nexus-dark{padding:0 7px;color:#71809f;font-size:9px;white-space:nowrap}.nexus-media{position:fixed;left:50%;bottom:22px;transform:translate(-50%,16px);pointer-events:auto;opacity:0;visibility:hidden;transition:opacity .2s,transform .2s,visibility .2s}.nexus-media.visible{opacity:1;visibility:visible;transform:translate(-50%,0)}.nexus-pill{display:flex;align-items:center;gap:9px;min-height:44px;padding:0 16px;border:1px solid rgba(50,220,255,.42);border-radius:999px;background:linear-gradient(110deg,rgba(7,24,40,.92),rgba(21,20,55,.94));color:#eafaff;box-shadow:0 9px 34px rgba(0,0,0,.35),0 0 22px rgba(29,203,255,.19),inset 0 1px rgba(255,255,255,.1);backdrop-filter:blur(18px);font:700 12px/1.2 Inter,Segoe UI,Arial,sans-serif;cursor:pointer;white-space:nowrap}.nexus-pill:hover{border-color:#49e3ff;box-shadow:0 10px 38px rgba(0,0,0,.38),0 0 30px rgba(29,203,255,.32)}.nexus-pill-icon{font-size:17px}.nexus-dot{width:7px;height:7px;border-radius:50%;background:#49e3ff;box-shadow:0 0 11px #49e3ff;animation:pulse 1.5s ease-in-out infinite}.nexus-menu{position:absolute;bottom:54px;left:50%;width:min(320px,calc(100vw - 24px));transform:translateX(-50%) translateY(8px);padding:12px;border:1px solid rgba(126,153,255,.23);border-radius:15px;background:rgba(9,13,30,.95);box-shadow:0 18px 55px rgba(0,0,0,.45),0 0 25px rgba(55,175,255,.1);backdrop-filter:blur(20px);opacity:0;visibility:hidden;transition:.18s}.nexus-menu.open{opacity:1;visibility:visible;transform:translateX(-50%) translateY(0)}.nexus-menu-title{margin:1px 4px 9px;color:#98a8cf;font-size:10px;font-weight:800;letter-spacing:.11em;text-transform:uppercase}.nexus-quality{width:100%;display:flex;justify-content:space-between;align-items:center;gap:12px;margin:4px 0;padding:10px 11px;border:1px solid rgba(130,150,207,.1);border-radius:10px;background:rgba(255,255,255,.035);color:#dfe8ff;text-align:left;font:600 12px Inter,Segoe UI,Arial,sans-serif;cursor:pointer}.nexus-quality:hover{border-color:rgba(55,220,255,.35);background:rgba(40,190,255,.1)}.nexus-quality small{color:#8fa1c6;font-size:10px}.nexus-status{max-width:285px;margin:8px 4px 2px;color:#84e8f5;font-size:11px;overflow-wrap:anywhere}.nexus-status.error{color:#ff8fa8}.nexus-host[hidden]{display:none}@keyframes glide{from{transform:translateX(0);opacity:.65}to{transform:translateX(24%);opacity:1}}@keyframes pulse{50%{opacity:.45;transform:scale(.83)}}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:650px){.nexus-top{top:7px;width:calc(100vw - 14px);border-radius:13px}.nexus-toolbar{height:48px;gap:3px;padding:6px}.nexus-brand{gap:5px;padding:0 3px;font-size:8px}.nexus-mark{width:21px;height:21px}.nexus-btn{width:28px;height:30px}.nexus-dark{display:none}.nexus-media{bottom:12px}.nexus-pill{min-height:42px;padding:0 13px;font-size:11px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}`;

  let host;
  let root;
  let pill;
  let menu;
  let status;
  let urlInput;
  let formatList;
  let videoFound = false;
  let muted = false;
  let loadTimer;
  let cachedFormatsUrl = "";
  let formatsLoading = false;
  let lastSavedUrl = "";
  let saveTimer;

  function install() {
    if (!document.documentElement || document.getElementById("nexus-browser-sniffer")) return;
    const darkStyle = document.createElement("style");
    darkStyle.dataset.nexusDark = "true";
    darkStyle.textContent = ":root,html,body{color-scheme:dark!important}";
    (document.head || document.documentElement).appendChild(darkStyle);
    document.documentElement.style.colorScheme = "dark";

    host = document.createElement("div");
    host.id = "nexus-browser-sniffer";
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
    root = host.attachShadow({ mode: "closed" });
    root.innerHTML += `
      <div class="nexus-top" role="region" aria-label="LEVEL UP NEXUS browser controls">
        <div class="nexus-toolbar">
          <div class="nexus-brand"><span class="nexus-mark">N</span><span>NEXUS</span></div>
          <button class="nexus-btn" data-action="back" title="${words().back}" aria-label="${words().back}">${I.back}</button>
          <button class="nexus-btn" data-action="forward" title="${words().forward}" aria-label="${words().forward}">${I.forward}</button>
          <button class="nexus-btn" data-action="refresh" title="${words().refresh}" aria-label="${words().refresh}">${I.refresh}</button>
          <div class="nexus-address">${I.link}<input class="nexus-url" spellcheck="false" autocomplete="off" aria-label="${words().address}" placeholder="${words().address}"></div>
          <button class="nexus-btn" data-action="mute" title="${words().mute}" aria-label="${words().mute}">${I.mute}</button>
          <span class="nexus-dark">${words().dark}</span>
        </div>
        <div class="nexus-progress loading"><i></i></div>
      </div>
      <div class="nexus-media">
        <div class="nexus-menu" role="dialog" aria-label="${words().choose}">
          <div class="nexus-menu-title">${words().choose}</div>
          <div class="nexus-format-list"></div>
          <div class="nexus-status" role="status"></div>
        </div>
        <button class="nexus-pill" aria-haspopup="dialog" aria-expanded="false"><span class="nexus-dot"></span><span class="nexus-pill-icon">📥</span><span>${words().discovered}</span></button>
      </div>`;
    const style = document.createElement("style");
    style.textContent = styleText;
    root.prepend(style);
    document.documentElement.appendChild(host);

    pill = root.querySelector(".nexus-pill");
    menu = root.querySelector(".nexus-menu");
    status = root.querySelector(".nexus-status");
    formatList = root.querySelector(".nexus-format-list");
    urlInput = root.querySelector(".nexus-url");
    menu.dir = isArabic() ? "rtl" : "ltr";
    if (mediaCaptureAllowed()) root.querySelector(".nexus-media")?.classList.add("visible");
    const progress = root.querySelector(".nexus-progress");
    const muteButton = root.querySelector('[data-action="mute"]');
    urlInput.value = location.href;
    loadTimer = setTimeout(() => progress?.classList.remove("loading"), 1300);
    const finishLoad = () => {
      progress?.classList.remove("loading");
      progress?.classList.add("done");
      setTimeout(() => progress?.classList.remove("done"), 1100);
      urlInput.value = location.href;
    };
    window.addEventListener("load", finishLoad, { once: true });
    document.addEventListener("readystatechange", () => { if (document.readyState === "complete") finishLoad(); });

    root.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.isTrusted) return;
      const action = target.dataset.action;
      if (action === "back") history.back();
      if (action === "forward") history.forward();
      if (action === "refresh") {
        target.style.animation = "spin .45s linear";
        setTimeout(() => { target.style.animation = ""; }, 470);
        location.reload();
      }
      if (action === "mute") {
        muted = !muted;
        document.querySelectorAll("video,audio").forEach((media) => { media.muted = muted; });
        target.innerHTML = muted ? I.sound : I.mute;
        target.title = muted ? words().unmute : words().mute;
        target.setAttribute("aria-label", target.title);
      }
      if (target === pill) {
        const open = !menu.classList.contains("open");
        menu.classList.toggle("open", open);
        pill.setAttribute("aria-expanded", String(open));
        status.textContent = "";
        status.classList.remove("error");
        if (open) void loadVideoFormats();
      }
      if (target.dataset.formatId) void requestDownload(target);
    });

    urlInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || !event.isTrusted) return;
      event.preventDefault();
      let next = urlInput.value.trim();
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(next)) next = `https://${next}`;
      try {
        const parsed = new URL(next);
        if (!/^https?:$/.test(parsed.protocol)) throw new Error("invalid protocol");
        location.href = parsed.href;
      } catch {
        urlInput.setCustomValidity("Enter a valid http(s) URL");
        urlInput.reportValidity();
      }
    });

    let observedUrl = location.href;
    const scheduleSaveTab = () => {
      const invoke = getInvoke();
      if (!invoke) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const stamp = `${location.href}\n${document.title}`;
        if (stamp === lastSavedUrl) return;
        void invoke("browser_save_tab", { url: location.href, title: document.title.slice(0, 512), sessionToken })
          .then(() => { lastSavedUrl = stamp; }).catch(() => {});
      }, 650);
    };
    const updateAddress = () => {
      const nextUrl = location.href;
      if (urlInput && document.activeElement !== urlInput) urlInput.value = nextUrl;
      if (nextUrl !== observedUrl) {
        observedUrl = nextUrl;
        cachedFormatsUrl = "";
        formatList?.replaceChildren();
        menu?.classList.remove("open");
        root.querySelector(".nexus-media")?.classList.toggle("visible", mediaCaptureAllowed());
        videoFound = false;
      }
      scheduleSaveTab();
    };
    window.addEventListener("popstate", updateAddress);
    window.addEventListener("hashchange", updateAddress);
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);
    history.pushState = (...args) => { originalPushState(...args); updateAddress(); };
    history.replaceState = (...args) => { originalReplaceState(...args); updateAddress(); };
    const titleObserver = new MutationObserver(scheduleSaveTab);
    const observeTitle = () => { const title = document.querySelector("title"); if (title) titleObserver.observe(title, { childList: true, characterData: true, subtree: true }); };
    observeTitle();
    document.addEventListener("DOMContentLoaded", observeTitle, { once: true });
    scheduleSaveTab();

    const mediaRoots = new Set([document]);
    let mediaScanQueued = false;
    const activateVideo = (video) => {
      if (!(video instanceof HTMLVideoElement)) return;
      const hasMediaSource = Boolean(video.currentSrc || video.src || video.querySelector("source[src]"));
      const active = video.readyState >= 1 && hasMediaSource;
      if (active && !videoFound && mediaCaptureAllowed()) {
        videoFound = true;
        root.querySelector(".nexus-media")?.classList.add("visible");
      }
      if (!video.paused && !video.muted) muted = false;
    };
    const scanVideos = () => {
      mediaScanQueued = false;
      mediaRoots.forEach((scope) => scope.querySelectorAll?.("video").forEach(activateVideo));
    };
    const scheduleMediaScan = () => {
      if (mediaScanQueued) return;
      mediaScanQueued = true;
      requestAnimationFrame(scanVideos);
    };
    const observer = new MutationObserver(scheduleMediaScan);
    const observeMediaRoot = (scope) => {
      if (mediaRoots.has(scope)) return;
      mediaRoots.add(scope);
      observer.observe(scope, { childList: true, subtree: true });
      ["play", "playing", "loadeddata"].forEach((name) => scope.addEventListener(name, (event) => activateVideo(event.target), true));
      scheduleMediaScan();
    };
    ["play", "playing", "loadeddata"].forEach((name) => document.addEventListener(name, (event) => activateVideo(event.target), true));
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const attachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      const shadowRoot = attachShadow.call(this, init);
      observeMediaRoot(shadowRoot);
      return shadowRoot;
    };
    window.setInterval(scheduleMediaScan, 1800);
    scanVideos();
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
  }

  async function loadVideoFormats() {
    if (!status || !formatList) return;
    const invoke = getInvoke();
    if (!invoke) {
      status.textContent = words().desktop;
      status.classList.add("error");
      return;
    }
    const requestedUrl = location.href;
    if (cachedFormatsUrl === requestedUrl && formatList.childElementCount > 0) return;
    if (formatsLoading) return;
    formatsLoading = true;
    formatList.replaceChildren();
    status.textContent = words().loadingFormats;
    status.classList.remove("error");
    try {
      const formats = await invoke("browser_get_video_formats", { url: requestedUrl, sessionToken });
      if (requestedUrl !== location.href) return;
      if (!Array.isArray(formats) || formats.length === 0) throw new Error(words().noFormats);
      formats.forEach((format) => {
        if (!format || typeof format.formatId !== "string" || typeof format.label !== "string") return;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "nexus-quality";
        button.dataset.formatId = format.formatId;
        const label = document.createElement("span");
        label.textContent = format.label;
        const details = document.createElement("small");
        details.textContent = [String(format.ext || "").toUpperCase(), formatBytes(format.filesize)].filter(Boolean).join(" · ");
        button.append(label, details);
        formatList.appendChild(button);
      });
      if (!formatList.childElementCount) throw new Error(words().noFormats);
      cachedFormatsUrl = requestedUrl;
      status.textContent = "";
    } catch (error) {
      const message = typeof error === "string" ? error : error && typeof error === "object" && "message" in error ? String(error.message) : words().noFormats;
      status.textContent = message.slice(0, 180);
      status.classList.add("error");
    } finally {
      formatsLoading = false;
      if (requestedUrl !== location.href && menu?.classList.contains("open")) setTimeout(() => void loadVideoFormats(), 0);
    }
  }

  async function requestDownload(button) {
    if (!status) return;
    const formatId = button.dataset.formatId;
    const invoke = getInvoke();
    if (!invoke) {
      status.textContent = words().desktop;
      status.classList.add("error");
      return;
    }
    root.querySelectorAll(".nexus-quality").forEach((item) => { item.disabled = true; });
    status.textContent = words().working;
    status.classList.remove("error");
    try {
      await invoke("browser_start_download", { url: location.href, formatId, sessionToken });
      status.textContent = words().queued;
      button.innerHTML = `<span>${words().queued}</span><small>✓</small>`;
      setTimeout(() => menu?.classList.remove("open"), 950);
    } catch (error) {
      const message = typeof error === "string" ? error : error && typeof error === "object" && "message" in error ? String(error.message) : words().unavailable;
      status.textContent = message.slice(0, 180);
      status.classList.add("error");
    } finally {
      root.querySelectorAll(".nexus-quality").forEach((item) => { item.disabled = false; });
    }
  }

  const waitForDocument = () => {
    if (document.documentElement) install();
    else requestAnimationFrame(waitForDocument);
  };
  waitForDocument();
})();
