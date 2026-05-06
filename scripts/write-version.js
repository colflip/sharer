const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function getCommitSha() {
    if (process.env.RENDER_GIT_COMMIT) {
        return process.env.RENDER_GIT_COMMIT;
    }

    try {
        return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    } catch (err) {
        return "";
    }
}

function loadLocalEnv() {
    const envPath = path.join(__dirname, "..", ".env");
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const separatorIndex = trimmed.indexOf("=");
        if (separatorIndex === -1) continue;

        const key = trimmed.slice(0, separatorIndex).trim();
        let value = trimmed.slice(separatorIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (key && process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

loadLocalEnv();

const sha = getCommitSha();
const versionPath = path.join(__dirname, "..", "assets", "version.json");
const configPath = path.join(__dirname, "..", "assets", "js", "config.js");
const payload = {
    sha,
    shortSha: sha.slice(0, 7),
    source: process.env.RENDER_GIT_COMMIT ? "render" : "local"
};

fs.mkdirSync(path.dirname(versionPath), { recursive: true });
fs.writeFileSync(versionPath, `${JSON.stringify(payload, null, 2)}\n`);

const appId = process.env.AGORA_APP_ID || "";
const config = {
    APP_ID: appId,
    GITHUB_REPO: "colflip/sharer",
    AGORA_SDK_SOURCES: [
        "vendor/AgoraRTC_N-4.23.1.js",
        "https://download.agora.io/sdk/release/AgoraRTC_N-4.23.1.js"
    ]
};

fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, `window.ScreenCastConfig = ${JSON.stringify(config, null, 4)};\n`);
