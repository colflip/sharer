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

const sha = getCommitSha();
const versionPath = path.join(__dirname, "..", "assets", "version.json");
const payload = {
    sha,
    shortSha: sha.slice(0, 7),
    source: process.env.RENDER_GIT_COMMIT ? "render" : "local"
};

fs.mkdirSync(path.dirname(versionPath), { recursive: true });
fs.writeFileSync(versionPath, `${JSON.stringify(payload, null, 2)}\n`);
