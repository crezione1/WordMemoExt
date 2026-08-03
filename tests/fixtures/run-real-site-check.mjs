// Real-site verification for #52, acceptance criterion 2.
//
//   npm run build:local
//   node tests/fixtures/run-real-site-check.mjs
//
// Copies the build to a temp directory, adds real-site-probe.js to that COPY's
// manifest as an extra content script (the repository's manifest.json is never
// touched), launches a Chromium with it loaded, and walks the sites named in
// the issue. The probe measures the controls' computed style on each one.
//
// It reads the live web, so unlike run-chrome-style-check.mjs it is not
// deterministic: a site can be slow, redirect, or show an interstitial. Every
// report records the URL and title that actually rendered, so the output says
// what was really measured rather than what was requested.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { access, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(fixtureDirectory, "..", "..");
const buildDirectory = path.join(repositoryRoot, "dist", "lazylex-local");

const SITES = [
    "https://www.google.com/search?q=serendipity+meaning&hl=en",
    "https://github.com/nodejs/node",
    "https://en.wikipedia.org/wiki/Serendipity",
    "https://www.bbc.com/news",
    "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
];

const SCENARIOS = [
    "select-plain-word",
    "select-highlighted-word",
    "click-saved-word",
    "click-translation"
];

async function findChromium() {
    const candidates = [process.env.CHROME_PATH].filter(Boolean);
    const root = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ms-playwright");
    if (root) {
        const { readdir } = await import("node:fs/promises");
        try {
            const entries = await readdir(root);
            entries
                .filter((name) => name.startsWith("chromium-"))
                .sort()
                .reverse()
                .forEach((entry) => candidates.push(path.join(root, entry, "chrome-win", "chrome.exe")));
        } catch {
            // no Playwright cache
        }
    }
    for (const candidate of candidates) {
        try {
            await access(candidate);
            return candidate;
        } catch {
            // next
        }
    }
    throw new Error("No Chromium that accepts --load-extension. Set CHROME_PATH.");
}

// The instrumented copy. Adding the probe here rather than to the repo keeps
// test scaffolding out of anything shippable.
async function buildInstrumentedExtension(harnessOrigin) {
    const directory = await mkdtemp(path.join(tmpdir(), "lazylex-realsite-"));
    await cp(buildDirectory, directory, { recursive: true });

    const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
    manifest.content_scripts.push({
        matches: ["<all_urls>"],
        js: ["real-site-probe.js"],
        run_at: "document_idle"
    });
    await writeFile(
        path.join(directory, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8"
    );

    const probe = await readFile(path.join(fixtureDirectory, "real-site-probe.js"), "utf8");
    await writeFile(
        path.join(directory, "real-site-probe.js"),
        `window.__LAZYLEX_HARNESS__ = ${JSON.stringify(harnessOrigin)};\n${probe}`,
        "utf8"
    );

    return directory;
}

const reports = [];
let selfTestReport = null;
let cursor = 0;

// The first hop is a local page. If the plumbing (instrumented extension +
// probe + reporting channel) is broken, that shows up here rather than being
// misreported as "no site was reachable".
const SELF_TEST = "/selftest";

const SELF_TEST_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>LazyLex harness self-test</title></head>
<body><p>Harness self-test.</p></body></html>`;

const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    response.setHeader("access-control-allow-origin", "*");
    // Chrome's Private Network Access check: a request from a public site to
    // 127.0.0.1 is preflighted and must be explicitly opted into.
    response.setHeader("access-control-allow-private-network", "true");
    response.setHeader("access-control-allow-headers", "content-type");
    response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");

    if (request.method === "OPTIONS") {
        response.writeHead(204).end();
        return;
    }

    if (url.pathname === SELF_TEST) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(SELF_TEST_PAGE);
        return;
    }

    if (url.pathname === "/report" && request.method === "POST") {
        const chunks = [];
        for await (const chunk of request) {
            chunks.push(chunk);
        }
        try {
            const report = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (report.site === "127.0.0.1") {
                selfTestReport = report;
                process.stdout.write("  reported: harness self-test (plumbing works)\n");
            } else {
                reports.push(report);
                process.stdout.write(`  reported: ${report.site}\n`);
            }
        } catch (error) {
            process.stdout.write(`  malformed report: ${error.message}\n`);
        }
        response.writeHead(204).end();
        return;
    }

    if (url.pathname === "/next") {
        const next = SITES[cursor] || "done";
        cursor += 1;
        response.writeHead(200, { "content-type": "text/plain" }).end(next);
        return;
    }

    response.writeHead(404).end();
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

try {
    await access(buildDirectory);
} catch {
    process.stderr.write("Build the extension first: npm run build:local\n");
    process.exit(1);
}

const chromium = await findChromium();
const extensionDirectory = await buildInstrumentedExtension(origin);
const profile = await mkdtemp(path.join(tmpdir(), "lazylex-realsite-profile-"));

process.stdout.write(`Chromium:  ${chromium}\nExtension: ${extensionDirectory}\nHarness:   ${origin}\n\n`);

const browser = spawn(chromium, [
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-search-engine-choice-screen",
    "--window-size=1280,900",
    "--headless=new",
    // Let a public page talk to the harness on 127.0.0.1. The server sends the
    // matching CORS/PNA headers too; both are needed across Chrome versions.
    "--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests",
    `--disable-extensions-except=${extensionDirectory}`,
    `--load-extension=${extensionDirectory}`,
    `${origin}${SELF_TEST}`
], { stdio: "ignore" });

const deadline = Date.now() + 240_000;
while (reports.length < SITES.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
}

browser.kill();
await new Promise((resolve) => server.close(resolve));
await rm(profile, { recursive: true, force: true }).catch(() => {});
await rm(extensionDirectory, { recursive: true, force: true }).catch(() => {});

if (reports.length === 0) {
    process.stderr.write(
        selfTestReport
            ? "The harness self-test reported, so the extension and probe work, but no real site did.\n" +
              "That is a network/reachability problem, not a problem with the change under test.\n"
            : "Nothing reported at all -- the instrumented extension or the reporting channel is broken.\n"
    );
    process.exit(1);
}

// The fixture run already proved the absolute values; here the question is
// only whether any real site changes them. So compare every site against the
// first one that reported.
const reference = reports[0];
const problems = [];

process.stdout.write("\nSites measured:\n");
reports.forEach((report) => {
    process.stdout.write(`  ${report.site.padEnd(20)} ${report.title.slice(0, 58)}\n`);
});

for (const report of reports) {
    if (!report.shadowRootFound) {
        problems.push(`${report.site}: no shadow root`);
        continue;
    }
    if (report.hostAttachedTo !== "HTML") {
        problems.push(`${report.site}: host attached to ${report.hostAttachedTo}`);
    }
    if (report.hostStyle.position !== "fixed") {
        problems.push(`${report.site}: host position ${report.hostStyle.position}`);
    }

    for (const name of SCENARIOS) {
        const scenario = report.scenarios.find((entry) => entry.name === name);
        const referenceScenario = reference.scenarios.find((entry) => entry.name === name);
        if (!scenario || scenario.error) {
            problems.push(`${report.site}/${name}: ${scenario?.error || "missing"}`);
            continue;
        }
        if (!scenario.found) {
            problems.push(`${report.site}/${name}: control never opened`);
            continue;
        }
        if (scenario.stillOpen !== true) {
            problems.push(`${report.site}/${name}: control did not survive its own gesture (#55)`);
        }
        if (scenario.openControlCountAfterSettle !== 1) {
            problems.push(
                `${report.site}/${name}: ${scenario.openControlCountAfterSettle} controls open, expected 1 (#51)`
            );
        }
        if (scenario.lightDomLeaks !== 0) {
            problems.push(`${report.site}/${name}: ${scenario.lightDomLeaks} control(s) in light DOM`);
        }
        if (!scenario.onScreen) {
            problems.push(`${report.site}/${name}: control opened off screen`);
        }
        if (report === reference || !referenceScenario?.style) {
            continue;
        }
        for (const [property, value] of Object.entries(referenceScenario.style)) {
            if (scenario.style[property] !== value) {
                problems.push(
                    `${report.site}/${name}: ${property} = ${JSON.stringify(scenario.style[property])}, ` +
                    `${reference.site} ${JSON.stringify(value)}`
                );
            }
        }
    }
}

process.stdout.write("\nControl geometry per site (width x height, radius, background):\n");
reports.forEach((report) => {
    const cells = SCENARIOS.map((name) => {
        const scenario = report.scenarios.find((entry) => entry.name === name);
        if (!scenario?.style) {
            return `${name}=?`;
        }
        return `${scenario.style.width}x${scenario.style.height}/${scenario.style["border-radius"]}`;
    }).join("  ");
    process.stdout.write(`  ${report.site.padEnd(20)} ${cells}\n`);
});

// #52 criterion 5: #11's delete-button visibility guarantees must still hold,
// specifically on a Google results page. Printed absolutely, not just as
// "same as the other sites".
process.stdout.write("\n#11 delete-button visibility, absolute values per site:\n");
reports.forEach((report) => {
    const scenario = report.scenarios.find((entry) => entry.name === "click-saved-word");
    if (!scenario?.style) {
        return;
    }
    const s = scenario.style;
    process.stdout.write(
        `  ${report.site.padEnd(20)} bg ${s["background-color"]}  ` +
        `border ${s["border-top-width"]} ${s["border-top-style"]} ${s["border-top-color"]}  ` +
        `shadow ${s["box-shadow"]}\n`
    );
});

if (reports.length < SITES.length) {
    process.stdout.write(
        `\nNOTE: ${reports.length}/${SITES.length} sites reported; the rest were not reachable in time.\n`
    );
}

if (problems.length > 0) {
    process.stdout.write(`\nFAILED (${problems.length}):\n`);
    problems.forEach((problem) => process.stdout.write(`  - ${problem}\n`));
    process.exit(1);
}

process.stdout.write(`\nPASS: ${reports.length} real sites, controls identical on every one.\n`);
