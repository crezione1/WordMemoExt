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

test("onboarding keeps the 5-step flow with both language steps", async () => {
    const html = await readFile(path.join(repositoryRoot, "onboarding.html"), "utf8");
    const source = await readFile(path.join(repositoryRoot, "onboarding.js"), "utf8");
    const styles = await readFile(path.join(repositoryRoot, "onboarding.css"), "utf8");

    assert.match(html, /id="totalSteps">5</);
    assert.match(html, /Which language are you learning\?/);
    assert.match(html, /id="nativeLanguageGrid"/);
    assert.match(html, /id="learningLanguageGrid"/);
    assert.match(html, /How LazyLex Works/);
    assert.match(source, /onboardingDraft/);
    assert.match(source, /options\.html\?from=onboarding/);
    assert.match(styles, /\.goals-grid[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
});

test("onboarding restores the approved 40e2a75 interactive 'How LazyLex Works' demo (#24)", async () => {
    const html = await readFile(path.join(repositoryRoot, "onboarding.html"), "utf8");
    const source = await readFile(path.join(repositoryRoot, "onboarding.js"), "utf8");
    const styles = await readFile(path.join(repositoryRoot, "onboarding.css"), "utf8");

    // The static three-card placeholder and its approval gate are gone.
    assert.equal(html.includes("intentionally preserved pending #24 approval"), false);
    assert.equal(html.includes("Click Add Button"), false);
    assert.equal(html.includes("Word Saved!"), false);

    // Branded simulated-browser chrome with traffic-light dots and a toolbar.
    assert.match(html, /class="browser-window"/);
    assert.match(html, /browser-dot red/);
    assert.match(html, /browser-dot yellow/);
    assert.match(html, /browser-dot green/);
    assert.match(html, /id="extIcon"/);

    // A selectable word inside realistic body copy, the orange "+" save
    // action, the flying-word animation target, the saved/translated
    // state, and the explicit success message.
    assert.match(html, /class="selectable-word" data-word="improve" data-translation="покращувати"/);
    assert.match(html, /id="addWordBtn"/);
    assert.match(html, /id="animationOverlay"/);
    assert.match(html, /id="demoCompletion"/);
    assert.match(html, /successfully saved a word/);

    assert.match(source, /function animateWordToExtension/);
    assert.match(source, /flying-clone/);
    assert.match(source, /function resetHowItWorksDemo/);
    assert.match(source, /demoState\.isCompleted/);
    // Next is gated on actually completing the demo, matching the approved variant.
    assert.match(source, /4: demoState\.isCompleted/);

    assert.match(styles, /\.flying-clone\s*\{[\s\S]*?background:\s*#ff6b35/);
    assert.match(styles, /\.action-button\s*\{[\s\S]*?background-color:\s*#ff6b35/);
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

// Reads the shadow-root control stylesheet out of content.js. Since #52 this,
// not styles.css, is where every control rule lives.
async function readControlStylesheet() {
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");
    const stylesheet = contentSource.match(/const CONTROL_STYLESHEET = `([\s\S]*?)`;/)?.[1];
    assert.ok(stylesheet, "expected the CONTROL_STYLESHEET constant in content.js");
    return stylesheet;
}

function readRuleBlock(stylesheet, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const block = stylesheet.match(new RegExp(`${escaped}\\s*\\{[\\s\\S]*?\\}`))?.[0];
    assert.ok(block, `expected a "${selector}" rule block`);
    return block;
}

// Comments in styles.css explain what moved into the shadow root and name the
// selectors that used to live there, so "is this selector still styled here?"
// has to be asked of the declarations only.
function stripCssComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

test("delete and add-word buttons keep #11's visibility guarantees inside the shadow root", async () => {
    const stylesheet = await readControlStylesheet();

    // The properties are the same ones #11 pinned; what changed is that they
    // no longer need `!important`, because no host-page selector can match
    // inside a shadow root. An `!important` here would be a sign the controls
    // had drifted back into light DOM.
    const actionButtonBlock = readRuleBlock(stylesheet, ".action-button");
    assert.match(actionButtonBlock, /width:\s*24px;/);
    assert.match(actionButtonBlock, /height:\s*24px;/);
    assert.match(actionButtonBlock, /background-color:\s*#ff6b35;/);
    assert.match(actionButtonBlock, /border:\s*none;/);
    assert.match(actionButtonBlock, /border-radius:\s*50%;/);
    assert.match(actionButtonBlock, /color:\s*#ffffff;/);
    assert.match(actionButtonBlock, /cursor:\s*pointer;/);

    const deleteButtonBlock = readRuleBlock(stylesheet, "#deleteWordBtn");
    assert.match(deleteButtonBlock, /width:\s*32px;/);
    assert.match(deleteButtonBlock, /height:\s*32px;/);
    assert.match(deleteButtonBlock, /background-color:\s*#c4320a;/);
    assert.match(deleteButtonBlock, /border:\s*2px solid #ffffff;/);
    assert.match(deleteButtonBlock, /box-shadow:\s*0 2px 8px rgba\(0, 0, 0, 0\.28\);/);

    assert.equal(
        stylesheet.includes("!important"),
        false,
        "a shadow-root stylesheet must not need !important; its presence means a control leaked back into light DOM"
    );

    // styles.css is injected into the page and must no longer carry control
    // rules -- that is the whole point of #52.
    const styles = stripCssComments(
        await readFile(path.join(repositoryRoot, "styles.css"), "utf8")
    );
    for (const deadSelector of [".action-button", "#deleteWordBtn", ".edit-translation-input", "#add-new-word"]) {
        assert.equal(
            styles.includes(deadSelector),
            false,
            `${deadSelector} must not be styled in the page-injected stylesheet any more`
        );
    }
});

test("the widget controls are style-isolated in a shadow root (#52)", async () => {
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");
    const stylesheet = await readControlStylesheet();

    // The root of the fix.
    assert.match(contentSource, /attachShadow\(\{ mode: "open" \}\)/);

    // Inheritance crosses a shadow boundary, so it has to be cut at the host
    // *and* the inherited properties have to be declared explicitly. Either
    // one alone leaves the controls picking up the page's typography.
    assert.match(contentSource, /\["all", "initial"\]/);
    const resetBlock = stylesheet.match(/\*,\s*\*::before,\s*\*::after\s*\{[\s\S]*?\}/)?.[0];
    assert.ok(resetBlock, "expected the universal reset block in the control stylesheet");
    for (const property of [
        "font-family",
        "font-size",
        "font-weight",
        "font-style",
        "line-height",
        "letter-spacing",
        "word-spacing",
        "text-transform",
        "text-indent",
        "white-space",
        "direction",
        "box-sizing"
    ]) {
        assert.match(
            resetBlock,
            new RegExp(`\\n\\s*${property}:`),
            `the control reset must declare ${property} rather than inherit it from the host page (#52, criterion 4)`
        );
    }

    // The host is light DOM. Inline `!important` is what protects it: a
    // style-attribute important declaration outranks any author important rule
    // the page can write.
    const hostStyleBlock = contentSource.match(/const CONTROL_HOST_STYLE = \[[\s\S]*?\];/)?.[0];
    assert.ok(hostStyleBlock, "expected the CONTROL_HOST_STYLE constant");
    assert.match(contentSource, /setProperty\(property, value, "important"\)/);
    for (const property of ["position", "top", "left", "pointer-events", "z-index"]) {
        assert.ok(
            hostStyleBlock.includes(`["${property}"`),
            `the shadow host must pin ${property} inline`
        );
    }
    // `all: initial` expands to every longhand, so it has to come first or it
    // would wipe the geometry declared after it.
    assert.equal(
        hostStyleBlock.indexOf('["all", "initial"]') < hostStyleBlock.indexOf('["position", "fixed"]'),
        true,
        "`all: initial` must be applied before the geometry it would otherwise reset"
    );

    // The translation editor was the control with no protection at all in
    // light DOM (#52, criterion 3); it must be mounted into the layer too.
    const editUiSource = contentSource.match(
        /function showEditUI\(translationSpan, wordId\)[\s\S]*?\r?\n\}\r?\n/
    )?.[0];
    assert.ok(editUiSource, "expected showEditUI");
    assert.match(editUiSource, /mountControl\(editContainer, \{/);
    assert.doesNotMatch(editUiSource, /insertBefore\(editContainer/);
    // The anchor rect has to be read before the span is hidden, or the editor
    // would be positioned from a collapsed rect.
    assert.equal(
        editUiSource.indexOf("translationSpan.getBoundingClientRect()") <
            editUiSource.indexOf("translationSpan.style.display = 'none'"),
        true,
        "the editor's anchor rect must be captured before the translation span is hidden"
    );

    // The highlight deliberately stays in light DOM and keeps its defensive
    // rules -- it is inline inside the page's own text.
    const styles = stripCssComments(
        await readFile(path.join(repositoryRoot, "styles.css"), "utf8")
    );
    assert.match(styles, /\.highlight-wrapper \{/);
    assert.match(styles, /\.highlighted-word \{/);
});

test("outside-click detection reads composedPath, not the retargeted target (#52 vs #51)", async () => {
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");

    assert.match(contentSource, /function isWidgetControlEvent\(event\) \{[\s\S]*?composedPath\(\)/);

    // The two document-level handlers that dismiss on interaction are exactly
    // where using event.target would make the widget close on its own first
    // click, because the shadow root retargets the event to the host.
    for (const [name, pattern] of [
        ["mouseup", /document\.addEventListener\("mouseup", function \(event\) \{[\s\S]*?\r?\n\}\);/],
        ["click", /document\.addEventListener\("click", \(e\) => \{[\s\S]*?\r?\n\}\);/]
    ]) {
        const handler = contentSource.match(pattern)?.[0];
        assert.ok(handler, `expected the ${name} handler`);
        assert.match(handler, /isWidgetControlEvent\(/);
        assert.doesNotMatch(
            handler,
            /isWidgetControlNode\((?:event|e)\.target\)/,
            `${name} must not test the retargeted event.target once the controls are in a shadow root`
        );
    }
});

test("control sizes agree with the control stylesheet (#52, criterion 6)", async () => {
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");
    const stylesheet = await readControlStylesheet();

    const readConstant = (name) => {
        const value = contentSource.match(new RegExp(`const ${name} = (\\d+);`))?.[1];
        assert.ok(value, `expected the ${name} constant`);
        return Number(value);
    };

    // The clamp maths uses these instead of measuring, so a drift between the
    // constant and the CSS would silently mis-place a control.
    assert.match(readRuleBlock(stylesheet, ".action-button"), new RegExp(`width:\\s*${readConstant("ACTION_BUTTON_SIZE")}px;`));
    assert.match(readRuleBlock(stylesheet, "#deleteWordBtn"), new RegExp(`width:\\s*${readConstant("DELETE_BUTTON_SIZE")}px;`));
    assert.match(readRuleBlock(stylesheet, ".edit-translation-input"), new RegExp(`width:\\s*${readConstant("EDIT_INPUT_WIDTH")}px;`));

    // The 24px/32px difference is deliberate (#11 made the delete button
    // bigger so it stays findable); criterion 6 asks for it to be justified
    // rather than silently different.
    assert.notEqual(readConstant("ACTION_BUTTON_SIZE"), readConstant("DELETE_BUTTON_SIZE"));
    assert.match(
        stylesheet,
        /Deliberately larger than the other controls[\s\S]*?#11/,
        "the delete button's larger size must carry the reason it is larger"
    );
});

test("every control is positioned by one rule in viewport coordinates (#52, criterion 7)", async () => {
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");
    const styles = stripCssComments(
        await readFile(path.join(repositoryRoot, "styles.css"), "utf8")
    );

    // Defect 1: the dead `position: absolute` declaration is gone, and no
    // control sets `position` inline any more either -- the stylesheet inside
    // the shadow root is the only thing that positions a control.
    assert.equal(styles.includes("#add-new-word"), false);

    const mouseupHandler = contentSource.match(
        /document\.addEventListener\("mouseup", function \(event\) \{[\s\S]*?\r?\n\}\);/
    )?.[0];
    assert.ok(mouseupHandler, "expected the selection handler");
    const clickHandler = contentSource.match(
        /document\.addEventListener\("click", \(e\) => \{[\s\S]*?\r?\n\}\);/
    )?.[0];
    assert.ok(clickHandler, "expected the click-delegate handler");
    const editUiSource = contentSource.match(
        /function showEditUI\(translationSpan, wordId\)[\s\S]*?\r?\n\}\r?\n/
    )?.[0];
    assert.ok(editUiSource, "expected showEditUI");

    for (const [name, source] of [
        ["the selection handler", mouseupHandler],
        ["the delete handler", clickHandler],
        ["showEditUI", editUiSource]
    ]) {
        assert.doesNotMatch(
            source,
            /\.style\.position\s*=/,
            `${name} must not set position inline; mountControl and the shadow stylesheet own placement`
        );
    }

    // Defect 2: "S+" no longer depends on a per-id `position` rule existing --
    // both selection buttons take the same mount path.
    assert.equal(
        [...mouseupHandler.matchAll(/mountControl\(button, \{/g)].length,
        1,
        "both add-word and add-sentence must go through the same single mount call"
    );

    // Defect 3 (the mixed coordinate systems behind it): document coordinates
    // are gone; everything is placed from viewport coordinates, because the
    // shadow host is fixed at the viewport origin. Before this, the selection
    // buttons used pageX/pageY while the delete button used a viewport rect.
    assert.doesNotMatch(mouseupHandler, /event\.pageX/);
    assert.doesNotMatch(mouseupHandler, /event\.pageY/);
    assert.match(mouseupHandler, /left: event\.clientX \+ 20/);
    assert.match(mouseupHandler, /top: event\.clientY \+ 20/);

    // Exactly three mount sites: the selection button, the delete button and
    // the translation editor. A fourth would mean a control had been added
    // without going through the shared placement rule.
    assert.equal(
        [...contentSource.matchAll(/^\s*mountControl\(/gm)].length,
        3,
        "expected exactly three control mount sites"
    );
});

test("link-hosted highlight clicks are fully isolated from the host link", async () => {
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");

    const mousedownGuard = contentSource.match(
        /document\.addEventListener\("mousedown",[\s\S]*?\n\}, true\);/
    )?.[0];
    assert.ok(mousedownGuard, "expected a capture-phase mousedown guard for link-hosted highlights");
    assert.match(mousedownGuard, /closest\(["']a\[href\]["']\)/);
    assert.match(mousedownGuard, /e\.preventDefault\(\)/);
    assert.match(mousedownGuard, /e\.stopPropagation\(\)/);

    const clickHandler = contentSource.match(
        /document\.addEventListener\("click", \(e\) => \{[\s\S]*?\n\}\);/
    )?.[0];
    assert.ok(clickHandler, "expected the click-delegate handler");
    const linkGuard = clickHandler.match(
        /if \(wrapper\?\.closest\("a\[href\]"\)\) \{[\s\S]*?\}/
    )?.[0];
    assert.ok(linkGuard, "expected the link-hosted-word guard inside the click handler");
    assert.match(linkGuard, /e\.preventDefault\(\)/);
    assert.match(linkGuard, /e\.stopPropagation\(\)/);
});

test("popup dictionary sort breaks identical timestamps by id, newest first", async () => {
    const popupSource = await readFile(path.join(repositoryRoot, "popup.js"), "utf8");

    const sortSource = popupSource.match(
        /\.sort\(\(left, right\) => \{[\s\S]*?\n        \}\);/
    )?.[0];
    assert.ok(sortSource, "expected the timestamp-descending comparator with a tie-breaker");
    assert.match(sortSource, /getWordTimestamp\(right\) - getWordTimestamp\(left\)/);
    assert.match(sortSource, /Number\(right\?\.id\)[\s\S]*Number\(left\?\.id\)/);

    const context = vm.createContext({ Number, console });
    vm.runInContext(
        `function getWordTimestamp(word) {
            const candidate = word?.dateAdded || word?.createdAt || word?.importedAt || 0;
            const timestamp = typeof candidate === "number" ? candidate : new Date(candidate).getTime();
            return Number.isFinite(timestamp) ? timestamp : 0;
        }
        function sortWords(words) {
            return words.slice().sort((left, right) => {
                const timestampDelta = getWordTimestamp(right) - getWordTimestamp(left);
                if (timestampDelta !== 0) {
                    return timestampDelta;
                }
                return (Number(right?.id) || 0) - (Number(left?.id) || 0);
            });
        }`,
        context
    );
    const sorted = context.sortWords([
        { id: 100, word: "older-same-timestamp", dateAdded: 1000 },
        { id: 300, word: "newest-same-timestamp", dateAdded: 1000 },
        { id: 200, word: "middle-same-timestamp", dateAdded: 1000 },
        { id: 50, word: "actually-newest", dateAdded: 5000 }
    ]);
    assert.deepEqual(
        sorted.map((word) => word.word),
        ["actually-newest", "newest-same-timestamp", "middle-same-timestamp", "older-same-timestamp"]
    );
});

test("newly added words are broadcast to every open tab, not just the active one", async () => {
    const backgroundSource = await readFile(path.join(repositoryRoot, "background.js"), "utf8");

    const notifySource = backgroundSource.match(
        /async function notifyContentAboutChanges\([\s\S]*?\n\}/
    )?.[0];
    assert.ok(notifySource, "expected notifyContentAboutChanges to be defined");
    assert.match(notifySource, /chrome\.tabs\.query\(\{\}\)/);
    assert.match(notifySource, /tabs\.map/);
    assert.doesNotMatch(notifySource, /getCurrentTab\(\)/);
    assert.match(notifySource, /Receiving end does not exist/);
});

test("the exclusion list reaches the content script and gates every render path (#48)", async () => {
    const backgroundSource = await readFile(path.join(repositoryRoot, "background.js"), "utf8");
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");

    // --- Background: per-tab resolution, executed for real ------------------
    //
    // isExtensionEnabledForUrl/isSiteEqualToCurrentSite are pure, so extract
    // and run them (same style as the getChangedWords / classifySelectionType
    // tests) instead of only pattern-matching the source.
    const pureSource = backgroundSource.match(
        /function isSiteEqualToCurrentSite\(url, domain\)[\s\S]*?(?=\n\/\/ `url` is the URL of the tab)/
    )?.[0];
    assert.ok(pureSource, "expected the pure exclusion-matching helpers");

    const context = vm.createContext({ URL, Boolean, String, Array });
    vm.runInContext(pureSource, context);

    const excluded = ["developer.chrome.com", "example.com"];
    assert.equal(
        context.isExtensionEnabledForUrl("https://developer.chrome.com/docs/extensions/", excluded),
        false
    );
    // Subdomains of an excluded domain stay excluded (#48 AC8).
    assert.equal(context.isExtensionEnabledForUrl("https://docs.example.com/a", excluded), false);
    // ...but a domain that merely ends with the same letters does not.
    assert.equal(context.isExtensionEnabledForUrl("https://notexample.com/a", excluded), true);
    assert.equal(context.isExtensionEnabledForUrl("https://example.com.evil.net/", excluded), true);
    // An unrelated open tab keeps working while another site is excluded
    // (#48 AC7).
    assert.equal(context.isExtensionEnabledForUrl("https://wikipedia.org/wiki/X", excluded), true);
    assert.equal(context.isExtensionEnabledForUrl("https://example.com/", []), true);

    // The state answer must come from the asking tab, never the focused one
    // (#48 AC9).
    assert.match(backgroundSource, /checkIfExtensionEnabled\(sender\?\.tab\?\.url\)/);
    assert.match(backgroundSource, /async function checkIfExtensionEnabled\(url\)/);

    // The broadcast is computed per tab from that tab's own URL, and the old
    // "only if it matches the focused tab" early return is gone.
    const excludedSitesHandler = backgroundSource.match(
        /async function handleExcludedSitesChange\(\)[\s\S]*?\n\}/
    )?.[0];
    assert.ok(excludedSitesHandler, "expected handleExcludedSitesChange");
    assert.match(excludedSitesHandler, /chrome\.tabs\.query\(\{\}\)/);
    assert.match(excludedSitesHandler, /isExtensionEnabledForUrl\(tab\.url, excludedSites\)/);
    assert.match(excludedSitesHandler, /action: "extensionStateChanged"/);
    assert.doesNotMatch(excludedSitesHandler, /getCurrentTab\(\)/);
    // getChangedSite assumed exactly one entry changed; it is gone.
    assert.equal(backgroundSource.includes("function getChangedSite"), false);

    // --- Content: the flag is resolved, listened for, and enforced ----------
    assert.match(contentSource, /let extensionEnabledForSite = true;/);
    assert.match(contentSource, /function setExtensionEnabledForSite\(enabled\)/);

    // The initial check is actually invoked, and the first highlight pass is
    // chained onto it rather than racing it.
    assert.match(
        contentSource,
        /checkInitialExtensionState\(\)\.then\(\(\) => \{\s*\r?\n\s*loadInitialSettings\(\);/
    );

    // The broadcast now has a listener routing into handleExtensionStateChange.
    assert.match(contentSource, /request\.action === "extensionStateChanged"/);
    assert.match(contentSource, /handleExtensionStateChange\(request\.newValue\)/);
    const stateHandler = contentSource.match(
        /function handleExtensionStateChange\(enabled\)[\s\S]*?\r?\n\}\r?\n/
    )?.[0];
    assert.ok(stateHandler, "expected handleExtensionStateChange");
    // Flag first, then DOM work -- otherwise highlightWords() reads a stale
    // value and the page repaints itself right after being cleared.
    assert.match(stateHandler, /setExtensionEnabledForSite\(enabled\);[\s\S]*clearHighlighting\(\)/);
    // Disabling clears the already-open page: no reload required (#48 AC2).
    assert.match(stateHandler, /\} else \{\s*\r?\n\s*clearHighlighting\(\);/);

    // Every render path is gated. highlightWords is the single chokepoint for
    // the full-page pass (applySettings, the wordsChanged "reload" branch and
    // resyncHighlightsForCurrentPage all funnel through it), and the
    // incremental paths are gated individually.
    for (const [name, pattern] of [
        ["highlightWords", /async function highlightWords\(words\) \{\s*\r?\n\s*if \(!extensionEnabledForSite\)/],
        ["addHighlightForWord", /function addHighlightForWord\(word\) \{\s*\r?\n\s*if \(!extensionEnabledForSite\)/],
        [
            "showTemporaryHighlightWithLoader",
            /function showTemporaryHighlightWithLoader\(text\) \{\s*\r?\n\s*if \(!extensionEnabledForSite\)/
        ]
    ]) {
        assert.match(contentSource, pattern, `expected ${name} to be gated on the exclusion flag`);
    }
    assert.match(contentSource, /if \(!extensionEnabledForSite\) \{\s*\r?\n\s*\/\/ Excluded site: the cleanup above/);
});

test("interactive UI is excluded from highlighting while prose links stay eligible (#50)", async () => {
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");

    // The rejection list is a named constant so the reasoning can live next
    // to it, and isEligibleTextNode consumes exactly that constant.
    const selectorBlock = contentSource.match(
        /const NON_PROSE_SELECTOR = \[[\s\S]*?\]\.join\(", "\);/
    )?.[0];
    assert.ok(selectorBlock, "expected the NON_PROSE_SELECTOR constant");
    assert.match(contentSource, /parent\.closest\(NON_PROSE_SELECTOR\)/);

    // Native controls kept from the original list.
    assert.match(selectorBlock, /script, style, noscript, textarea, input, select, option, button/);
    assert.match(selectorBlock, /\[contenteditable\]:not\(\[contenteditable='false'\]\)/);

    // ARIA-composed equivalents (#50): this is what modern component
    // libraries actually ship, and none of it was matched before.
    for (const role of [
        "button",
        "combobox",
        "listbox",
        "option",
        "menu",
        "menubar",
        "menuitem",
        "menuitemcheckbox",
        "menuitemradio",
        "tab",
        "tablist",
        "switch",
        "checkbox",
        "radio",
        "slider",
        "spinbutton",
        "navigation",
        "toolbar",
        "tree",
        "grid",
        "dialog",
        "alertdialog"
    ]) {
        assert.ok(
            selectorBlock.includes(`[role~="${role}"]`),
            `expected role="${role}" to be excluded from highlighting`
        );
    }

    // Interactive containers with no role of their own, and anything that
    // opens a popup.
    assert.match(selectorBlock, /"nav, menu, summary, label"/);
    assert.match(selectorBlock, /"\[aria-haspopup\]"/);

    // Link policy (#11 vs #50). Plain anchors must stay eligible: prose
    // links are where a learner meets vocabulary, and #11 built click
    // isolation specifically so a highlight inside a link does not
    // navigate. A bare `a` in this list would silently undo that.
    assert.doesNotMatch(selectorBlock, /(^|[[",\s])a(\s*[,"]|$)/m);
    assert.equal(selectorBlock.includes('[role~="link"]'), false);
    // The focusable-widget catch-all explicitly carves plain links back out.
    assert.match(selectorBlock, /\[tabindex\]:not\(\[tabindex="-1"\]\):not\(a\[href\]\)/);
    // role="tabpanel" is a content container, not a control: it must not be
    // swept up by a prefix match on "tab".
    assert.equal(selectorBlock.includes('[role^="tab"]'), false);

    // The reasoning has to survive the next person editing the list.
    assert.match(contentSource, /READ THIS BEFORE EDITING THE LIST/);
    assert.match(contentSource, /LINK POLICY -- deliberate, do not "fix" it by adding `a` here/);

    // Every path that creates highlight wrappers goes through
    // findTextNodes() -> isEligibleTextNode(), so nodes that appear later
    // (a dropdown rendering its options only once opened) are filtered by
    // the same rule on the next pass. There is no separate DOM-scanning
    // path that could bypass it.
    const replaceCallers = [...contentSource.matchAll(/^\s*replaceTextNode\(/gm)];
    assert.equal(replaceCallers.length, 2, "expected exactly two replaceTextNode call sites");
    assert.equal(
        [...contentSource.matchAll(/findTextNodes\(document\.body\)/g)].length,
        3,
        "expected the three highlight passes to source their nodes from findTextNodes"
    );
    assert.match(contentSource, /createTreeWalker/);
});

// A minimal DOM good enough to run the control-layer and widget-ownership
// blocks for real: element identity, class/id matching for
// closest()/querySelectorAll(), a style object with setProperty(), a shadow
// root that document.querySelectorAll() cannot see into (the property the
// whole of #52 rests on), captured listeners and a controllable clock.
// Both blocks are self-contained (no highlighting, no chrome.* calls), so they
// can be extracted and executed the same way getChangedWords and
// classifySelectionType already are.
function createWidgetTestDom() {
    const registry = [];
    const listeners = { window: {}, document: {} };
    let now = 1_000_000;

    function matches(element, selector) {
        return selector
            .split(",")
            .map((token) => token.trim())
            .filter(Boolean)
            .some((token) => (
                token.startsWith("#")
                    ? element.id === token.slice(1)
                    : element.classes?.has(token.slice(1))
            ));
    }

    function createStyle() {
        const priorities = {};
        return {
            display: "",
            priorities,
            setProperty(property, value, priority = "") {
                this[property] = value;
                priorities[property] = priority;
            },
            getPropertyPriority: (property) => priorities[property] || ""
        };
    }

    class FakeShadowRoot {
        constructor(host, mode) {
            this.nodeType = 11;
            this.host = host;
            this.mode = mode;
            this.children = [];
        }

        appendChild(child) {
            child.inShadow = true;
            child.attached = true;
            child.shadowParent = this;
            this.children.push(child);
            return child;
        }

        querySelectorAll(selector) {
            return this.children.filter((child) => child.attached && matches(child, selector));
        }
    }

    class FakeElement {
        constructor({ id = "", classes = [], tagName = "DIV", attached = true } = {}) {
            this.nodeType = 1;
            this.id = id;
            this.tagName = tagName;
            this.classes = new Set(classes);
            this.classList = {
                contains: (name) => this.classes.has(name),
                add: (name) => this.classes.add(name)
            };
            this.style = createStyle();
            this.parentElement = null;
            this.previousElementSibling = null;
            this.children = [];
            this.shadowRoot = null;
            // Shadow children are invisible to document.querySelectorAll --
            // this is exactly the isolation #52 relies on, so the fake has to
            // model it or the tests would prove nothing.
            this.inShadow = false;
            this.shadowParent = null;
            this.attached = attached;
            this.isConnected = attached;
            registry.push(this);
        }

        attach() {
            this.attached = true;
            this.isConnected = true;
        }

        attachShadow({ mode }) {
            this.shadowRoot = new FakeShadowRoot(this, mode);
            return this.shadowRoot;
        }

        appendChild(child) {
            child.parentElement = this;
            child.attach();
            this.children.push(child);
            return child;
        }

        remove() {
            this.attached = false;
            this.isConnected = false;
            if (this.shadowParent) {
                this.shadowParent.children = this.shadowParent.children.filter(
                    (child) => child !== this
                );
                this.shadowParent = null;
            }
        }

        closest(selector) {
            let node = this;
            while (node) {
                if (matches(node, selector)) {
                    return node;
                }
                node = node.parentElement;
            }
            return null;
        }
    }

    function record(target, type, handler) {
        (listeners[target][type] = listeners[target][type] || []).push(handler);
    }

    const documentElement = new FakeElement({ tagName: "HTML" });

    const context = {
        Node: { ELEMENT_NODE: 1 },
        console: { warn() {} },
        Date: { now: () => now },
        document: {
            documentElement,
            addEventListener: (type, handler) => record("document", type, handler),
            createElement: (tagName) => new FakeElement({ tagName: tagName.toUpperCase() }),
            querySelectorAll: (selector) =>
                registry.filter(
                    (element) => element.attached && !element.inShadow && matches(element, selector)
                )
        },
        window: {
            innerWidth: 1280,
            innerHeight: 800,
            addEventListener: (type, handler) => record("window", type, handler)
        }
    };

    return {
        context,
        FakeElement,
        listeners,
        documentElement,
        advanceClock(milliseconds) {
            now += milliseconds;
        },
        fire(target, type, event = {}) {
            (listeners[target][type] || []).forEach((handler) => handler(event));
        }
    };
}

// Both blocks, in source order: the control layer declares controlHostElement
// and controlLayerRoot, which the widget-ownership block sweeps.
async function readWidgetRuntimeSource() {
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");
    const source = contentSource.match(
        /\/\/ Style isolation: every control lives in a shadow root \(#52\)[\s\S]*?(?=\r?\n\/\/ Selection classification)/
    )?.[0];
    assert.ok(source, "expected the control-layer + widget-ownership blocks");
    return source;
}

test("one widget at a time: the shared dismiss runs each control's own teardown (#51)", async () => {
    const widgetSource = await readWidgetRuntimeSource();

    const dom = createWidgetTestDom();
    const context = vm.createContext(dom.context);
    vm.runInContext(widgetSource, context);
    const { FakeElement } = dom;

    const readActiveWidget = () => vm.runInContext("activeWidget", context);

    // Mirrors showEditUI: the span is hidden, the container is built, the
    // widget is registered, and only then is the container mounted. Since #52
    // the container is mounted into the shadow layer instead of being inserted
    // next to the span, so the sweep can no longer find the span by sibling
    // relationship -- it finds it inside its highlight wrapper.
    const makeEditPair = () => {
        const wrapper = new FakeElement({ classes: ["highlight-wrapper"] });
        const translation = new FakeElement({ classes: ["translation"] });
        translation.parentElement = wrapper;
        const container = new FakeElement({
            classes: ["edit-translation-container", "lazylex-control"],
            attached: false
        });
        translation.style.display = "none";
        return { wrapper, translation, container };
    };
    const openEdit = (pair) => {
        context.setActiveWidget({
            type: "edit",
            target: pair.translation,
            dismiss: () => {
                pair.container.remove();
                pair.translation.style.display = "";
            }
        });
        pair.container.attach();
        return pair;
    };

    // --- Mutual exclusion: opening a control closes the previous one --------
    const addButton = new FakeElement({ id: "add-new-word", attached: false });
    context.setActiveWidget({
        type: "add-word",
        target: addButton,
        dismiss: () => addButton.remove()
    });
    addButton.attach();

    const first = openEdit(makeEditPair());

    assert.equal(addButton.attached, false, "opening the editor must close the add button");
    assert.equal(readActiveWidget().type, "edit");

    // --- Escape closes it and puts the translation back (criteria 4 and 7) --
    dom.fire("document", "keydown", { key: "Escape" });
    assert.equal(first.container.attached, false);
    assert.equal(first.translation.style.display, "", "Escape must restore the hidden translation");
    assert.equal(readActiveWidget(), null);

    // --- Trap 1: a control with no registration is still closed *and*
    // restored, rather than having its container blindly removed ------------
    const orphan = makeEditPair();
    orphan.container.attach();
    const strayDelete = new FakeElement({ id: "deleteWordBtn" });
    context.dismissActiveWidget();
    assert.equal(orphan.container.attached, false);
    assert.equal(
        orphan.translation.style.display,
        "",
        "the defensive sweep must restore a translation it un-hides, not orphan it"
    );
    assert.equal(strayDelete.attached, false);

    // --- Scroll dismissal, with a short grace window so that focusing the
    // edit input cannot close the control it just opened (criterion 6) ------
    const scrolled = openEdit(makeEditPair());
    dom.fire("window", "scroll");
    assert.equal(scrolled.container.attached, true, "a scroll at open time must not dismiss");
    dom.advanceClock(1000);
    dom.fire("window", "scroll");
    assert.equal(scrolled.container.attached, false, "scrolling must dismiss an open control");
    assert.equal(scrolled.translation.style.display, "");
    assert.equal(readActiveWidget(), null);

    // --- Events inside a control belong to that control --------------------
    const liveContainer = new FakeElement({ classes: ["edit-translation-container"] });
    const input = new FakeElement({ classes: ["edit-translation-input"] });
    input.parentElement = liveContainer;
    assert.equal(context.isWidgetControlNode(input), true);
    assert.equal(context.isWidgetControlNode({ nodeType: 3, parentElement: input }), true);

    const wrapper = new FakeElement({ classes: ["highlight-wrapper"] });
    const highlighted = new FakeElement({ classes: ["highlighted-word"] });
    highlighted.parentElement = wrapper;
    assert.equal(context.isWidgetControlNode(highlighted), false);
    assert.equal(context.isWidgetControlNode(null), false);
});

test("the shadow control layer isolates, positions and sweeps its controls (#52)", async () => {
    const widgetSource = await readWidgetRuntimeSource();

    const dom = createWidgetTestDom();
    const context = vm.createContext(dom.context);
    vm.runInContext(widgetSource, context);
    const { FakeElement } = dom;

    // --- The host: light DOM, on <html>, pinned inline with !important ------
    const button = new FakeElement({ id: "add-new-word", classes: ["action-button"] });
    context.mountControl(button, { left: 100, top: 200, width: 24, height: 24 });

    const host = vm.runInContext("controlHostElement", context);
    assert.equal(host.id, "lazylex-controls");
    assert.equal(host.parentElement, dom.documentElement, "the host belongs on <html>, not inside <body>");
    assert.equal(host.shadowRoot.mode, "open");
    for (const property of ["all", "position", "top", "left", "pointer-events", "z-index"]) {
        assert.equal(
            host.style.getPropertyPriority(property),
            "important",
            `${property} must be pinned with inline !important so no page rule can outrank it`
        );
    }
    assert.equal(host.style.all, "initial");
    assert.equal(host.style.position, "fixed", "`all: initial` must not be left overriding the geometry");

    // --- Isolation: the page cannot see the control ------------------------
    assert.equal(button.classes.has("lazylex-control"), true);
    assert.equal(button.inShadow, true);
    assert.equal(
        context.document.querySelectorAll("#add-new-word").length,
        0,
        "a control in the shadow root must be invisible to light-DOM queries -- that is what stops host CSS reaching it"
    );
    assert.equal(host.shadowRoot.querySelectorAll(".lazylex-control").length, 1);

    // --- One coordinate system, clamped to the viewport (criterion 7) ------
    assert.equal(button.style.left, "100px");
    assert.equal(button.style.top, "200px");
    assert.equal(button.style.position, undefined, "position comes from the stylesheet, never inline");

    const offscreen = new FakeElement({ id: "deleteWordBtn", classes: ["action-button"] });
    context.mountControl(offscreen, { left: 5000, top: -400, width: 32, height: 32 });
    assert.equal(offscreen.style.left, `${1280 - 32 - 8}px`, "a control past the right edge is pulled back on screen");
    assert.equal(offscreen.style.top, "8px", "a control above the viewport is pulled back on screen");

    // --- The sweep clears controls but must not eat the stylesheet ---------
    context.sweepOrphanedWidgetControls();
    assert.equal(button.attached, false);
    assert.equal(offscreen.attached, false);
    const survivors = host.shadowRoot.children;
    assert.equal(survivors.length, 1);
    assert.equal(survivors[0].tagName, "STYLE", "the control stylesheet must survive the sweep");

    // --- The layer is reused, not rebuilt, on the next open ---------------
    const reopened = new FakeElement({ id: "add-new-word", classes: ["action-button"] });
    context.mountControl(reopened, { left: 10, top: 10, width: 24, height: 24 });
    assert.equal(vm.runInContext("controlHostElement", context), host, "the host is created once and reused");
    assert.equal(host.shadowRoot.children.length, 2);
});

test("shadow-root events are recognised by composedPath, not the retargeted target (#52 vs #51)", async () => {
    const widgetSource = await readWidgetRuntimeSource();

    const dom = createWidgetTestDom();
    const context = vm.createContext(dom.context);
    vm.runInContext(widgetSource, context);
    const { FakeElement } = dom;

    const saveButton = new FakeElement({ classes: ["action-button"] });
    context.mountControl(saveButton, { left: 10, top: 10, width: 24, height: 24 });
    const host = vm.runInContext("controlHostElement", context);
    const pageParagraph = new FakeElement({ tagName: "P" });

    // This is what Chrome actually delivers to a document-level listener when
    // the user clicks a button inside a shadow root: target is the *host*, and
    // only composedPath() reports the button. Testing event.target against the
    // control selector would happen to work here (the host is in the
    // selector), so the sharper case is the one below.
    const retargeted = {
        target: host,
        composedPath: () => [saveButton, host, context.document]
    };
    assert.equal(context.isWidgetControlEvent(retargeted), true);

    // The regression this guards: a control whose event.target says "page"
    // while composedPath says "ours". If this returned false, the mouseup and
    // click handlers would dismiss the widget on the user's first click on it
    // and #51's mutual exclusion would look broken.
    const misleadingTarget = {
        target: pageParagraph,
        composedPath: () => [saveButton, host, context.document]
    };
    assert.equal(
        context.isWidgetControlEvent(misleadingTarget),
        true,
        "composedPath must win over event.target, or the widget dismisses itself when clicked"
    );

    // A genuine page interaction is still a page interaction.
    const pageClick = {
        target: pageParagraph,
        composedPath: () => [pageParagraph, context.document]
    };
    assert.equal(context.isWidgetControlEvent(pageClick), false);

    // Synthetic events with no composedPath fall back to event.target.
    assert.equal(context.isWidgetControlEvent({ target: host }), true);
    assert.equal(context.isWidgetControlEvent({ target: pageParagraph }), false);
    assert.equal(context.isWidgetControlEvent(undefined), false);
});

test("every control path opens through the shared dismiss, including the SPA resync (#51)", async () => {
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");

    // The three open paths each register with the shared owner instead of
    // removing only their own kind.
    const mouseupHandler = contentSource.match(
        /document\.addEventListener\("mouseup", function \(event\) \{[\s\S]*?\r?\n\}\);/
    )?.[0];
    assert.ok(mouseupHandler, "expected the selection (add word/sentence) handler");
    assert.match(mouseupHandler, /if \(isWidgetControlEvent\(event\)\) \{/);
    assert.match(mouseupHandler, /dismissActiveWidget\(\);/);
    assert.match(mouseupHandler, /setActiveWidget\(\{[\s\S]*?type: selectionType === "sentence"/);
    // The old self-only cleanup is gone: it is what allowed a selection to
    // leave an edit field or delete button open elsewhere on the page.
    assert.equal(
        mouseupHandler.includes('document.getElementById("add-new-word") || document.getElementById("add-new-sentence")'),
        false
    );

    const clickHandler = contentSource.match(
        /document\.addEventListener\("click", \(e\) => \{[\s\S]*?\r?\n\}\);/
    )?.[0];
    assert.ok(clickHandler, "expected the click-delegate handler");
    assert.match(clickHandler, /if \(isWidgetControlEvent\(e\)\) \{/);
    assert.match(clickHandler, /dismissActiveWidget\(\);/);
    assert.match(clickHandler, /setActiveWidget\(\{\s*\r?\n\s*type: "delete"/);
    assert.equal(clickHandler.includes('const existingDeleteButton = document.getElementById("deleteWordBtn")'), false);

    const editUiSource = contentSource.match(
        /function showEditUI\(translationSpan, wordId\)[\s\S]*?\r?\n\}\r?\n/
    )?.[0];
    assert.ok(editUiSource, "expected showEditUI");
    assert.match(editUiSource, /dismissActiveWidget\(\);/);
    assert.match(editUiSource, /setActiveWidget\(\{\s*\r?\n\s*type: "edit"/);
    // Its teardown restores the span it hid -- the trap the shared dismiss
    // exists to avoid.
    assert.match(editUiSource, /dismiss: \(\) => \{[\s\S]*?translationSpan\.style\.display = ''/);
    // Focusing the input must not scroll, or scroll-dismissal would close the
    // field the moment it opened.
    assert.match(editUiSource, /input\.focus\(\{ preventScroll: true \}\)/);
    // Saving closes through the shared dismiss, so an empty value cannot
    // leave the translation hidden.
    assert.doesNotMatch(editUiSource, /\n\s*editContainer\.remove\(\);\r?\n\s*\}\);/);

    // Trap 2: the SPA resync used to remove #deleteWordBtn and nothing else,
    // leaving an edit field attached to a destroyed span.
    const resyncSource = contentSource.match(
        /async function resyncHighlightsForCurrentPage\(\)[\s\S]*?\r?\n\}\r?\n/
    )?.[0];
    assert.ok(resyncSource, "expected resyncHighlightsForCurrentPage");
    assert.match(resyncSource, /dismissActiveWidget\(\);\r?\n\s*clearHighlighting\(\);/);
    assert.equal(resyncSource.includes('document.getElementById("deleteWordBtn")'), false);

    // ...and the same teardown runs wherever wrappers are destroyed under a
    // control: the full clear and the per-word removal.
    for (const [name, pattern] of [
        ["clearHighlighting", /function clearHighlighting\(\) \{[\s\S]*?dismissActiveWidget\(\);/],
        ["removeHighlightsForWord", /function removeHighlightsForWord\(word\) \{[\s\S]*?dismissActiveWidget\(\);/]
    ]) {
        assert.match(contentSource, pattern, `expected ${name} to run the shared teardown`);
    }

    // Escape and scroll dismissal are wired at the document/window level, and
    // scroll is captured because it does not bubble from inner scrollers.
    assert.match(contentSource, /event\.key === "Escape" && activeWidget/);
    assert.match(contentSource, /"scroll",[\s\S]*?\{ capture: true, passive: true \}/);
    // The open-time grace window must not depend on requestAnimationFrame:
    // rAF does not run in a hidden or throttled tab, which would leave scroll
    // dismissal permanently disarmed there.
    assert.match(contentSource, /Date\.now\(\) - widgetOpenedAt > WIDGET_SCROLL_GRACE_MS/);
    assert.doesNotMatch(contentSource, /requestAnimationFrame\(\(\) => \{\s*\r?\n\s*if \(activeWidget/);
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

test("the click ending a selection gesture does not dismiss the control that gesture just opened (#55)", async () => {
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");

    // The regression this guards against: a text-selection gesture ends with
    // mouseup AND a click. mouseup opens the add-word button; the trailing
    // click reached the document handler's blanket dismissal and removed it
    // within the same gesture, so the button was never usable.
    assert.match(
        contentSource,
        /let selectionGestureOpenedControl = false;/,
        "expected the gesture flag that survives mouseup into the trailing click"
    );

    const mouseupHandler = contentSource.match(
        /document\.addEventListener\("mouseup",[\s\S]*?\n\}\);/
    )?.[0];
    assert.ok(mouseupHandler, "expected the mouseup handler");

    // The early return is now composedPath-based (#52) -- the controls live in
    // a shadow root, so event.target is retargeted to the host. The ordering
    // requirement is unchanged: clear the flag before anything can return.
    assert.match(
        mouseupHandler,
        /selectionGestureOpenedControl = false;[\s\S]*?isWidgetControlEvent\(event\)/,
        "the flag must be cleared before the early return, so it cannot leak into a later gesture"
    );
    // The control is attached by mountControl now rather than appended to the
    // body, but the flag must still be set only after it is actually attached.
    assert.match(
        mouseupHandler,
        /mountControl\(button, \{[\s\S]*?\}\);[\s\S]*?selectionGestureOpenedControl = true;/,
        "the flag must be set once the add control is actually attached"
    );

    const clickHandlers = contentSource.match(
        /document\.addEventListener\("click",[\s\S]*?\n\}\);/g
    ) || [];
    const dismissingClickHandler = clickHandlers.find((handler) =>
        handler.includes("dismissActiveWidget()")
    );
    assert.ok(dismissingClickHandler, "expected the click handler that dismisses on outside clicks");

    const guardIndex = dismissingClickHandler.indexOf("if (selectionGestureOpenedControl)");
    const blanketDismissIndex = dismissingClickHandler.search(
        /\n {4}dismissActiveWidget\(\);/
    );
    assert.ok(guardIndex !== -1, "expected the gesture guard in the click handler");
    assert.ok(
        guardIndex < blanketDismissIndex,
        "the gesture guard must run before the blanket dismissal, or the button is removed anyway"
    );
    assert.match(
        dismissingClickHandler.slice(guardIndex),
        /if \(selectionGestureOpenedControl\) \{\s*selectionGestureOpenedControl = false;\s*return;/,
        "the guard must consume the flag and return, so the delete path cannot open a second control"
    );
});
