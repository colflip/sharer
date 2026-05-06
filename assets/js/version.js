(function renderDeployVersion() {
    const config = window.ScreenCastConfig || {};
    const repo = config.GITHUB_REPO || "colflip/sharer";
    const repoUrl = repo ? `https://github.com/${repo}` : "";

    function shortSha(value) {
        return String(value || "").slice(0, 7);
    }

    function ensureVersionEl() {
        let el = document.getElementById("github-version");
        if (el) return el;

        el = document.createElement("a");
        el.id = "github-version";
        el.className = "github-version";
        el.target = "_blank";
        el.rel = "noopener noreferrer";
        const container = document.querySelector(".container") || document.body;
        container.appendChild(el);
        return el;
    }

    function setVersion(value) {
        const version = shortSha(value);
        if (!version) return;

        const el = ensureVersionEl();
        if (repoUrl) {
            el.href = repoUrl;
            el.target = "_blank";
            el.rel = "noopener noreferrer";
        } else {
            el.removeAttribute("href");
            el.removeAttribute("target");
        }
        el.textContent = version;
        el.setAttribute("aria-label", `Deploy version ${version}`);
    }

    function setVersionError() {
        const el = ensureVersionEl();
        if (repoUrl) {
            el.href = repoUrl;
            el.target = "_blank";
            el.rel = "noopener noreferrer";
        } else {
            el.removeAttribute("href");
            el.removeAttribute("target");
        }
        el.textContent = "版本获取失败";
        el.setAttribute("aria-label", "Deploy version failed to load");
    }

    function fetchGitHubVersion() {
        if (!repo) return Promise.reject(new Error("Missing GitHub repo"));

        return fetch(`https://api.github.com/repos/${repo}/commits/main`, { cache: "no-store" })
            .then((response) => {
                if (!response.ok) throw new Error("Failed to load GitHub version");
                return response.json();
            })
            .then((data) => data.sha);
    }

    function fetchBuildVersion() {
        return fetch("assets/version.json", { cache: "no-store" })
            .then((response) => {
                if (!response.ok) throw new Error("Failed to load deploy version");
                return response.json();
            })
            .then((data) => data.sha || data.shortSha);
    }

    fetchGitHubVersion()
        .catch(fetchBuildVersion)
        .then(setVersion)
        .catch(setVersionError);
})();
