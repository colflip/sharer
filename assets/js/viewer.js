const APP_ID = window.ScreenCastConfig.APP_ID;

// 增强版设备信息获取
function getExtendedDeviceInfo() {
    const ua = navigator.userAgent;
    
    // 1. 平台与浏览器 (核心标识)
    let platform = "Other";
    if (/iPhone|iPad|iPod/i.test(ua)) platform = "iOS";
    else if (/Android/i.test(ua)) platform = "Android";
    else if (/Mac OS X/i.test(ua)) platform = "Mac";
    else if (/Windows/i.test(ua)) platform = "Win";

    let browser = "Browser";
    if (/MicroMessenger/i.test(ua)) browser = "WX";
    else if (/Chrome/i.test(ua)) browser = "Chrome";
    else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
    else if (/Firefox/i.test(ua)) browser = "Firefox";
    const osBrowser = `${platform}_${browser}`;

    // 2. 屏幕属性
    const res = `${window.screen.width}x${window.screen.height}`;
    const dpr = window.devicePixelRatio || 1;

    // 3. 网络状况 (部分浏览器支持)
    let net = "unknown";
    if (navigator.connection) {
        net = navigator.connection.effectiveType || "unknown";
    }

    // 4. 语言与主题
    const lang = (navigator.language || "zh").split('-')[0]; // 取简码如 zh, en
    const theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? "dark" : "light";

    // 5. 持久化 Unique ID 与 访问次数 (存储在 localStorage)
    let uid = localStorage.getItem('sc_uid');
    if (!uid) {
        uid = Math.random().toString(36).substring(2, 8);
        localStorage.setItem('sc_uid', uid);
    }
    
    let visits = parseInt(localStorage.getItem('sc_visits') || '0') + 1;
    localStorage.setItem('sc_visits', visits.toString());

    // 6. 简易指纹 (UA + 分辨率 + 时区 + 语言)
    const fpData = `${ua}|${res}|${new Date().getTimezoneOffset()}|${lang}`;
    let hash = 0;
    for (let i = 0; i < fpData.length; i++) {
        hash = ((hash << 5) - hash) + fpData.charCodeAt(i);
        hash |= 0;
    }
    const fingerprint = Math.abs(hash).toString(36);

    return { osBrowser, res, dpr, net, lang, theme, uid, fingerprint, visits };
}

// 监听 URL 变化：解决同一窗口下重新打开链接不刷新的问题
window.addEventListener("hashchange", () => {
    window.location.reload();
});

// 从 Hash 解析 room 参数 (例如 #room=io8gvd)
const getHashParam = (name) => {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    return params.get(name);
};
const roomId = getHashParam('room');
const sharePrompt = getHashParam('msg') || "";

if (!roomId) {
    document.body.innerHTML = '<div class="invalid-link"><h2>❌ 链接无效</h2><p>请重新获取分享链接</p></div>';
    throw new Error("Missing room id");
}

if (sharePrompt) {
    const shareNoteEl = document.getElementById('share-note');
    shareNoteEl.innerText = sharePrompt;
    shareNoteEl.style.display = 'block';
}

function showVideoPrompt() {
    if (!sharePrompt) return;
    const videoNoteEl = document.getElementById('video-note');
    videoNoteEl.innerText = sharePrompt;
    videoNoteEl.style.display = 'block';
    clearTimeout(showVideoPrompt.timer);
    showVideoPrompt.timer = setTimeout(() => {
        videoNoteEl.style.display = 'none';
    }, 6000);
}

// 4 位邀请码自动进入逻辑
document.getElementById('pwdInput').addEventListener('input', function() {
    if (this.value.length === 4) {
        document.getElementById('enterBtn').click();
    }
});

document.getElementById('enterBtn').onclick = async () => {
    const enterBtn = document.getElementById('enterBtn');
    const pwd = document.getElementById('pwdInput').value.trim();
    const errorMsg = document.getElementById('error-msg');

    if (pwd.length !== 4) {
        errorMsg.innerText = "请输入 4 位数字密码";
        return;
    }

    // 切换 UI
    enterBtn.disabled = true;
    errorMsg.innerText = "";
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('video-container').style.display = 'block';
    const statusBar = document.getElementById('status-bar');
    statusBar.style.display = "block";
    statusBar.innerText = "正在加载投屏组件...";
    showVideoPrompt();

    try {
        await ensureAgoraSdk();
        const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        // 构造与分享端一致的频道名
        const channel = `iosshare-${roomId}-${pwd}`;

        client.on("connection-state-change", (curState, prevState, reason) => {
            console.log("连接状态:", prevState, "->", curState, reason || "");
            if (curState === "CONNECTING") {
                statusBar.style.display = "block";
                statusBar.innerText = "正在连接...";
            } else if (curState === "RECONNECTING") {
                statusBar.style.display = "block";
                statusBar.innerText = "🟡 网络波动，正在重连...";
            } else if (curState === "FAILED") {
                statusBar.style.display = "block";
                statusBar.innerText = "🔴 连接失败，请刷新或切换网络后重试";
            }
        });
        
        // 将增强的设备信息编码进 UID (格式: viewer|平台_浏览器|分辨率|DPR|网络|语言|主题|UID|指纹|访问次数)
        const info = getExtendedDeviceInfo();
        const viewerUid = `viewer|${info.osBrowser}|${info.res}|${info.dpr}|${info.net}|${info.lang}|${info.theme}|${info.uid}|${info.fingerprint}|${info.visits}`;

        await client.join(APP_ID, channel, null, viewerUid);
        statusBar.innerText = "已进入房间，等待画面...";

        // 无后端状态探测：弱网下给足等待时间，避免误判为密码错误或分享已结束
        setTimeout(async () => {
            if (client.remoteUsers.length === 0) {
                errorMsg.innerText = "🔇 邀请码错误或分享已结束";
                await client.leave();
                // 恢复登录界面并清空输入
                document.getElementById('login-screen').style.display = 'flex';
                document.getElementById('video-container').style.display = 'none';
                document.getElementById('pwdInput').value = "";
                document.getElementById('pwdInput').focus();
                enterBtn.disabled = false;
            }
        }, 8000);

        client.on("user-published", async (user, mediaType) => {
            if (mediaType === "video") {
                statusBar.innerText = "正在加载画面...";
                const remoteTrack = await client.subscribe(user, mediaType);
                remoteTrack.play("player");
                // 播放成功后隐藏顶部的状态栏
                statusBar.style.display = "none";
            }
        });

        client.on("user-unpublished", (user, mediaType) => {
            if (mediaType === "video") {
                statusBar.style.display = "block";
                statusBar.innerText = "🔴 分享者已暂停或停止共享";
                document.getElementById("player").innerHTML = "";
            }
        });

        client.on("peer-leave", () => {
           statusBar.style.display = "block";
           statusBar.innerText = "🔴 分享者已离开";
        });

    } catch (e) {
        console.error(e);
        errorMsg.innerText = e.message || "进入失败：可能密码错误或连接超时";
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('video-container').style.display = 'none';
        enterBtn.disabled = false;
        document.getElementById('pwdInput').focus();
    }
};

// 自动聚焦 & 自动登录
window.onload = () => {
    const pwdInput = document.getElementById('pwdInput');
    const urlPwd = getHashParam('pwd');
    
    if (urlPwd && urlPwd.length === 4) {
        pwdInput.value = urlPwd;
        // 延迟一小下确保 UI 已就绪（可选，但更稳健）
        setTimeout(() => {
            document.getElementById('enterBtn').click();
        }, 100);
    } else {
        pwdInput.focus();
    }
};
