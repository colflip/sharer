const APP_ID = window.ScreenCastConfig.APP_ID;
let client, screenTrack;
let countdownTimer = null; // 全局定时器引用
let totalSecondsRemaining = 0; // 全局剩余秒数
let lastAutoDowngradeAt = 0;
let isScreenPaused = false;
let currentShareHasLimit = false;
const DEFAULT_SHARE_PROMPT = "请使用浏览器打开链接，查看投屏";
const OLD_DEFAULT_SHARE_PROMPTS = [
    "请使用浏览器打开链接，参加投屏",
    "请使用浏览器打开链接，输入邀请码加入投屏。"
];
const SHARE_PROMPT_KEY = "sc_share_prompt";
const SHARE_THEME_KEY = "sc_share_theme";
const LAST_RECORDS_KEY = "sc_latest_viewer_records_key";
const VIEWER_RECORDS_CACHE_KEY = "sc_viewer_records_cache";
const RECENT_RECORD_LIMIT = 10;
let currentRecordsKey = localStorage.getItem(LAST_RECORDS_KEY) || "";
let viewerRecords = [];
const activeViewerRecords = new Map();
let durationRefreshTimer = null;
let recentRecordsExpanded = true;
let earlierRecordsExpanded = false;

function applyShareTheme(theme) {
    const normalizedTheme = theme === "light" ? "light" : "dark";
    document.body.classList.toggle("theme-light", normalizedTheme === "light");
    document.body.classList.toggle("theme-dark", normalizedTheme === "dark");

    const themeToggle = document.getElementById("themeToggle");
    const themeToggleText = document.getElementById("themeToggleText");
    if (themeToggle) themeToggle.checked = normalizedTheme === "light";
    if (themeToggleText) themeToggleText.innerText = normalizedTheme === "light" ? "白天" : "夜间";
}

function setupShareThemeToggle() {
    const savedTheme = localStorage.getItem(SHARE_THEME_KEY);
    const preferredTheme = savedTheme || (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark");
    applyShareTheme(preferredTheme);

    const themeToggle = document.getElementById("themeToggle");
    if (!themeToggle) return;
    themeToggle.addEventListener("change", () => {
        const nextTheme = themeToggle.checked ? "light" : "dark";
        localStorage.setItem(SHARE_THEME_KEY, nextTheme);
        applyShareTheme(nextTheme);
    });
}

function getShareSupportIssue() {
    const ua = navigator.userAgent;
    if (!window.isSecureContext) {
        return "请使用 HTTPS 页面打开分享端，否则浏览器会阻止屏幕共享。";
    }
    if (/MicroMessenger|QQBrowser|MQQBrowser/i.test(ua)) {
        return "当前内置浏览器兼容性较弱，请复制链接到电脑 Chrome 或 Edge 打开。";
    }
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) {
        return "手机浏览器通常不支持发起屏幕共享，请使用电脑 Chrome 或 Edge。";
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        return "当前浏览器不支持屏幕共享，请升级浏览器或使用电脑 Chrome / Edge。";
    }
    return "";
}

function scrollShareControlsIntoView() {
    const shareActions = document.querySelector('.share-actions');
    if (!shareActions) return;

    requestAnimationFrame(() => {
        shareActions.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    });
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));
}

function formatTime(value) {
    if (!value) return "在线中";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "未知";
    return date.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    }).replace(/\//g, "-");
}

function formatDuration(openedAt, endedAt) {
    const start = new Date(openedAt).getTime();
    const end = endedAt ? new Date(endedAt).getTime() : Date.now();
    if (Number.isNaN(start) || Number.isNaN(end)) return "未知";

    const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) return `${hours}小时${minutes}分${seconds}秒`;
    if (minutes > 0) return `${minutes}分${seconds}秒`;
    return `${seconds}秒`;
}

function parseViewerInfo(viewerUid) {
    const p = viewerUid.split("|");
    if (p[1] === "v2") {
        return {
            version: "v2",
            osBrowser: p[2] || "未知",
            deviceType: p[3] || "Device",
            browser: p[4] || "Browser",
            platform: p[5] || "Other",
            res: p[6] || "未知",
            dpr: p[7] || "1",
            net: p[8] || "未知",
            lang: p[9] || "zh",
            theme: p[10] || "light",
            uid: p[11] || "N/A",
            visitorId: p[11] || "N/A",
            sessionId: p[12] || "N/A",
            fp: p[13] || "N/A",
            visits: p[14] || "1",
            timeZone: p[15] || "unknown",
            hasTouch: p[16] || "unknown"
        };
    }

    return {
        version: "v1",
        osBrowser: p[1] || "未知",
        deviceType: "Device",
        browser: "Browser",
        platform: "Other",
        res: p[2] || "未知",
        dpr: p[3] || "1",
        net: p[4] || "未知",
        lang: p[5] || "zh",
        theme: p[6] || "light",
        uid: p[7] || "N/A",
        visitorId: p[7] || "N/A",
        sessionId: "N/A",
        fp: p[8] || "N/A",
        visits: p[9] || "1",
        timeZone: "unknown",
        hasTouch: "unknown"
    };
}

function getViewerDeviceKey(viewerUid, info = parseViewerInfo(viewerUid)) {
    const vid = info.visitorId && info.visitorId !== "N/A" ? info.visitorId : "";
    const fp = info.fp && info.fp !== "N/A" ? info.fp : "";
    
    if (vid && fp) {
        return `${vid}_${fp}`;
    }
    
    return vid || fp || viewerUid;
}

function formatDecimal(value, digits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return value || "未知";
    return number.toFixed(digits).replace(/\.?0+$/, "");
}

function getVisitorId(info = {}) {
    return info.visitorId || info.uid || info.fp || "N/A";
}

function getBrowserSupport(info = {}) {
    const browser = String(info.browser || info.osBrowser || "").toLowerCase();
    if (/wx|micromessenger|qq/.test(browser)) return "Weak";
    if (/chrome|edge|safari|firefox/.test(browser)) return "Good";
    return "Basic";
}

function formatNetworkType(net) {
    const value = String(net || "unknown").trim();
    if (!value || value === "unknown") return "UNKNOWN";
    return value.toUpperCase();
}

function buildInfoTags(info) {
    const visitorId = getVisitorId(info);
    const safeNet = escapeHtml(formatNetworkType(info.net));
    const safeLang = escapeHtml(String(info.lang || "zh").toUpperCase());
    const safeDpr = escapeHtml(formatDecimal(info.dpr));
    const sessionId = info.sessionId && info.sessionId !== "N/A" ? escapeHtml(info.sessionId) : "";
    return `
        <span class="tag tag-uid" title="访客 ID">${escapeHtml(visitorId)}</span>
        ${sessionId ? `<span class="tag tag-session" title="会话 ID">${sessionId}</span>` : ""}
        <span class="tag" title="指纹: ${escapeHtml(info.fp)}">${escapeHtml(info.fp)}</span>
        <span class="tag tag-support" title="浏览器支持度">${escapeHtml(getBrowserSupport(info))}</span>
        <span class="tag tag-net" title="网络类型">${safeNet}</span>
        <span class="tag tag-res">${escapeHtml(info.res)} @${safeDpr}x</span>
        <span class="tag">${safeLang}</span>
        <span class="tag">${info.theme === 'dark' ? '🌙' : '☀️'}</span>
    `;
}

function buildTimeTags(record) {
    const info = record.info || {};
    return `
        <span class="tag tag-visits">第 ${escapeHtml(info.visits || "1")} 次访问</span>
        <span class="tag">打开: ${escapeHtml(formatTime(record.openedAt))}</span>
        <span class="tag">结束: ${escapeHtml(formatTime(record.endedAt))}</span>
        <span class="tag duration-tag" data-opened-at="${escapeHtml(record.openedAt || "")}" data-ended-at="${escapeHtml(record.endedAt || "")}">连接时长: ${escapeHtml(formatDuration(record.openedAt, record.endedAt))}</span>
    `;
}

function buildRecordHtml(record) {
    return `
        <div class="viewer-item record-item">
            ${buildActiveViewerHtml(record)}
        </div>
    `;
}

function buildRecordGroupHtml(title, records, options = {}) {
    if (!records.length) return "";

    const collapsed = Boolean(options.collapsed);
    const groupId = options.groupId || title;
    const escapedGroupId = escapeHtml(groupId);

    return `
        <section class="record-group${collapsed ? " collapsed" : ""}" data-record-group="${escapedGroupId}">
            <div class="record-group-header">
                <div class="record-group-summary">
                    <h4>${escapeHtml(title)}</h4>
                    <span class="record-group-count">${records.length} 条</span>
                </div>
                <div class="record-group-actions">
                    <button class="mini-btn record-group-toggle" data-toggle-record-group="${escapedGroupId}" type="button" aria-expanded="${String(!collapsed)}">${collapsed ? "展开" : "收起"}</button>
                    <button class="mini-btn record-group-clear" data-clear-record-group="${escapedGroupId}" type="button">清空</button>
                </div>
            </div>
            <div class="record-group-body">
                ${records.map(buildRecordHtml).join("")}
            </div>
        </section>
    `;
}

function bindRecordGroupToggles() {
    document.querySelectorAll('[data-toggle-record-group]').forEach((toggleBtn) => {
        toggleBtn.onclick = () => {
            const groupId = toggleBtn.dataset.toggleRecordGroup;
            const group = document.querySelector(`[data-record-group="${groupId}"]`);
            if (!group) return;

            const nextExpanded = group.classList.contains('collapsed');
            group.classList.toggle('collapsed', !nextExpanded);
            toggleBtn.innerText = nextExpanded ? "收起" : "展开";
            toggleBtn.setAttribute("aria-expanded", String(nextExpanded));
            if (groupId === "recent") recentRecordsExpanded = nextExpanded;
            if (groupId === "earlier") earlierRecordsExpanded = nextExpanded;
        };
    });

    document.querySelectorAll('[data-clear-record-group]').forEach((clearBtn) => {
        clearBtn.onclick = () => {
            clearViewerRecordGroup(clearBtn.dataset.clearRecordGroup);
        };
    });
}

function getSortedViewerRecordGroups() {
    const sortedRecords = viewerRecords
        .filter((record) => record.endedAt)
        .slice()
        .reverse();
    return {
        recent: sortedRecords.slice(0, RECENT_RECORD_LIMIT),
        earlier: sortedRecords.slice(RECENT_RECORD_LIMIT)
    };
}

function clearViewerRecordGroup(groupId) {
    const groups = getSortedViewerRecordGroups();
    const recordsToClear = groups[groupId] || [];
    if (!recordsToClear.length) return;

    const idsToClear = new Set(recordsToClear.map((record) => record.id));
    viewerRecords = viewerRecords.filter((record) => !idsToClear.has(record.id) || !record.endedAt);
    saveViewerRecords();
    renderViewerRecords();
}

function refreshLiveDurations() {
    document.querySelectorAll('.duration-tag[data-ended-at=""]').forEach((tag) => {
        tag.textContent = `连接时长: ${formatDuration(tag.dataset.openedAt, tag.dataset.endedAt)}`;
    });
}

function syncDurationRefreshTimer() {
    const hasLiveDuration = Boolean(document.querySelector('.duration-tag[data-ended-at=""]'));
    if (hasLiveDuration && !durationRefreshTimer) {
        durationRefreshTimer = setInterval(refreshLiveDurations, 1000);
    } else if (!hasLiveDuration && durationRefreshTimer) {
        clearInterval(durationRefreshTimer);
        durationRefreshTimer = null;
    }
}

function saveViewerRecords() {
    const cache = {
        recordsKey: currentRecordsKey,
        records: viewerRecords
    };
    localStorage.setItem(VIEWER_RECORDS_CACHE_KEY, JSON.stringify(cache));
    if (!currentRecordsKey) return;
    localStorage.setItem(currentRecordsKey, JSON.stringify(viewerRecords));
    localStorage.setItem(LAST_RECORDS_KEY, currentRecordsKey);
}

function loadSavedViewerRecords() {
    try {
        let saved = [];
        const cached = JSON.parse(localStorage.getItem(VIEWER_RECORDS_CACHE_KEY) || "null");
        if (cached && Array.isArray(cached.records)) {
            saved = cached.records;
            if (!currentRecordsKey && cached.recordsKey) {
                currentRecordsKey = cached.recordsKey;
            }
        } else if (currentRecordsKey) {
            saved = JSON.parse(localStorage.getItem(currentRecordsKey) || "[]");
        }

        if (Array.isArray(saved)) {
            viewerRecords = saved;
            renderViewerRecords();
        }
    } catch (err) {
        console.warn("读取访客记录失败:", err);
    }
}

function renderViewerRecords() {
    const panel = document.getElementById("viewerRecordPanel");
    const container = document.getElementById("recordsContainer");
    if (!panel || !container) return;

    const { recent: recentRecords, earlier: earlierRecords } = getSortedViewerRecordGroups();

    if (!recentRecords.length && !earlierRecords.length) {
        container.innerHTML = '<div class="empty-state">暂无打开记录</div>';
        panel.style.display = currentRecordsKey ? "block" : "none";
        syncDurationRefreshTimer();
        return;
    }

    panel.style.display = "block";
    container.innerHTML = [
        buildRecordGroupHtml("近期设备记录", recentRecords, {
            collapsed: !recentRecordsExpanded,
            groupId: "recent"
        }),
        buildRecordGroupHtml("更早设备记录", earlierRecords, {
            collapsed: !earlierRecordsExpanded,
            groupId: "earlier"
        })
    ].join("") || '<div class="empty-state">暂无打开记录</div>';
    bindRecordGroupToggles();
    syncDurationRefreshTimer();
}

function buildActiveViewerHtml(record) {
    const info = record.info;
    const isOnline = !record.endedAt;

    return `
        <div class="viewer-row">
            <div class="viewer-main">
                <div class="dot" style="background: ${isOnline ? '#34c759' : '#8e8e93'};"></div>
                <b class="viewer-device-name">${escapeHtml(info.osBrowser)}</b>
            </div>
            <div class="viewer-details">
                ${buildInfoTags(info)}
            </div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <div class="viewer-times" style="flex: 1; min-width: 0;">
                ${buildTimeTags(record)}
            </div>
            <div class="viewer-status" style="flex-shrink: 0; margin-left: 8px; font-weight: 500; color: ${isOnline ? '#34c759' : '#8e8e93'};">
                ${isOnline ? '在线中' : '已结束'}
            </div>
        </div>
    `;
}

function updateActiveViewer(record) {
    const el = document.getElementById(`viewer-${record.id}`);
    if (!el) return;
    el.innerHTML = buildActiveViewerHtml(record);
    syncDurationRefreshTimer();
}

function appendActiveViewer(record) {
    const viewersContainer = document.getElementById('viewersContainer');
    if (!viewersContainer) return;

    const el = document.createElement("div");
    el.className = "viewer-item";
    el.id = `viewer-${record.id}`;
    el.innerHTML = buildActiveViewerHtml(record);

    viewersContainer.appendChild(el);
    syncDurationRefreshTimer();
}

function closeActiveViewerRecords() {
    if (!activeViewerRecords.size) return;
    const endedAt = new Date().toISOString();
    activeViewerRecords.forEach((record) => {
        if (!record.endedAt) record.endedAt = endedAt;
        const el = document.getElementById(`viewer-${record.id}`);
        if (el) el.remove();
    });
    activeViewerRecords.clear();
    saveViewerRecords();
    renderViewerRecords();
}

function showCopyToast(message) {
    const toast = document.getElementById('copyToast');
    if (!toast) return;
    toast.innerText = message;
    toast.style.display = 'block';
    clearTimeout(showCopyToast.timer);
    showCopyToast.timer = setTimeout(() => {
        toast.style.display = 'none';
    }, 3000);
}

function setPanelExpanded(panelId, expanded) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const toggleBtn = panel.querySelector('[data-toggle-panel]');
    if (!toggleBtn) return;

    panel.classList.toggle('collapsed', !expanded);
    toggleBtn.innerText = expanded ? "收起" : "展开";
    toggleBtn.setAttribute("aria-expanded", String(expanded));
}

function setupPanelToggle(panelId, defaultExpanded) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const toggleBtn = panel.querySelector('[data-toggle-panel]');
    if (!toggleBtn) return;

    setPanelExpanded(panelId, defaultExpanded);
    toggleBtn.onclick = () => {
        setPanelExpanded(panelId, panel.classList.contains('collapsed'));
    };
}

function formatRemainingTime() {
    const h = String(Math.floor(totalSecondsRemaining / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSecondsRemaining % 3600) / 60)).padStart(2, '0');
    const s = String(totalSecondsRemaining % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

function getSelectedDurationLabel() {
    if (!currentShareHasLimit) return "不限时长";
    if (selectedDuration === -1) return "自定义";
    if (selectedDuration >= 60) {
        const hours = selectedDuration / 60;
        return Number.isInteger(hours) ? `${hours}h` : `${selectedDuration}m`;
    }
    return `${selectedDuration}m`;
}

function updateShareOverview() {
    const qualityText = document.getElementById('shareQualityText');
    const qualityMeta = document.getElementById('shareQualityMeta');
    const bitrateText = document.getElementById('shareBitrateText');
    const bitrateMeta = document.getElementById('shareBitrateMeta');
    const durationText = document.getElementById('shareDurationText');
    const durationMeta = document.getElementById('shareDurationMeta');
    const config = getEncoderConfig(selectedQuality);

    if (qualityText) {
        qualityText.innerText = QUALITY_LABELS[selectedQuality] || selectedQuality;
    }
    if (qualityMeta && config) {
        qualityMeta.innerText = `${config.width}×${config.height} · ${config.frameRate}fps`;
    }
    if (bitrateText) {
        bitrateText.innerText = BITRATE_LABELS[selectedBitrate] || selectedBitrate;
    }
    if (bitrateMeta && config) {
        bitrateMeta.innerText = `${formatDecimal(config.bitrateMin / 1000, 1)}-${formatDecimal(config.bitrateMax / 1000, 1)}Mbps`;
    }
    if (durationText) {
        durationText.innerText = getSelectedDurationLabel();
    }
    if (durationMeta) {
        durationMeta.innerText = currentShareHasLimit
            ? `剩余 ${formatRemainingTime()}`
            : "当前分享没有自动结束时间";
    }
}

function getScreenTrackDimensions() {
    const mediaTrack = typeof screenTrack?.getMediaStreamTrack === "function"
        ? screenTrack.getMediaStreamTrack()
        : null;
    const settings = typeof mediaTrack?.getSettings === "function" ? mediaTrack.getSettings() : {};
    const width = Number(settings.width) || 16;
    const height = Number(settings.height) || 9;
    return { width, height };
}

function syncShareSidePanelTop() {
    const shareInfo = document.getElementById('shareInfo');
    if (!shareInfo || shareInfo.style.display === 'none') return;
    const top = Math.max(30, Math.round(shareInfo.getBoundingClientRect().top));
    document.documentElement.style.setProperty("--share-side-top", `${top}px`);
}

function setShareSidePanelsVisible(visible) {
    document.getElementById('shareSideStats')?.classList.toggle('active', visible);
    document.getElementById('shareSidePreview')?.classList.toggle('active', visible);
    if (visible) requestAnimationFrame(syncShareSidePanelTop);
}

function resetSharePreview() {
    const previewEl = document.getElementById('sharePreviewVideo');
    if (!previewEl) return;
    previewEl.removeAttribute("style");
    previewEl.innerHTML = '<span>预览将在分享开始后显示</span>';
    setShareSidePanelsVisible(false);
}

function sizeSharePreview(previewEl) {
    if (!screenTrack || !previewEl) return;
    const { width, height } = getScreenTrackDimensions();
    const ratio = width / height;
    const previewPanel = document.getElementById('shareSidePreview');
    const sideWidth = Math.floor(previewPanel?.getBoundingClientRect().width || 300);
    const previewWidth = ratio < 1
        ? Math.floor(sideWidth * 0.5)
        : sideWidth;
    previewEl.style.aspectRatio = `${width} / ${height}`;
    previewEl.style.width = `${previewWidth}px`;
    previewEl.style.minHeight = "0";
}

function mountSharePreview() {
    const previewEl = document.getElementById('sharePreviewVideo');
    if (!screenTrack || !previewEl || typeof screenTrack.play !== "function") return;

    previewEl.innerHTML = "";
    sizeSharePreview(previewEl);
    try {
        screenTrack.play(previewEl, { fit: "contain" });
    } catch (err) {
        console.warn("本地缩略图预览失败:", err);
        previewEl.innerHTML = '<span>当前浏览器无法显示本地预览</span>';
    }
}

window.addEventListener('resize', () => {
    syncShareSidePanelTop();
    sizeSharePreview(document.getElementById('sharePreviewVideo'));
});
window.addEventListener('scroll', syncShareSidePanelTop, { passive: true });

function updateShareStatus() {
    const statusEl = document.getElementById('status');
    if (!statusEl) return;

    statusEl.innerText = isScreenPaused
        ? "⏸️ 已暂停投屏"
        : "🟢 分享中";
    updateShareOverview();
}

function appendShareNotice(message) {
    const statusEl = document.getElementById('status');
    if (!statusEl || !message) return;
    statusEl.innerText = statusEl.innerText
        ? `${statusEl.innerText}\n${message}`
        : message;
}

function updatePauseButton() {
    const pauseBtn = document.getElementById('pauseBtn');
    if (!pauseBtn) return;

    pauseBtn.innerText = isScreenPaused ? "继续投屏" : "暂停投屏";
    pauseBtn.classList.toggle('paused', isScreenPaused);
}

async function toggleScreenPause() {
    const pauseBtn = document.getElementById('pauseBtn');
    const statusEl = document.getElementById('status');
    if (!screenTrack || !pauseBtn) return;

    pauseBtn.disabled = true;
    try {
        const nextPaused = !isScreenPaused;
        if (typeof screenTrack.setMuted === "function") {
            await screenTrack.setMuted(nextPaused);
        } else if (typeof screenTrack.setEnabled === "function") {
            await screenTrack.setEnabled(!nextPaused);
        } else {
            throw new Error("当前投屏轨道不支持暂停");
        }

        isScreenPaused = nextPaused;
        updatePauseButton();
        updateShareStatus();
    } catch (err) {
        console.error("Pause Share Error:", err);
        if (statusEl) statusEl.innerText = `🔴 暂停投屏失败: ${err.message || "请稍后重试"}`;
    } finally {
        pauseBtn.disabled = false;
    }
}

const sharePromptInput = document.getElementById('sharePromptInput');
let savedSharePrompt = localStorage.getItem(SHARE_PROMPT_KEY);
if (savedSharePrompt === null || OLD_DEFAULT_SHARE_PROMPTS.includes(savedSharePrompt)) {
    savedSharePrompt = DEFAULT_SHARE_PROMPT;
    localStorage.setItem(SHARE_PROMPT_KEY, DEFAULT_SHARE_PROMPT);
}
sharePromptInput.value = savedSharePrompt;
sharePromptInput.addEventListener('input', function() {
    localStorage.setItem(SHARE_PROMPT_KEY, this.value);
});

setupShareThemeToggle();
loadSavedViewerRecords();
setupPanelToggle("viewerList", true);

// 清晰度配置项 (升级版)
const QUALITY_CONFIGS = {
    fluent: { width: 960, height: 540, frameRate: 15, bitrateMin: 500, bitrateMax: 1000 },
    standard: { width: 1280, height: 720, frameRate: 25, bitrateMin: 800, bitrateMax: 2000 },
    high: { width: 1920, height: 1080, frameRate: 30, bitrateMin: 1500, bitrateMax: 4000 },
    pro_2k: { width: 2560, height: 1440, frameRate: 30, bitrateMin: 3000, bitrateMax: 10000 },
    pro_4k: { width: 3840, height: 2160, frameRate: 30, bitrateMin: 6000, bitrateMax: 20000 }
};
const QUALITY_LABELS = {
    fluent: "540P",
    standard: "720P",
    high: "1080P",
    pro_2k: "2K",
    pro_4k: "4K"
};
const FALLBACK_QUALITY_KEYS = new Set(["fluent", "standard", "high"]);
const BITRATE_PRESETS = {
    low: { minScale: 0.65, maxScale: 0.65 },
    standard: { minScale: 1, maxScale: 1 },
    high: { minScale: 1.25, maxScale: 1.35 },
    max: { minScale: 1.6, maxScale: 1.8 }
};
const BITRATE_LABELS = {
    low: "省流",
    standard: "标准",
    high: "高码率",
    max: "极致"
};
let selectedQuality = "pro_2k";
let selectedBitrate = "standard";
const qualitySupport = new Map();

function getEncoderConfig(qualityKey = selectedQuality) {
    const config = QUALITY_CONFIGS[qualityKey];
    if (!config) return null;
    const bitratePreset = BITRATE_PRESETS[selectedBitrate] || BITRATE_PRESETS.standard;

    return {
        width: config.width,
        height: config.height,
        frameRate: config.frameRate,
        bitrateMin: Math.round(config.bitrateMin * bitratePreset.minScale),
        bitrateMax: Math.round(config.bitrateMax * bitratePreset.maxScale)
    };
}

async function applyScreenQuality(qualityKey) {
    if (!screenTrack) return;
    const config = getEncoderConfig(qualityKey);
    if (!config) return;
    await screenTrack.setEncoderConfiguration({
        width: config.width,
        height: config.height,
        frameRate: config.frameRate,
        bitrateMin: config.bitrateMin,
        bitrateMax: config.bitrateMax
    });
    updateShareOverview();
}

function setQualityActive(qualityKey) {
    document.querySelectorAll('#qualitySelector .control-item').forEach(item => {
        const itemQuality = item.getAttribute('data-q');
        item.classList.toggle('active', itemQuality === qualityKey && !item.classList.contains('disabled'));
    });
}

function setQualityDisabled(qualityKey, reason) {
    const item = document.querySelector(`#qualitySelector .control-item[data-q="${qualityKey}"]`);
    if (!item) return;
    const disabled = Boolean(reason);
    item.classList.toggle('disabled', disabled);
    item.setAttribute('aria-disabled', String(disabled));
    item.title = disabled ? reason : "";
    qualitySupport.set(qualityKey, { disabled, reason: reason || "" });
}

function isQualityDisabled(qualityKey) {
    return Boolean(qualitySupport.get(qualityKey)?.disabled);
}

function selectBestAvailableQuality(preferredQuality = selectedQuality) {
    const ordered = ["pro_4k", "pro_2k", "high", "standard", "fluent"];
    if (!isQualityDisabled(preferredQuality)) return preferredQuality;
    return ordered.find((qualityKey) => !isQualityDisabled(qualityKey)) || "fluent";
}

async function getMediaCapability(config) {
    if (!navigator.mediaCapabilities || typeof navigator.mediaCapabilities.encodingInfo !== "function") {
        return null;
    }

    try {
        return await navigator.mediaCapabilities.encodingInfo({
            type: "webrtc",
            video: {
                contentType: "video/VP8",
                width: config.width,
                height: config.height,
                bitrate: config.bitrateMax * 1000,
                framerate: config.frameRate
            }
        });
    } catch (err) {
        console.warn("清晰度能力检测失败:", err);
        return null;
    }
}

function getHardwareLimitReason(config) {
    const cores = navigator.hardwareConcurrency || 0;
    const memory = navigator.deviceMemory || 0;
    const pixels = config.width * config.height;

    if (pixels >= 3840 * 2160 && ((cores && cores < 8) || (memory && memory < 8))) {
        return "当前设备性能信息偏低，已关闭 4K 选项";
    }
    if (config.frameRate >= 60 && cores && cores < 6) {
        return "当前设备 CPU 核心数偏低，已关闭高帧率选项";
    }
    return "";
}

async function refreshQualitySupport() {
    const checks = await Promise.all(Object.keys(QUALITY_CONFIGS).map(async (qualityKey) => {
        const encoderConfig = getEncoderConfig(qualityKey);
        const capability = await getMediaCapability(encoderConfig);
        let reason = "";

        if (capability && capability.supported === false) {
            reason = "当前浏览器/设备不支持该清晰度编码";
        } else if (capability && capability.smooth === false) {
            reason = "当前设备预计无法流畅分享该清晰度";
        } else if (!capability) {
            reason = getHardwareLimitReason(encoderConfig);
        }
        if (FALLBACK_QUALITY_KEYS.has(qualityKey)) reason = "";

        return [qualityKey, reason];
    }));

    checks.forEach(([qualityKey, reason]) => setQualityDisabled(qualityKey, reason));

    const nextQuality = selectBestAvailableQuality(selectedQuality);
    if (nextQuality !== selectedQuality) {
        selectedQuality = nextQuality;
        setQualityActive(selectedQuality);
        updateShareOverview();
    }
}

async function autoDowngradeForWeakNetwork() {
    if (!screenTrack || isScreenPaused || selectedQuality === "high") return;
    const now = Date.now();
    if (now - lastAutoDowngradeAt < 30000) return;
    lastAutoDowngradeAt = now;
    selectedQuality = "high";
    setQualityActive(selectedQuality);
    try {
        await applyScreenQuality(selectedQuality);
        document.getElementById('status').innerText = "🟡 网络较弱，已自动降至 1080P";
    } catch (err) {
        console.warn("自动降级失败:", err);
    }
}

function bindClientHealthEvents(statusEl) {
    client.on("connection-state-change", (curState, prevState, reason) => {
        console.log("连接状态:", prevState, "->", curState, reason || "");
        if (curState === "RECONNECTING") {
            statusEl.innerText = "🟡 网络波动，正在重连...";
        } else if (curState === "FAILED") {
            statusEl.innerText = "🔴 连接失败，请刷新页面或切换网络后重试";
        }
    });

    client.on("network-quality", (quality) => {
        const uplink = quality.uplinkNetworkQuality;
        if (uplink >= 5) {
            autoDowngradeForWeakNetwork();
        }
    });
}

// 清晰度选择逻辑
document.querySelectorAll('#qualitySelector .control-item').forEach(item => {
    item.onclick = async () => {
        if (document.getElementById('generateBtn').disabled && !screenTrack) return; // 只有在未开始投屏时才禁用
        const nextQuality = item.getAttribute('data-q');
        if (isQualityDisabled(nextQuality)) return;
        selectedQuality = nextQuality;
        setQualityActive(selectedQuality);
        updateShareOverview();

        // 如果正在投屏，动态应用新配置
        if (screenTrack) {
            try {
                await applyScreenQuality(selectedQuality);
                console.log("清晰度已动态切换为:", selectedQuality);
            } catch (e) {
                console.error("动态切换清晰度失败:", e);
            }
        }
    };
});

refreshQualitySupport();

// 码率选择逻辑
document.querySelectorAll('#bitrateSelector .control-item').forEach(item => {
    item.onclick = async () => {
        if (document.getElementById('generateBtn').disabled && !screenTrack) return;
        selectedBitrate = item.getAttribute('data-bitrate');
        document.querySelectorAll('#bitrateSelector .control-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        await refreshQualitySupport();

        if (screenTrack) {
            try {
                selectedQuality = selectBestAvailableQuality(selectedQuality);
                setQualityActive(selectedQuality);
                await applyScreenQuality(selectedQuality);
                console.log("码率已动态切换为:", selectedBitrate);
            } catch (e) {
                console.error("动态切换码率失败:", e);
            }
        }
    };
});

// 时长选择逻辑
let selectedDuration = 15;
document.querySelectorAll('#durationSelector .control-item').forEach(item => {
    item.onclick = () => {
        if (document.getElementById('generateBtn').disabled && !screenTrack) return; // 只有在未开始投屏时才禁用
        document.querySelectorAll('#durationSelector .control-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        
        const val = item.getAttribute('data-v');
        if (val === 'custom') {
            document.getElementById('customDurationBox').style.display = 'block';
            selectedDuration = -1;
        } else {
            document.getElementById('customDurationBox').style.display = 'none';
            selectedDuration = parseInt(val);
        }

        // 如果正在投屏，动态更新/开启剩余时长
        if (client && client.connectionState === "CONNECTED") {
            let newLimit = 0;
            if (selectedDuration === -1) {
                newLimit = parseInt(document.getElementById('customMinutesInput').value) || 30;
            } else {
                newLimit = selectedDuration;
            }
            
            if (newLimit > 0) {
                totalSecondsRemaining = newLimit * 60;
                currentShareHasLimit = true;
                if (!countdownTimer) {
                    startCountdown(); // 重新启动计时器
                }
                updateShareStatus();
                console.log("时长已动态调整为:", newLimit, "分钟");
            } else {
                // 不限时长，清除定时器
                if (countdownTimer) {
                    clearInterval(countdownTimer);
                    countdownTimer = null;
                }
                currentShareHasLimit = false;
                totalSecondsRemaining = 0;
                updateShareStatus();
            }
        }
    };
});

// 封装倒计时启动逻辑
function startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
        totalSecondsRemaining--;
        if (totalSecondsRemaining <= 0) {
            clearInterval(countdownTimer);
            countdownTimer = null;
            alert("分享时间已到，投屏已自动结束。");
            cleanup().finally(() => window.location.reload());
            return;
        }
        updateShareStatus();
    }, 1000);
}

// 自定义时长输入动态更新逻辑
document.getElementById('customMinutesInput').addEventListener('input', function() {
    if (countdownTimer && selectedDuration === -1) {
        const newLimit = parseInt(this.value);
        if (newLimit > 0) {
            totalSecondsRemaining = newLimit * 60;
            currentShareHasLimit = true;
            updateShareStatus();
        }
    }
});

document.getElementById('generateBtn').onclick = async () => {
    const btn = document.getElementById('generateBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const status = document.getElementById('status');

    let preflightNotice = "";
    if (window.location.protocol === 'file:') {
        preflightNotice = "🟡 当前是本地文件页面，生成的观看链接可能只在本机可用。";
    }

    const supportIssue = getShareSupportIssue();
    if (supportIssue) {
        preflightNotice = [preflightNotice, `🟡 ${supportIssue}`].filter(Boolean).join("\n");
    }

    // 生成 4 位密码和随机房间 ID
    const password = String(Math.floor(1000 + Math.random() * 9000));
    const roomId = Math.random().toString(36).substring(7);
    const channel = `iosshare-${roomId}-${password}`;
    const sharePrompt = document.getElementById('sharePromptInput').value.trim() || DEFAULT_SHARE_PROMPT;
    localStorage.setItem(SHARE_PROMPT_KEY, sharePrompt);
    document.getElementById('sharePromptInput').value = sharePrompt;

    try {
        btn.disabled = true;
        status.innerText = preflightNotice || "正在加载投屏组件...";
        await ensureAgoraSdk();
        status.innerText = preflightNotice
            ? `${preflightNotice}\n正在请求共享权限...`
            : "正在请求共享权限...";

        client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        bindClientHealthEvents(status);

        // 应用选中的清晰度配置 (开启 detail 模式优化画质)
        const config = getEncoderConfig(selectedQuality);
        
        try {
            screenTrack = await AgoraRTC.createScreenVideoTrack({
                optimizationMode: "detail", // 优先保障文字细节
                encoderConfig: {
                    width: config.width,
                    height: config.height,
                    frameRate: config.frameRate,
                    bitrateMin: config.bitrateMin,
                    bitrateMax: config.bitrateMax
                }
            }, "auto");
        } catch (trackError) {
            console.error("Track Error:", trackError);
            let msg = "权限请求失败";
            if (trackError.code === "PERMISSION_DENIED") msg = "未获得屏幕共享权限，请点击允许";
            else if (trackError.message?.includes("Could not get display media")) msg = "浏览器由于硬件压力或安全策略拒绝了请求";
            throw new Error(msg);
        }

        await client.join(APP_ID, channel, null, "sharer");
        await client.publish(screenTrack);

        // 生成观看链接 (自适应当前部署域名，全网通用)
        const baseUrl = window.location.origin + window.location.pathname.replace('sharer.html', '');
        const hashParams = new URLSearchParams({ room: roomId, pwd: password });
        const watchUrl = `${baseUrl}index.html#${hashParams.toString()}`;

        currentRecordsKey = `sc_viewer_records_${roomId}_${password}`;
        activeViewerRecords.clear();
        saveViewerRecords();
        renderViewerRecords();

        document.getElementById('urlContainer').innerText = watchUrl;
        document.getElementById('shareInfo').style.display = 'block';
        document.getElementById('viewerList').style.display = 'block';
        document.getElementById('viewerRecordPanel').style.display = 'block';
        setShareSidePanelsVisible(true);
        mountSharePreview();

        const promptPreview = document.getElementById('promptPreview');
        if (sharePrompt) {
            promptPreview.innerText = sharePrompt;
            promptPreview.style.display = 'block';
        } else {
            promptPreview.innerText = "";
            promptPreview.style.display = 'none';
        }

        // ===== 倒计时初始化 =====
        let limitMinutes = 0;
        if (selectedDuration === -1) {
            limitMinutes = parseInt(document.getElementById('customMinutesInput').value) || 30;
        } else {
            limitMinutes = selectedDuration;
        }

        currentShareHasLimit = limitMinutes > 0;
        if (limitMinutes > 0) {
            totalSecondsRemaining = limitMinutes * 60;
            startCountdown();
        } else {
            totalSecondsRemaining = 0;
        }
        updateShareStatus();
        appendShareNotice(preflightNotice);

        btn.innerText = "停止投屏";
        btn.classList.add('active'); // 借用 active 样式使其变红或区分
        document.getElementById('sharePromptInput').disabled = true;
        isScreenPaused = false;
        updatePauseButton();
        pauseBtn.style.display = 'block';
        pauseBtn.onclick = toggleScreenPause;
        pauseBtn.disabled = false;
        scrollShareControlsIntoView();
        btn.onclick = async () => {
            await cleanup();
            window.location.reload(); // 目前依然建议 reload 以确保 UI 状态完全重置
        };
        btn.disabled = false;

        document.getElementById('copyUrl').onclick = () => {
            const text = `${sharePrompt}\n${watchUrl}`;
            navigator.clipboard.writeText(text)
                .then(() => showCopyToast("邀请信息已复制"))
                .catch(() => showCopyToast("复制失败，请手动复制链接"));
        };

        // ===== 观众状态监听与透传解析 =====
        client.on("user-joined", (user) => {
            // 如果 UID 不是通过我们特定编码格式传入的，则跳过
            if (typeof user.uid !== 'string' || !user.uid.startsWith("viewer|")) return;
            const info = parseViewerInfo(user.uid);
            const deviceKey = getViewerDeviceKey(user.uid, info);
            
            const existingRecord = activeViewerRecords.get(deviceKey);
            if (existingRecord) {
                const activeAgoraUids = Array.isArray(existingRecord.activeAgoraUids)
                    ? existingRecord.activeAgoraUids
                    : [existingRecord.agoraUid].filter(Boolean);
                if (!activeAgoraUids.includes(user.uid)) activeAgoraUids.push(user.uid);

                existingRecord.agoraUid = user.uid;
                existingRecord.activeAgoraUids = activeAgoraUids;
                existingRecord.info = info;
                saveViewerRecords();
                updateActiveViewer(existingRecord);
                renderViewerRecords();
                return;
            }

            // 本地重新计算访问次数
            const pastVisits = viewerRecords.filter((record) => getViewerDeviceKey(record.agoraUid || "", record.info || {}) === deviceKey).length;
            info.visits = pastVisits + 1;

            const record = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                deviceKey,
                agoraUid: user.uid,
                activeAgoraUids: [user.uid],
                info,
                openedAt: new Date().toISOString(),
                endedAt: null
            };

            viewerRecords.push(record);
            activeViewerRecords.set(deviceKey, record);
            saveViewerRecords();
            appendActiveViewer(record);
            renderViewerRecords();
        });

        client.on("user-left", (user) => {
            if (typeof user.uid !== 'string' || !user.uid.startsWith("viewer|")) return;
            const info = parseViewerInfo(user.uid);
            const deviceKey = getViewerDeviceKey(user.uid, info);
            const record = activeViewerRecords.get(deviceKey);
            if (record) {
                const activeAgoraUids = Array.isArray(record.activeAgoraUids)
                    ? record.activeAgoraUids
                    : [record.agoraUid].filter(Boolean);
                record.activeAgoraUids = activeAgoraUids.filter((uid) => uid !== user.uid);
                if (record.activeAgoraUids.length > 0) {
                    saveViewerRecords();
                    renderViewerRecords();
                    return;
                }
                if (!record.endedAt) {
                    record.endedAt = new Date().toISOString();
                }
                activeViewerRecords.delete(deviceKey);
            }
            saveViewerRecords();
            renderViewerRecords();

            const el = record ? document.getElementById(`viewer-${record.id}`) : null;
            if (el) el.remove();
            syncDurationRefreshTimer();
        });

        // 监听停止共享（点击浏览器顶部的停止或关闭窗口）
        screenTrack.on("track-ended", () => {
            cleanup().finally(() => window.location.reload());
        });

    } catch (err) {
        console.error("Share Error:", err);
        status.innerText = `🔴 分享失败: ${err.message || '系统繁忙，请刷新再试'}`;
        btn.disabled = false;
        pauseBtn.style.display = 'none';
        pauseBtn.disabled = false;
        isScreenPaused = false;
        updatePauseButton();
        document.getElementById('sharePromptInput').disabled = false;
        if (screenTrack) {
            screenTrack.stop();
            screenTrack.close();
        }
        resetSharePreview();
        if (client) await client.leave().catch(() => {});
    }
};

// 统一资源回收逻辑
async function cleanup() {
    closeActiveViewerRecords();
    const pauseBtn = document.getElementById('pauseBtn');
    isScreenPaused = false;
    currentShareHasLimit = false;
    totalSecondsRemaining = 0;
    if (pauseBtn) {
        pauseBtn.style.display = 'none';
        pauseBtn.disabled = false;
    }
    updatePauseButton();
    if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
    }
    if (screenTrack) {
        screenTrack.stop();
        screenTrack.close();
        screenTrack = null;
    }
    resetSharePreview();
    if (client) {
        await client.leave().catch(() => {});
        client = null;
    }
}

// 页面关闭/刷新前强制释放资源，防止崩溃或僵尸流
window.onbeforeunload = () => {
    closeActiveViewerRecords();
    cleanup();
};
