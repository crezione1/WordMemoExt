// Real-Chrome verification for #52.
//
//   npm run build:local
//   node tests/fixtures/run-chrome-style-check.mjs
//
// Serves the hostile fixtures over http, launches a real Chrome with the built
// unpacked extension loaded into a throwaway profile, lets probe.js drive every
// control on every fixture, and then asserts that the *computed* style of each
// control is identical across all of them.
//
// This is deliberately not part of `node --test tests/`: it needs a Chrome
// binary and a built dist/, neither of which the unit suite should depend on.
// It is the evidence behind acceptance criteria 1, 3 and 4, which cannot be
// established by reading source.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(fixtureDirectory, "..", "..");
const extensionDirectory = path.join(repositoryRoot, "dist", "lazylex-local");

const FIXTURES = ["baseline.html", "unset.html", "reshape.html", "big-root.html", "reset.html"];
const BASELINE = FIXTURES[0];

// Every scenario the probe runs, and the control each one is expected to open.
const EXPECTED_SCENARIOS = [
    "select-plain-word",
    "select-sentence",
    "select-highlighted-word",
    "click-saved-word",
    "click-translation",
    "editor-save-button"
];

// Branded Google Chrome 137+ refuses --load-extension outright
// ("--load-extension is not allowed in Google Chrome, ignoring", and the same
// for --disable-extensions-except), and no command-line flag re-enables it on
// the stable channel. So an unbranded Chromium build is required to load an
// unpacked extension from the command line. Chromium is the same Blink engine
// and the same style/cascade implementation, which is all this check measures.
//
// Set CHROME_PATH to point at any Chromium-based binary that still accepts the
// switch (Chrome for Testing, Chromium, a Playwright/Puppeteer download).
const CHROME_CANDIDATES = [
    process.env.CHROME_PATH,
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1181/chrome-win/chrome.exe`,
    "C:/Program Files/Chromium/Application/chrome.exe",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
].filter(Boolean);

async function findChromiumFromPlaywright() {
    const root = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ms-playwright");
    if (!root) {
        return null;
    }
    try {
        const { readdir } = await import("node:fs/promises");
        const entries = await readdir(root);
        for (const entry of entries.filter((name) => name.startsWith("chromium-")).sort().reverse()) {
            const candidate = path.join(root, entry, "chrome-win", "chrome.exe");
            try {
                await access(candidate);
                return candidate;
            } catch {
                // keep looking
            }
        }
    } catch {
        // no Playwright cache
    }
    return null;
}

async function findChrome() {
    for (const candidate of CHROME_CANDIDATES) {
        try {
            await access(candidate);
            return candidate;
        } catch {
            // try the next one
        }
    }

    const playwrightChromium = await findChromiumFromPlaywright();
    if (playwrightChromium) {
        return playwrightChromium;
    }

    throw new Error(
        "Could not find a Chromium build that accepts --load-extension.\n" +
        "Branded Google Chrome 137+ rejects the switch, so set CHROME_PATH to a\n" +
        "Chrome for Testing / Chromium / Playwright binary. Tried:\n  " +
        CHROME_CANDIDATES.join("\n  ")
    );
}

const CONTENT_TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

function startServer(reports) {
    return new Promise((resolve) => {
        const server = createServer(async (request, response) => {
            const url = new URL(request.url, "http://127.0.0.1");

            if (request.method === "POST" && url.pathname === "/report") {
                const chunks = [];
                for await (const chunk of request) {
                    chunks.push(chunk);
                }
                try {
                    const report = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                    reports.set(report.fixture, report);
                    process.stdout.write(`  reported: ${report.fixture}\n`);
                } catch (error) {
                    process.stdout.write(`  malformed report: ${error.message}\n`);
                }
                response.writeHead(204).end();
                return;
            }

            if (url.pathname === "/done") {
                response.writeHead(200, { "content-type": "text/html" }).end("<h1>done</h1>");
                return;
            }

            const name = url.pathname === "/" ? `/${BASELINE}` : url.pathname;
            try {
                const body = await readFile(path.join(fixtureDirectory, path.basename(name)));
                response
                    .writeHead(200, { "content-type": CONTENT_TYPES[path.extname(name)] || "text/plain" })
                    .end(body);
            } catch {
                response.writeHead(404).end("not found");
            }
        });

        server.listen(0, "127.0.0.1", () => resolve(server));
    });
}

async function collect({ chrome, port, headless }) {
    const reports = new Map();
    const server = await startServer(reports);
    const actualPort = server.address().port;
    const profile = await mkdtemp(path.join(tmpdir(), "lazylex-fixture-"));

    const args = [
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--disable-search-engine-choice-screen",
        "--window-size=1280,900",
        // Chrome 137+ ignores --load-extension unless this feature is turned
        // off. Without it the browser starts perfectly happily with no
        // extension at all, which looks exactly like a broken content script.
        "--disable-features=DisableLoadExtensionCommandLineSwitch",
        `--disable-extensions-except=${extensionDirectory}`,
        `--load-extension=${extensionDirectory}`
    ];
    if (headless) {
        args.unshift("--headless=new");
    }
    args.push(`http://127.0.0.1:${actualPort}/${BASELINE}`);

    process.stdout.write(`\nLaunching Chrome (${headless ? "headless" : "headful"})...\n`);
    const browser = spawn(chrome, args, { stdio: "ignore" });

    const deadline = Date.now() + 90_000;
    while (reports.size < FIXTURES.length && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    browser.kill();
    await new Promise((resolve) => server.close(resolve));
    await rm(profile, { recursive: true, force: true }).catch(() => {});

    return reports;
}

function compare(reports) {
    const problems = [];
    const baseline = reports.get(BASELINE);

    if (!baseline) {
        problems.push(`no report from the baseline fixture (${BASELINE})`);
        return problems;
    }

    for (const fixture of FIXTURES) {
        const report = reports.get(fixture);
        if (!report) {
            problems.push(`${fixture}: no report`);
            continue;
        }
        if (!report.extensionCssApplied) {
            problems.push(
                `${fixture}: the extension's own stylesheet was never injected -- the browser ` +
                `did not load dist/lazylex-local at all (branded Chrome ignores --load-extension; ` +
                `set CHROME_PATH to a Chromium build)`
            );
        }
        if (!report.shadowRootFound) {
            problems.push(`${fixture}: no shadow root -- the control layer was never created`);
        }
        if (report.hostAttachedTo !== "HTML") {
            problems.push(`${fixture}: shadow host attached to ${report.hostAttachedTo}, expected HTML`);
        }
        if (report.hostStyle.position !== "fixed") {
            problems.push(`${fixture}: host position resolved to ${report.hostStyle.position}, expected fixed`);
        }
        if (report.hostStyle["pointer-events"] !== "none") {
            problems.push(`${fixture}: host pointer-events resolved to ${report.hostStyle["pointer-events"]}`);
        }
        report.errors.forEach((error) => problems.push(`${fixture}: page error: ${error}`));

        // #51's dismissal contract under shadow retargeting.
        const dismissal = report.scenarios.find((entry) => entry.name === "dismissal")?.dismissal;
        if (!dismissal) {
            problems.push(`${fixture}: no dismissal report`);
        } else {
            const expectations = {
                clickInsideKeepsItOpen:
                    "a click inside the control dismissed it -- outside-click detection is reading " +
                    "the retargeted event.target instead of composedPath() (#52 breaking #51)",
                escapeClosesIt: "Escape did not close the open control (#51)",
                translationRestored: "the editor's teardown left the translation hidden (#51, criterion 7)",
                reopenedForOutsideClick: "could not reopen a control for the outside-click check",
                outsideClickClosesIt: "an outside click did not close the open control (#51)"
            };
            for (const [key, message] of Object.entries(expectations)) {
                if (dismissal[key] !== true) {
                    problems.push(`${fixture}/dismissal: ${message}`);
                }
            }
        }

        for (const name of EXPECTED_SCENARIOS) {
            const scenario = report.scenarios.find((entry) => entry.name === name);
            if (!scenario) {
                problems.push(`${fixture}/${name}: scenario missing`);
                continue;
            }
            if (scenario.error) {
                problems.push(`${fixture}/${name}: ${scenario.error}`);
                continue;
            }
            if (!scenario.found) {
                problems.push(`${fixture}/${name}: control never opened`);
                continue;
            }
            if (!scenario.onScreen) {
                problems.push(`${fixture}/${name}: control opened off screen (box ${JSON.stringify(scenario.box)})`);
            }

            // Whole-gesture invariants (#51 + #55), re-checked after the shadow
            // migration because retargeting changes what "clicked outside"
            // means.
            if (name !== "editor-save-button") {
                if (scenario.stillOpen !== true) {
                    problems.push(`${fixture}/${name}: control did not survive its own gesture (#55)`);
                }
                if (scenario.openControlCount !== 1 || scenario.openControlCountAfterSettle !== 1) {
                    problems.push(
                        `${fixture}/${name}: expected exactly one open control, saw ` +
                        `${scenario.openControlCount} then ${scenario.openControlCountAfterSettle} (#51)`
                    );
                }
                if (scenario.lightDomLeaks !== 0) {
                    problems.push(`${fixture}/${name}: ${scenario.lightDomLeaks} control(s) leaked into light DOM`);
                }
            }

            // The heart of #52: identical computed style everywhere.
            if (fixture === BASELINE) {
                continue;
            }
            const reference = baseline.scenarios.find((entry) => entry.name === name);
            if (!reference?.style) {
                continue;
            }
            for (const [property, value] of Object.entries(reference.style)) {
                if (scenario.style[property] !== value) {
                    problems.push(
                        `${fixture}/${name}: ${property} = ${JSON.stringify(scenario.style[property])}, ` +
                        `baseline ${JSON.stringify(value)}`
                    );
                }
            }
            if (JSON.stringify(scenario.box) !== JSON.stringify(reference.box)) {
                problems.push(
                    `${fixture}/${name}: rendered box ${JSON.stringify(scenario.box)}, ` +
                    `baseline ${JSON.stringify(reference.box)}`
                );
            }
        }
    }

    return problems;
}

function printSummary(reports) {
    const baseline = reports.get(BASELINE);
    if (!baseline) {
        return;
    }

    process.stdout.write("\nComputed style, identical across all fixtures:\n");
    for (const name of EXPECTED_SCENARIOS) {
        const scenario = baseline.scenarios.find((entry) => entry.name === name);
        if (!scenario?.style) {
            continue;
        }
        const s = scenario.style;
        process.stdout.write(
            `  ${name.padEnd(24)} ${s.width}x${s.height}  radius ${s["border-radius"]}  ` +
            `bg ${s["background-color"]}  fg ${s.color}\n` +
            `  ${"".padEnd(24)} font ${s["font-family"].split(",")[0]} ${s["font-size"]}/${s["line-height"]}  ` +
            `transform ${s["text-transform"]}  spacing ${s["letter-spacing"]}  pad ${s["padding-top"]}\n`
        );
    }

    process.stdout.write("\nWhole-gesture behaviour (one control open, survives its own click):\n");
    for (const fixture of FIXTURES) {
        const report = reports.get(fixture);
        if (!report) {
            continue;
        }
        const cells = report.scenarios
            .filter((entry) => entry.name !== "editor-save-button" && entry.name !== "dismissal")
            .map((entry) => `${entry.name}=${entry.openControlCountAfterSettle}${entry.stillOpen ? "" : "!"}`)
            .join("  ");
        process.stdout.write(`  ${fixture.padEnd(16)} ${cells}\n`);
    }

    process.stdout.write("\n#51 dismissal contract under shadow retargeting:\n");
    for (const fixture of FIXTURES) {
        const dismissal = reports.get(fixture)?.scenarios.find((entry) => entry.name === "dismissal")?.dismissal;
        if (!dismissal) {
            continue;
        }
        const cells = Object.entries(dismissal)
            .map(([key, value]) => `${key}=${value}`)
            .join("  ");
        process.stdout.write(`  ${fixture.padEnd(16)} ${cells}\n`);
    }
}

try {
    await access(extensionDirectory);
} catch {
    process.stderr.write(`Build the extension first: npm run build:local\n(missing ${extensionDirectory})\n`);
    process.exit(1);
}

const chrome = await findChrome();
process.stdout.write(`Chrome:    ${chrome}\nExtension: ${extensionDirectory}\n`);

let reports = await collect({ chrome, headless: process.env.HEADFUL !== "1" });
if (reports.size === 0 && process.env.HEADFUL !== "1") {
    process.stdout.write("\nNo reports in headless mode; retrying headful.\n");
    reports = await collect({ chrome, headless: false });
}

const problems = compare(reports);
printSummary(reports);

if (problems.length > 0) {
    process.stdout.write(`\nFAILED (${problems.length}):\n`);
    problems.forEach((problem) => process.stdout.write(`  - ${problem}\n`));
    process.exit(1);
}

process.stdout.write(
    `\nPASS: ${reports.size}/${FIXTURES.length} fixtures, ` +
    `${EXPECTED_SCENARIOS.length} controls each, computed styles identical.\n`
);
