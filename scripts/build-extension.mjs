import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const outputDirectory = path.join(repositoryRoot, "dist", "lazylex-local");

const runtimeFiles = [
    "background.js",
    "content.js",
    "extension-config.js",
    "firebase-auth.js",
    "firebase-config.js",
    "language-catalog.js",
    "onboarding.html",
    "onboarding.js",
    "onboarding.css",
    "options.html",
    "options.js",
    "popup.css",
    "popup.html",
    "popup.js",
    "settings.json",
    "styles.css",
    "subscription-manager.js",
    "translation-format.js",
    "word-io-manager.js"
];

const runtimeDirectories = [
    "font-awesome",
    "images"
];

function readArgument(name) {
    const prefix = `--${name}=`;
    const argument = process.argv.find((value) => value.startsWith(prefix));
    return argument ? argument.slice(prefix.length).trim() : null;
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const relativePath of [...runtimeFiles, ...runtimeDirectories]) {
    await cp(
        path.join(repositoryRoot, relativePath),
        path.join(outputDirectory, relativePath),
        { recursive: true }
    );
}

const manifest = JSON.parse(
    await readFile(path.join(repositoryRoot, "manifest.json"), "utf8")
);
const oauthClientId = readArgument("oauth-client-id");
const extensionKey = readArgument("extension-key");

manifest.name = "LazyLex (Local QA)";
manifest.version_name = `${manifest.version} local QA`;

if (oauthClientId) {
    if (!/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(oauthClientId)) {
        throw new Error("--oauth-client-id must be a Google OAuth client ID");
    }

    manifest.oauth2.client_id = oauthClientId;
}

if (extensionKey) {
    manifest.key = extensionKey;
}

await writeFile(
    path.join(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
);

if (!oauthClientId) {
    console.warn(
        "Using the committed OAuth client. It must be registered for the exact unpacked extension ID shown by Chrome."
    );
}

const configSource = await readFile(
    path.join(repositoryRoot, "extension-config.js"),
    "utf8"
);

if (
    !configSource.includes('environment: "deployed"') ||
    !configSource.includes('landingOrigin: "https://lazylex.com"') ||
    !configSource.includes('firebaseProjectId: "lazylex-9d161"')
) {
    throw new Error("The extension configuration is not targeting the approved deployed stack");
}

console.log(outputDirectory);
