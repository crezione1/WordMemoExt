import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import vm from "node:vm";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "..");

test("manifest grants only the deployed integration hosts", async () => {
    const manifest = JSON.parse(
        await readFile(path.join(repositoryRoot, "manifest.json"), "utf8")
    );

    assert.deepEqual(manifest.host_permissions, [
        "https://europe-central2-lazylex-9d161.cloudfunctions.net/*",
        "https://firestore.googleapis.com/*",
        "https://identitytoolkit.googleapis.com/*",
        "https://securetoken.googleapis.com/*",
        "https://www.googleapis.com/*"
    ]);
    assert.equal(manifest.oauth2.scopes.includes("https://www.googleapis.com/auth/datastore"), false);
});

test("content scripts cannot import page-provided authentication tokens", async () => {
    const contentSource = await readFile(
        path.join(repositoryRoot, "content.js"),
        "utf8"
    );

    assert.equal(contentSource.includes("LAZYLEX_AUTH_FROM_WEBSITE"), false);
    assert.doesNotMatch(contentSource, /window\.addEventListener\(\s*["']message["']/);
});

test("the service worker uses the shared deployed configuration", async () => {
    const backgroundSource = await readFile(
        path.join(repositoryRoot, "background.js"),
        "utf8"
    );

    assert.match(backgroundSource, /^importScripts\("extension-config\.js"\);/);
    assert.match(backgroundSource, /functionsBaseUrl/);
    assert.equal(backgroundSource.includes("sea-lion-app-ut382.ondigitalocean.app"), false);
});

test("install and welcome routes use the packaged onboarding page", async () => {
    const backgroundSource = await readFile(
        path.join(repositoryRoot, "background.js"),
        "utf8"
    );

    assert.equal(backgroundSource.includes("welcome.html"), false);
    assert.match(backgroundSource, /chrome\.runtime\.getURL\(["']onboarding\.html["']\)/);
});

test("Google sign-in reports OAuth configuration failures without exposing credentials", async () => {
    const authSource = await readFile(
        path.join(repositoryRoot, "firebase-auth.js"),
        "utf8"
    );
    const popupSource = await readFile(
        path.join(repositoryRoot, "popup.js"),
        "utf8"
    );

    assert.match(authSource, /redirect_uri_mismatch/);
    assert.match(authSource, /chrome\.runtime\?\.id/);
    assert.match(authSource, /getReadableAuthError/);
    assert.match(popupSource, /firebaseAuth\?\.getReadableAuthError/);
    assert.equal(
        popupSource.includes("showNotification('Sign in failed. Please try again.')"),
        false
    );
});

test("onboarding language catalog is complete, searchable, and flag-backed", async () => {
    const source = await readFile(
        path.join(repositoryRoot, "language-catalog.js"),
        "utf8"
    );
    const context = vm.createContext({});
    vm.runInContext(source, context);

    const catalog = context.LazyLexLanguageCatalog;
    const tools = context.LazyLexLanguageTools;

    assert.ok(catalog.length >= 125, "expected the complete supported translation catalog");
    assert.equal(tools.filterLanguages("ukrain")[0].code, "uk");
    assert.equal(tools.filterLanguages("україн")[0].code, "uk");
    assert.equal(tools.filterLanguages("zh-tw")[0].code, "zh-TW");
    assert.ok(catalog.every((language) => tools.countryCodeToFlag(language.countryCode)));
});

test("onboarding keeps the approved demo while adding both language steps", async () => {
    const html = await readFile(path.join(repositoryRoot, "onboarding.html"), "utf8");
    const source = await readFile(path.join(repositoryRoot, "onboarding.js"), "utf8");
    const styles = await readFile(path.join(repositoryRoot, "onboarding.css"), "utf8");

    assert.match(html, /id="totalSteps">5</);
    assert.match(html, /Which language are you learning\?/);
    assert.match(html, /id="nativeLanguageGrid"/);
    assert.match(html, /id="learningLanguageGrid"/);
    assert.match(html, /How LazyLex Works/);
    assert.match(html, /Select Text/);
    assert.match(html, /Click Add Button/);
    assert.match(html, /Word Saved!/);
    assert.match(source, /onboardingDraft/);
    assert.match(source, /options\.html\?from=onboarding/);
    assert.match(styles, /\.goals-grid[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
});

test("settings can return to the exact final onboarding step in the same tab", async () => {
    const optionsHtml = await readFile(path.join(repositoryRoot, "options.html"), "utf8");
    const optionsSource = await readFile(path.join(repositoryRoot, "options.js"), "utf8");

    assert.match(optionsHtml, /id="returnToOnboardingBtn"/);
    assert.match(optionsSource, /onboarding\.html\?step=5&return=1/);
    assert.equal(optionsSource.includes("chrome.tabs.create"), false);
});

test("privileged popup API strings are rendered only through safe DOM APIs", async () => {
    const popupSource = await readFile(path.join(repositoryRoot, "popup.js"), "utf8");
    const popupHtml = await readFile(path.join(repositoryRoot, "popup.html"), "utf8");
    const onboardingHtml = await readFile(path.join(repositoryRoot, "onboarding.html"), "utf8");
    const manifest = JSON.parse(
        await readFile(path.join(repositoryRoot, "manifest.json"), "utf8")
    );

    assert.doesNotMatch(popupSource, /insertAdjacentHTML|\.innerHTML\s*=/);
    assert.match(popupSource, /word\.textContent = String\(item\?\.word/);
    assert.match(popupSource, /translation\.textContent = String\(item\?\.translation/);
    assert.equal(
        [...popupSource.matchAll(/settingsButton\.addEventListener\("click"/g)].length,
        1
    );
    assert.equal(
        [...popupSource.matchAll(/logoutButton\.addEventListener\("click"/g)].length,
        1
    );
    for (const payload of [
        "<img src=x onerror=alert(1)>",
        "<svg/onload=alert(1)>",
        "javascript:alert(1)"
    ]) {
        assert.equal(popupSource.includes(`innerHTML = ${JSON.stringify(payload)}`), false);
    }
    assert.match(`${popupHtml}\n${onboardingHtml}`, /fonts\.googleapis\.com/);
    assert.match(`${popupHtml}\n${onboardingHtml}`, /fonts\.gstatic\.com/);
    assert.match(
        manifest.content_security_policy.extension_pages,
        /default-src 'self'; script-src 'self'; object-src 'none';/
    );
    assert.match(
        manifest.content_security_policy.extension_pages,
        /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/
    );
    assert.match(
        manifest.content_security_policy.extension_pages,
        /font-src 'self' https:\/\/fonts\.gstatic\.com/
    );
    assert.match(manifest.content_security_policy.extension_pages, /base-uri 'none'/);
    assert.match(manifest.content_security_policy.extension_pages, /form-action 'none'/);
});

test("interactive mutations wait for strict authenticated cloud operations", async () => {
    const backgroundSource = await readFile(path.join(repositoryRoot, "background.js"), "utf8");
    const popupSource = await readFile(path.join(repositoryRoot, "popup.js"), "utf8");
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");

    assert.match(backgroundSource, /fetchWithTimeout/);
    assert.match(backgroundSource, /persistWordMutation/);
    assert.match(backgroundSource, /deleteWordMutation/);
    assert.match(backgroundSource, /requireSuccessfulResponse/);
    assert.match(popupSource, /action: "persistWord"/);
    assert.match(popupSource, /action: "deleteWord"/);
    assert.match(contentSource, /action: "persistWord"/);
    assert.equal(contentSource.includes("translateWithTAS fallback"), false);
    assert.match(popupSource, /"firebase_refresh_token"/);
    assert.match(popupSource, /await chrome\.storage\.local\.remove\(localAuthKeys\)/);
});

test("multi-word page encounters and link-hosted highlights remain actionable", async () => {
    const backgroundSource = await readFile(path.join(repositoryRoot, "background.js"), "utf8");
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");

    assert.match(backgroundSource, /function getChangedWords/);
    assert.match(backgroundSource, /for \(const \{ operation, word: changedWord \} of changedWords\)/);
    const classifierSource = backgroundSource.match(
        /function getChangedWords[\s\S]*?(?=\nasync function handleWordsChange)/
    )?.[0];
    assert.ok(classifierSource, "expected the word-change classifier");
    const context = vm.createContext({});
    vm.runInContext(classifierSource, context);
    const changes = context.getChangedWords({
        oldValue: [
            { id: 1, word: "first", encounterCount: 1 },
            { id: 2, word: "second", encounterCount: 1 }
        ],
        newValue: [
            { id: 1, word: "first", encounterCount: 2 },
            { id: 2, word: "second", encounterCount: 3 }
        ]
    });
    assert.deepEqual(
        JSON.parse(JSON.stringify(changes)),
        [
            { operation: "update", word: { id: 1, word: "first", encounterCount: 2 } },
            { operation: "update", word: { id: 2, word: "second", encounterCount: 3 } }
        ]
    );
    assert.match(contentSource, /wrapper\?\.closest\(["']a\[href\]["']\)/);
    assert.match(contentSource, /e\.preventDefault\(\)/);
});

test("highlighting skips unsafe page nodes and uses exact exclusion matching", async () => {
    const backgroundSource = await readFile(path.join(repositoryRoot, "background.js"), "utf8");
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");

    assert.match(contentSource, /script, style, noscript, textarea, input, select/);
    assert.match(contentSource, /\[contenteditable\]/);
    assert.match(contentSource, /createTreeWalker/);
    assert.match(backgroundSource, /hostname\.endsWith\(`\.\$\{normalizedDomain\}`\)/);
    assert.equal(backgroundSource.includes("hostname.includes(domain)"), false);
});

test("frequency tiers and the minimalistic settings switch are wired", async () => {
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");
    const optionsSource = await readFile(path.join(repositoryRoot, "options.js"), "utf8");
    const optionsHtml = await readFile(path.join(repositoryRoot, "options.html"), "utf8");
    const popupSource = await readFile(path.join(repositoryRoot, "popup.js"), "utf8");
    const styles = await readFile(path.join(repositoryRoot, "styles.css"), "utf8");

    assert.match(contentSource, /count > 200/);
    assert.match(contentSource, /count > 120/);
    assert.match(contentSource, /count > 50/);
    assert.match(contentSource, /frequencyColoringEnabled === false/);
    assert.match(contentSource, /status: learned \? "learned"/);
    assert.match(popupSource, /case 'learned':/);
    assert.match(styles, /\.lazylex-frequency-new::after[\s\S]*#111827/);
    assert.match(styles, /\.lazylex-frequency-familiar::after[\s\S]*#667085/);
    assert.match(styles, /\.lazylex-frequency-retained::after[\s\S]*#cbd5e1/);
    assert.match(optionsHtml, /id="frequencyColoringToggle"/);
    assert.match(optionsSource, /frequencyColoringEnabled/);
    assert.match(optionsSource, /highlightColor: selectedHighlightColor/);
    assert.match(optionsSource, /translationColor: selectedTranslationColor/);
});

test("popup identity placeholders and settings language values are safe", async () => {
    const popupHtml = await readFile(path.join(repositoryRoot, "popup.html"), "utf8");
    const optionsHtml = await readFile(path.join(repositoryRoot, "options.html"), "utf8");
    const authSource = await readFile(path.join(repositoryRoot, "firebase-auth.js"), "utf8");

    assert.doesNotMatch(popupHtml, /oksanarymyk\.work@gmail\.com|>@telegram</);
    assert.match(popupHtml, /id="userEmail">Not available</);
    assert.match(popupHtml, /id="userTelegram">Not connected</);
    assert.match(authSource, /\.\.\.\(result\.user_info \|\| \{\}\)/);
    assert.match(authSource, /\.\.\.\(result\.userInfo \|\| \{\}\)/);
    assert.match(optionsHtml, /<option value="uk" selected>Ukrainian</);
    assert.match(optionsHtml, /<option value="pl">Polish</);
    const languageSelect = optionsHtml.match(
        /<select id="translateTo"[\s\S]*?<\/select>/
    )?.[0] || "";
    assert.equal(
        [...languageSelect.matchAll(/<option[^>]+selected/g)].length,
        1
    );
});

test("sentence selections are classified distinctly from words/phrases and gated to premium", async () => {
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");
    const backgroundSource = await readFile(path.join(repositoryRoot, "background.js"), "utf8");
    const popupSource = await readFile(path.join(repositoryRoot, "popup.js"), "utf8");

    // Pure classifier: extract and execute it directly (same no-DOM-
    // dependency style as the getChangedWords/YouTube-navigation tests).
    const classifierSource = contentSource.match(
        /function classifySelectionType\(text\)[\s\S]*?\r?\n}\r?\n/
    )?.[0];
    assert.ok(classifierSource, "expected the selection classifier");
    const context = vm.createContext({});
    vm.runInContext(classifierSource, context);

    assert.equal(context.classifySelectionType("dog"), "word");
    assert.equal(context.classifySelectionType("New York City"), "phrase");
    assert.equal(
        context.classifySelectionType("This is a full sentence with several words in it."),
        "sentence"
    );
    assert.equal(
        context.classifySelectionType("Short but ends with punctuation right here."),
        "sentence"
    );
    assert.equal(context.classifySelectionType(""), null);
    assert.equal(context.classifySelectionType("   "), null);

    // Word selection keeps using the existing "+"/runLogic path; sentence
    // selection is a distinct control/handler and never calls runLogic or
    // translateWithTAS.
    assert.match(contentSource, /button\.id = "add-new-sentence"/);
    assert.match(contentSource, /handleSentenceSelection\(selectedText\)/);
    assert.match(contentSource, /async function handleSentenceSelection\(rawText\)/);
    const sentenceHandlerSource = contentSource.match(
        /async function handleSentenceSelection\(rawText\)[\s\S]*?\r?\n}\r?\n/
    )?.[0];
    assert.ok(sentenceHandlerSource, "expected the sentence selection handler");
    assert.doesNotMatch(sentenceHandlerSource, /runLogic\(|translateWithTAS\(/);
    assert.match(sentenceHandlerSource, /action: "getSubscriptionStatus"/);
    assert.match(sentenceHandlerSource, /action: "translateSentence"/);
    assert.match(sentenceHandlerSource, /showSentencePremiumNotification\(\)/);
    assert.match(contentSource, /SENTENCE_MAX_LENGTH = 500/);

    // Background: a distinct callable/action from translateWord, entitlement
    // checked before any network call, and storage kept out of the shared
    // words/translations/lexicon paths.
    assert.match(backgroundSource, /async function translateSentenceMutation\(text, targetLanguage\)/);
    const translateSentenceSource = backgroundSource.match(
        /async function translateSentenceMutation\(text, targetLanguage\)[\s\S]*?\r?\n}\r?\n/
    )?.[0];
    assert.ok(translateSentenceSource, "expected the sentence translation mutation");
    assert.match(translateSentenceSource, /getSubscriptionStatus\(\)/);
    assert.match(translateSentenceSource, /code: "entitlement"/);
    assert.match(translateSentenceSource, /\$\{functionsBaseUrl\}\/translateSentence/);
    assert.doesNotMatch(translateSentenceSource, /\/translateWord/);
    assert.match(backgroundSource, /users\/\$\{uid\}\/sentences/);
    assert.doesNotMatch(backgroundSource, /sentences.*translations\/|translations\/.*sentences/);
    assert.match(backgroundSource, /request\.action === "translateSentence"/);
    assert.match(backgroundSource, /request\.action === "deleteSentence"/);
    assert.match(backgroundSource, /request\.action === "getSubscriptionStatus"/);

    // Popup: separate list/render path from the word dictionary, and
    // sentences are cleared on logout alongside other per-account data.
    assert.match(popupSource, /function renderSentences\(sentences\)/);
    assert.doesNotMatch(popupSource, /sentences\.concat\(words\)|words\.concat\(sentences\)/);
    assert.match(popupSource, /"sentences",\s*\n\s*"sentencesOwnerUid"/);
});

test("YouTube SPA navigation is detected and reprocessed exactly once per video change", async () => {
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");

    assert.match(contentSource, /yt-navigate-start/);
    assert.match(contentSource, /yt-navigate-finish/);
    assert.match(contentSource, /addEventListener\("popstate"/);
    assert.match(contentSource, /youtubeNavigationHandlersInstalled/);
    assert.match(contentSource, /resyncHighlightsForCurrentPage/);
    assert.match(contentSource, /clearHighlighting\(\);/);

    // installYouTubeNavigationHandlers must be guarded so it can be called
    // more than once (e.g. re-entrant script evaluation) without attaching
    // duplicate listeners or re-wrapping history.pushState twice.
    const installerSource = contentSource.match(
        /function installYouTubeNavigationHandlers\(\)[\s\S]*?\r?\n}\r?\n/
    )?.[0];
    assert.ok(installerSource, "expected the navigation-handler installer");
    assert.match(installerSource, /if \(youtubeNavigationHandlersInstalled/);

    const pureLogicSource = contentSource.match(
        /const YOUTUBE_HOSTNAMES[\s\S]*?(?=\nlet lastProcessedYouTubeVideoId)/
    )?.[0];
    assert.ok(pureLogicSource, "expected the pure YouTube navigation-decision helpers");

    const context = vm.createContext({ URL });
    vm.runInContext(pureLogicSource, context);

    const videoOne = "https://www.youtube.com/watch?v=aaaaaaaaaaa&list=PL1";
    const videoTwo = "https://www.youtube.com/watch?v=bbbbbbbbbbb&list=PL1";

    // First transition into a watch page: treated as a new video.
    const first = context.isNewYouTubeNavigation(null, videoOne);
    assert.equal(first.isNewVideo, true);
    assert.equal(first.videoId, "aaaaaaaaaaa");

    // Switching to a second, different video id is also a new navigation.
    const second = context.isNewYouTubeNavigation(first.videoId, videoTwo);
    assert.equal(second.isNewVideo, true);
    assert.equal(second.videoId, "bbbbbbbbbbb");

    // Re-triggering on the same video (e.g. the interval fallback firing
    // again, or yt-navigate-finish plus a pushState hook both firing for
    // the same transition) must not be treated as another navigation, so
    // the new title is processed exactly once.
    const repeat = context.isNewYouTubeNavigation(second.videoId, videoTwo);
    assert.equal(repeat.isNewVideo, false);

    // Non-YouTube and non-watch URLs never trigger a reprocess.
    assert.equal(context.getYouTubeVideoIdFromUrl("https://example.com/watch?v=zzz"), null);
    assert.equal(context.getYouTubeVideoIdFromUrl("https://www.youtube.com/"), null);
    assert.equal(
        context.getYouTubeVideoIdFromUrl("https://www.youtube.com/shorts/ccccccccccc"),
        "ccccccccccc"
    );
});

test("obsolete development server and runtime dependencies are removed", async () => {
    const packageJson = JSON.parse(
        await readFile(path.join(repositoryRoot, "package.json"), "utf8")
    );
    await assert.rejects(
        readFile(path.join(repositoryRoot, "server.js"), "utf8"),
        { code: "ENOENT" }
    );
    assert.deepEqual(packageJson.dependencies || {}, {});
    assert.deepEqual(packageJson.devDependencies || {}, {});
});

test("CI verifies security checks, tests, and the unpacked package", async () => {
    const workflow = await readFile(
        path.join(repositoryRoot, ".github", "workflows", "extension-ci.yml"),
        "utf8"
    );

    assert.match(workflow, /npm audit --omit=dev --audit-level=high/);
    assert.match(workflow, /npm run check/);
    assert.match(workflow, /npm test/);
    assert.match(workflow, /npm run build/);
    assert.match(workflow, /Smoke-check unpacked package/);
});
