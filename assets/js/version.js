(function renderDeployVersion() {
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
        el.removeAttribute("href");
        el.removeAttribute("target");
        el.textContent = version;
        el.setAttribute("aria-label", `Deploy version ${version}`);
    }

    function setVersionError() {
        const el = ensureVersionEl();
        el.removeAttribute("href");
        el.removeAttribute("target");
        el.textContent = "版本获取失败";
        el.setAttribute("aria-label", "Deploy version failed to load");
    }

    fetch("assets/version.json", { cache: "no-store" })
        .then((response) => {
            if (!response.ok) throw new Error("Failed to load deploy version");
            return response.json();
        })
        .then((data) => setVersion(data.sha || data.shortSha))
        .catch(setVersionError);
})();
