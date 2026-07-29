import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const manifest = JSON.parse(
    await readFile(path.join(repositoryRoot, "manifest.json"), "utf8")
);
const configSource = await readFile(
    path.join(repositoryRoot, "extension-config.js"),
    "utf8"
);
const backgroundSource = await readFile(
    path.join(repositoryRoot, "background.js"),
    "utf8"
);
const contentSource = await readFile(
    path.join(repositoryRoot, "content.js"),
    "utf8"
);
const popupSource = await readFile(
    path.join(repositoryRoot, "popup.js"),
    "utf8"
);

const requiredPermissions = [
    "https://europe-central2-lazylex-9d161.cloudfunctions.net/*",
    "https://firestore.googleapis.com/*",
    "https://identitytoolkit.googleapis.com/*",
    "https://securetoken.googleapis.com/*",
    "https://www.googleapis.com/*"
];

for (const permission of requiredPermissions) {
    if (!manifest.host_permissions.includes(permission)) {
        throw new Error(`Missing host permission: ${permission}`);
    }
}

for (const relativePath of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_page,
    ...manifest.content_scripts.flatMap((entry) => entry.js)
]) {
    await access(path.join(repositoryRoot, relativePath));
}

const prohibitedRuntimeMarkers = [
    "sea-lion-app-ut382.ondigitalocean.app",
    "LAZYLEX_AUTH_FROM_WEBSITE",
    "LAZYLEX_AUTH_FROM_EXTENSION",
    "googleAccessToken: auth_token",
    "welcome.html"
];
const runtimeSource = `${backgroundSource}\n${contentSource}\n${popupSource}`;

for (const marker of prohibitedRuntimeMarkers) {
    if (runtimeSource.includes(marker)) {
        throw new Error(`Prohibited legacy runtime marker remains: ${marker}`);
    }
}

if (!backgroundSource.startsWith('importScripts("extension-config.js");')) {
    throw new Error("The service worker must load the shared deployed-stack configuration");
}

if (!backgroundSource.includes('chrome.runtime.getURL("onboarding.html")')) {
    throw new Error("First install must open the packaged onboarding page");
}

if (!configSource.includes('environment: "deployed"')) {
    throw new Error("The extension configuration must declare the deployed environment");
}

if (/insertAdjacentHTML|\.innerHTML\s*=/.test(popupSource)) {
    throw new Error("Privileged popup rendering must use explicit DOM creation and textContent");
}

if (/window\.addEventListener\(\s*["']message["']/.test(contentSource)) {
    throw new Error("Content scripts must not accept authentication or other state from page messages");
}

const extensionCsp = manifest.content_security_policy?.extension_pages || "";
for (const directive of [
    "default-src 'self'",
    "script-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
]) {
    if (!extensionCsp.includes(directive)) {
        throw new Error(`Missing strict extension CSP directive: ${directive}`);
    }
}

try {
    await access(path.join(repositoryRoot, "server.js"));
    throw new Error("The obsolete development server must not be present");
} catch (error) {
    if (error?.code !== "ENOENT") {
        throw error;
    }
}

console.log("Extension configuration checks passed");
