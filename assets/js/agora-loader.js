(() => {
    let agoraSdkPromise = null;

    function loadScriptWithTimeout(src, timeoutMs = 9000) {
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            let settled = false;
            const timer = setTimeout(() => {
                fail(new Error("加载超时"));
            }, timeoutMs);

            function finish() {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve();
            }

            function fail(err) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                script.remove();
                reject(err);
            }

            script.src = src;
            script.async = true;
            script.onload = finish;
            script.onerror = () => fail(new Error("加载失败"));
            document.head.appendChild(script);
        });
    }

    window.ensureAgoraSdk = async function ensureAgoraSdk() {
        if (window.AgoraRTC) return window.AgoraRTC;
        if (!agoraSdkPromise) {
            agoraSdkPromise = (async () => {
                for (const src of window.ScreenCastConfig.AGORA_SDK_SOURCES) {
                    try {
                        await loadScriptWithTimeout(src);
                        if (window.AgoraRTC) return window.AgoraRTC;
                    } catch (err) {
                        console.warn("Agora SDK 加载失败:", src, err);
                    }
                }
                throw new Error("投屏组件加载失败，请刷新页面或切换网络后重试");
            })();
        }
        return agoraSdkPromise;
    };
})();
