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

test("sentence selections are classified distinctly and gated by the trial, not by premium (#49)", async () => {
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");
    const backgroundSource = await readFile(path.join(repositoryRoot, "background.js"), "utf8");
    const popupSource = await readFile(path.join(repositoryRoot, "popup.js"), "utf8");

    // Pure classifier: extract and execute it directly (same no-DOM-
    // dependency style as the getChangedWords/YouTube-navigation tests).
    const classifierSource = contentSource.match(
        // The two shape constants #71 added come with it; the classifier reads
        // them and cannot be executed alone any more.
        /const CONTAINS_LETTER[\s\S]*?function classifySelectionType\(text\)[\s\S]*?\r?\n}\r?\n/
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
    assert.match(sentenceHandlerSource, /action: "translateSentence"/);
    assert.match(contentSource, /SENTENCE_MAX_LENGTH = 500/);

    // Sentences are NOT a premium feature (issue #49). #28 was closed when the
    // product moved to a trial where everything is open until it ends, and
    // translateSentence server-side runs the same `requireAccess` trial gate
    // as translateWord. A client-side premium check here refused a feature the
    // backend would have served -- the "Sentence Saving is Premium" card in
    // the report.
    assert.doesNotMatch(sentenceHandlerSource, /action: "getSubscriptionStatus"/);
    // Comments are allowed to name what was removed; executable code is not.
    // Stripping them first is what lets this fail for the right reason instead
    // of tripping over the note that explains the deletion.
    const contentCode = contentSource
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
    assert.equal(
        contentCode.includes("showSentencePremiumNotification("),
        false,
        "the premium upsell card must not come back"
    );
    assert.equal(
        contentCode.includes("Sentence Saving is Premium"),
        false,
        "the premium upsell copy must not come back"
    );
    // An ended trial gets the same card a refused word gets: one explanation
    // of one account state, not a separate upsell per feature.
    assert.match(sentenceHandlerSource, /error\?\.reason === TRIAL_EXPIRED_REASON/);
    assert.match(sentenceHandlerSource, /showTrialEndedNotification\(/);

    // Background: a distinct callable/action from translateWord, entitlement
    // checked before any network call, and storage kept out of the shared
    // words/translations/lexicon paths.
    assert.match(backgroundSource, /async function translateSentenceMutation\(text, targetLanguage\)/);
    const translateSentenceSource = backgroundSource.match(
        /async function translateSentenceMutation\(text, targetLanguage\)[\s\S]*?\r?\n}\r?\n/
    )?.[0];
    assert.ok(translateSentenceSource, "expected the sentence translation mutation");
    // The background half of the same removal: no premium pre-check before the
    // network call, and no locally-manufactured 403.
    assert.doesNotMatch(translateSentenceSource, /getSubscriptionStatus\(\)/);
    assert.doesNotMatch(translateSentenceSource, /code: "entitlement"/);
    // The trial block this callable echoes back is cached like translateWord's.
    assert.match(translateSentenceSource, /cacheEntitlement\(result\?\.entitlement\)/);
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

    // #11's dark red, white border and drop shadow are GONE, deliberately.
    // They existed because every control was plain DOM in the host page, where
    // a dense high-contrast results page could wash the delete button out. #52
    // moved every control into a shadow root: no host selector reaches it and
    // nothing it sits over changes how it renders, so the reason for the extra
    // weight no longer exists. What was left was two of our own controls
    // looking unrelated for a historical reason.
    //
    // The delete button now carries NO rule of its own -- it is styled entirely
    // by .action-button, which is what makes "identical" structural rather than
    // a pair of values that have to be kept in step.
    assert.equal(
        /#deleteWordBtn\s*\{/.test(stylesheet),
        false,
        "the delete button must not reintroduce styling of its own"
    );
    assert.equal(
        stylesheet.includes("#c4320a"),
        false,
        "the delete button's old colour must not survive anywhere in the sheet"
    );

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
    // No `#deleteWordBtn` block to check any more -- the delete button is
    // styled entirely by `.action-button`, which the line above already pins
    // to ACTION_BUTTON_SIZE.
    assert.match(readRuleBlock(stylesheet, ".edit-translation-input"), new RegExp(`width:\\s*${readConstant("EDIT_INPUT_WIDTH")}px;`));

    // Criterion 6 asked for the 24px/32px difference to be justified or
    // unified. It is now unified, and unified in the strongest available way:
    // DELETE_BUTTON_SIZE is DEFINED as ACTION_BUTTON_SIZE, so the clamp maths
    // for the two controls cannot drift apart by editing one number.
    assert.match(
        contentSource,
        /const DELETE_BUTTON_SIZE = ACTION_BUTTON_SIZE;/,
        "the delete size must be defined from the action size, not repeated"
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
    // The focusable-widget catch-all explicitly carves plain links back out,
    // and (#76) anything that declares a role. A scrollable region has to be
    // focusable to be keyboard-reachable, so `tabindex="0"` on a content
    // container is accessibility work, not a control -- BBC's live feed is
    // `<ol role="list" tabindex="0">`, and because the selector is applied
    // with closest(), that one attribute silently excluded the whole feed.
    // Roled controls are matched on their role by the rules above, so
    // trusting the role here costs nothing.
    assert.match(
        selectorBlock,
        /\[tabindex\]:not\(\[tabindex="-1"\]\):not\(a\[href\]\):not\(\[role\]\)/
    );
    // The bare form must not come back: it is the whole of #76.
    assert.doesNotMatch(
        selectorBlock,
        /\[tabindex\]:not\(\[tabindex="-1"\]\):not\(a\[href\]\)'/
    );
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
    // The orphan has to be findable where unregistered controls actually are:
    // inside the shadow layer. Every control goes through mountControl, and the
    // only document.body.appendChild calls left in content.js are the two
    // notifications and the fly-to-toolbar animation -- none of them controls.
    // makeEditPair already gives the container the `lazylex-control` class, so
    // mounting it is all that is needed.
    context.mountControl(orphan.container, { left: 0, top: 0, width: 10, height: 10 });
    context.dismissActiveWidget();
    assert.equal(orphan.container.attached, false);
    assert.equal(
        orphan.translation.style.display,
        "",
        "the defensive sweep must restore a translation it un-hides, not orphan it"
    );

    // Light-DOM debris is a different problem with a different lifetime: it can
    // only come from a PREVIOUS injection of this script, since nothing in this
    // version puts a control there. Sweeping for it on every gesture cost 3.8ms
    // per call on a ~40k-element page -- paid twice per click, from both the
    // mouseup and the click handler, while nothing of ours was open. That was
    // the lag reported on chatgpt.com. It runs once, at the only moment it
    // could ever find anything.
    const strayDelete = new FakeElement({ id: "deleteWordBtn" });
    context.dismissActiveWidget();
    assert.equal(
        strayDelete.attached,
        true,
        "the per-gesture dismiss must not pay for a document-wide query"
    );
    context.sweepLegacyLightDomControls();
    assert.equal(strayDelete.attached, false, "startup must still clear it");

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

test("the freemium daily word limit is gone from every client surface (#49)", async () => {
    const sources = await Promise.all(
        ["background.js", "content.js", "popup.js", "subscription-manager.js"].map(async (file) => [
            file,
            await readFile(path.join(repositoryRoot, file), "utf8")
        ])
    );

    // The limit was enforced entirely on the client: read `dailyWordsAdded`
    // off a client-writable document, compare to a hardcoded 5. It produced
    // the "Daily Limit Reached" card in the #49 report, and -- because the
    // client also reset that counter -- issue #45's "the quota came back after
    // navigating".
    //
    // Comments are allowed to mention it; executable code is not. Stripping
    // comments first is what makes this test able to fail for the right reason
    // rather than tripping over its own explanation.
    for (const [file, source] of sources) {
        const code = source
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .split("\n")
            .filter((line) => !line.trim().startsWith("//"))
            .join("\n");

        for (const banned of [
            "daily_limit_reached",
            "DAILY_FREE_LIMIT",
            "dailyWordLimit",
            "Daily Limit Reached",
            "checkSubscriptionLimits",
            "incrementDailyWordCount"
        ]) {
            assert.equal(
                code.includes(banned),
                false,
                `${file} still contains the freemium construct ${banned}`
            );
        }
    }
});

test("access is decided by the callable, never pre-flighted on the client (#49)", async () => {
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");
    const backgroundSource = await readFile(path.join(repositoryRoot, "background.js"), "utf8");

    // Trial state lives in `users/{uid}/private/entitlement`, which
    // firestore.rules denies to every client. A client-side verdict is
    // therefore not merely redundant, it is unbackable.
    const saveWord = contentSource.match(
        /async function saveWordToDictionary\([\s\S]*?\n\}/
    )?.[0];
    assert.ok(saveWord, "expected saveWordToDictionary");
    assert.equal(
        /sendMessage\(\{\s*action:\s*"checkSubscriptionLimits"/.test(saveWord),
        false,
        "the pre-flight limit check must not come back"
    );

    // The refusal has to survive three hops: HTTP body -> LazyLexApiError ->
    // the serialized message -> an Error in the content script. Losing
    // `reason` anywhere makes an expired trial indistinguishable from a 500,
    // which is exactly what the old flattened-message path did.
    assert.match(backgroundSource, /function parseCallableErrorBody/);
    assert.match(backgroundSource, /reason: details\?\.reason \|\| null/);
    assert.match(backgroundSource, /reason: error\?\.reason \|\| null/);
    assert.match(contentSource, /failure\.lazylexReason = response\?\.error\?\.reason \|\| null;/);
    assert.match(contentSource, /const TRIAL_EXPIRED_REASON = 'trial-expired';/);
});

test("a trial refusal raises the card alone, never stacked with the toast (#49)", async () => {
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");

    // Both surfaces are `position: fixed; top: 20px; right: 20px`. The old
    // code raised both for one event -- showSubscriptionLimitNotification from
    // inside the save path, then the thrown message through the generic catch
    // -- so they landed exactly on top of each other. That overlap is the
    // second half of the #49 screenshot.
    const runLogicCatch = contentSource.match(
        /saveWordToDictionary\(originalWord\)\.catch\([\s\S]*?\n {4}\}\);/
    )?.[0];
    assert.ok(runLogicCatch, "expected the save failure handler");

    const trialBranch = runLogicCatch.indexOf("TRIAL_EXPIRED_REASON");
    const toastCall = runLogicCatch.indexOf("showContentNotification");
    assert.ok(trialBranch !== -1, "the trial refusal needs its own branch");
    assert.ok(
        trialBranch < toastCall,
        "the trial branch must precede the generic toast, and return before reaching it"
    );
    assert.match(
        runLogicCatch.slice(trialBranch),
        /showTrialEndedNotification\([\s\S]*?\);\s*return;/,
        "the trial branch must return, or both notifications are raised"
    );

    const card = contentSource.match(
        /function showTrialEndedNotification\([\s\S]*?\n\}/
    )?.[0];
    assert.ok(card, "expected showTrialEndedNotification");
    assert.match(
        card,
        /getElementById\('lazylex-status-notification'\)\?\.remove\(\);/,
        "the card must clear a toast already on screen from an earlier failure"
    );
    // Losing access is a state, not a transient event: the old card removed
    // itself after 8 seconds, which reads as a glitch.
    assert.equal(
        /}, 8000\);/.test(card),
        false,
        "the trial-ended card must not auto-dismiss"
    );
});

test("an absent entitlement block reads as unknown, never as expired (#49)", async () => {
    const popupSource = await readFile(path.join(repositoryRoot, "popup.js"), "utf8");
    const backgroundSource = await readFile(path.join(repositoryRoot, "background.js"), "utf8");

    // The functions carrying the trial contract are merged but NOT deployed,
    // so right now every user has a null entitlement block. Rendering null as
    // "expired" would lock out the entire userbase on a deploy that never
    // happened -- the same class of mistake as #45, where a failed lookup was
    // treated as a definite answer.
    assert.match(backgroundSource, /async function getCachedEntitlement/);
    assert.match(
        backgroundSource,
        /return stored\?\.\[ENTITLEMENT_CACHE_KEY\] \|\| null;/
    );

    const display = popupSource.match(
        /async function updateSubscriptionDisplay\([\s\S]*?\n\}/
    )?.[0];
    assert.ok(display, "expected updateSubscriptionDisplay");
    assert.match(
        display,
        /const trialOver = trialState === 'expired';/,
        "expiry must be an explicit server state, not the absence of one"
    );
    // The lockout branch must key off that state and nothing looser.
    assert.match(
        display,
        /if \(addWordBtn && trialOver\) \{[\s\S]*?addWordBtn\.disabled = true;/,
        "the Add button may only be disabled by an explicit expired state"
    );
});

test("translations render in one casing, and the rule lives in one place", async () => {
    const formatSource = await readFile(path.join(repositoryRoot, "translation-format.js"), "utf8");
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");
    const popupSource = await readFile(path.join(repositoryRoot, "popup.js"), "utf8");
    const manifest = JSON.parse(
        await readFile(path.join(repositoryRoot, "manifest.json"), "utf8")
    );

    // Providers capitalise inconsistently: the same page showed
    // `[пограбування]` and `[банк]` next to `[Підготуйтеся]` and `[Повільно]`,
    // with nothing about the words to explain the difference. The source word
    // is already lowercased before storage; the translation was the only half
    // still carrying provider casing.
    const context = vm.createContext({ globalThis: {} });
    context.globalThis = context;
    vm.runInContext(formatSource, context);
    const normalize = context.normalizeTranslationCase;
    assert.equal(typeof normalize, "function", "expected the shared formatter");

    assert.equal(normalize("Підготуйтеся"), "підготуйтеся");
    assert.equal(normalize("Повільно"), "повільно");
    assert.equal(normalize("пограбування"), "пограбування");
    assert.equal(normalize("  Банк  "), "банк");
    // An all-caps remainder is an acronym, not a capitalised word.
    assert.equal(normalize("ЄС"), "ЄС");
    assert.equal(normalize("USA"), "USA");
    // Only the first character moves; an internal capital survives.
    assert.equal(normalize("Метод; Спосіб"), "метод; Спосіб");
    // No cased characters is not the same as all-caps.
    assert.equal(normalize("123"), "123");
    assert.equal(normalize(""), "");
    assert.equal(normalize(null), "");
    assert.equal(normalize(undefined), "");

    // Loaded before the scripts that call it, in both surfaces that render a
    // translation. If it were only in one, the two would disagree.
    const contentScript = manifest.content_scripts?.[0]?.js || [];
    assert.deepEqual(contentScript, ["translation-format.js", "content.js"]);
    const popupHtml = await readFile(path.join(repositoryRoot, "popup.html"), "utf8");
    assert.ok(
        popupHtml.indexOf("translation-format.js") < popupHtml.indexOf("popup.js"),
        "the formatter must load before popup.js"
    );

    // Applied at RENDER, not only at save. Words stored before this change
    // still carry provider casing, and normalising only on the way in would
    // leave every existing entry inconsistent with every new one.
    const renderCalls = contentSource.match(/normalizeTranslationCase\(/g) || [];
    assert.ok(
        renderCalls.length >= 4,
        `expected every content.js render and save site to normalise, found ${renderCalls.length}`
    );
    assert.equal(
        /textContent = `\[\$\{word\.translation\}\]`/.test(contentSource),
        false,
        "a raw translation must not reach the page"
    );
    assert.match(popupSource, /translation\.textContent = normalizeTranslationCase\(item\?\.translation\)/);

    // Sentences are exempt: a sentence's leading capital is correct, not
    // provider noise.
    const sentenceItem = popupSource.match(
        /function createSentenceListItem\(item\)[\s\S]*?\n\}/
    )?.[0];
    assert.ok(sentenceItem, "expected the sentence list item builder");
    const sentenceItemCode = sentenceItem
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
    assert.equal(
        sentenceItemCode.includes("normalizeTranslationCase"),
        false,
        "sentence translations must keep their own casing"
    );
});

test("the options page toast does not collide with popup.css's bottom sheet", async () => {
    const optionsHtml = await readFile(path.join(repositoryRoot, "options.html"), "utf8");
    const optionsJs = await readFile(path.join(repositoryRoot, "options.js"), "utf8");
    const popupCss = await readFile(path.join(repositoryRoot, "popup.css"), "utf8");

    // options.html links popup.css, which styles `.notification` as a bottom
    // sheet: `left: 0; right: 0; bottom: -20%; display: flex`. The options page
    // declared its own `.notification` as a top-right toast. Same specificity,
    // so the cascade resolved property by property rather than one rule
    // replacing the other -- the element kept `bottom` and `left` from
    // popup.css and `top` and `right` from options.html. A fixed box anchored
    // on all four sides stretches, which is why an export confirmation
    // rendered as a full-page orange block.
    assert.match(popupCss, /\.notification \{/, "popup.css still owns .notification");
    assert.ok(
        popupCss.includes("bottom: -20%"),
        "the bottom-sheet geometry this test guards against is still in popup.css"
    );

    // The fix is a distinct name, not a `bottom: auto` patch: sharing a class
    // across two pages with different layouts is the defect itself.
    assert.match(optionsHtml, /<div id="notification" class="options-toast"/);
    assert.equal(
        /class="notification"/.test(optionsHtml),
        false,
        "the options toast must not reuse popup.css's class"
    );
    assert.equal(
        popupCss.includes(".options-toast"),
        false,
        "popup.css must not reach the options toast"
    );

    // Every caller already passed a type; nothing rendered it, so a failed
    // import looked identical to a successful export.
    for (const variant of ["success", "warning", "error"]) {
        assert.ok(
            optionsHtml.includes(`.options-toast.options-toast-${variant}`),
            `expected a ${variant} variant`
        );
    }
    assert.match(optionsJs, /notification\.classList\.remove\(\.\.\.TOAST_TYPE_CLASSES\)/);

    // Settings save used to rely on static markup for its text, so after an
    // export it re-announced the export.
    const saveToast = optionsJs.match(/function showNotification\(\)[\s\S]*?\n\}/)?.[0];
    assert.ok(saveToast, "expected showNotification");
    assert.match(saveToast, /showToast\('Settings saved successfully!', 'success'\)/);
    assert.match(
        optionsHtml,
        /<div id="notification"[^>]*><\/div>/,
        "the toast element must ship empty, so no stale text can be revealed"
    );

    // Two toasts in quick succession shared a timer, so the first one's
    // timeout hid the second early.
    assert.match(optionsJs, /let toastHideTimer = null;/);
    assert.match(optionsJs, /clearTimeout\(toastHideTimer\)/);
});

test("an excluded site gets no widget either, not just no translations (#48)", async () => {
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");

    // #48 gated every path that RENDERS -- highlightWords,
    // addHighlightForWord, showTemporaryHighlightWithLoader,
    // resyncHighlightsForCurrentPage -- so an excluded page stopped showing
    // translations. It did not gate the paths that OFFER, so selecting text
    // still produced the "+" button on a site the user had excluded, and the
    // keyboard shortcut still translated and saved a word there.
    const mouseupHandler = contentSource.match(
        /document\.addEventListener\("mouseup",[\s\S]*?\n\}\);/
    )?.[0];
    assert.ok(mouseupHandler, "expected the mouseup handler");

    const dismissIndex = mouseupHandler.indexOf("dismissActiveWidget();");
    const gateIndex = mouseupHandler.indexOf("if (!extensionEnabledForSite) {");
    const createIndex = mouseupHandler.indexOf('document.createElement("button")');
    assert.ok(gateIndex !== -1, "the mouseup handler must check the exclusion state");
    assert.ok(
        gateIndex < createIndex,
        "the check must run before the control is built, or the button still appears"
    );
    // After the teardown, so a control open when the site becomes excluded is
    // still removed rather than stranded.
    assert.ok(
        dismissIndex !== -1 && dismissIndex < gateIndex,
        "the gate must not skip dismissActiveWidget()"
    );

    // The keyboard shortcut never passes through mouseup, so the same check is
    // needed at the entry point it does use. Without it the rendering was
    // suppressed downstream while a billable translation had already run --
    // silent from the user's side, not free from ours.
    const runLogic = contentSource.match(/async function runLogic\([\s\S]*?\n\}/)?.[0];
    assert.ok(runLogic, "expected runLogic");
    const runLogicGate = runLogic.indexOf("if (!extensionEnabledForSite) {");
    const storageRead = runLogic.indexOf("chrome.storage.local.get");
    assert.ok(runLogicGate !== -1, "runLogic must check the exclusion state");
    assert.ok(
        runLogicGate < storageRead,
        "the check must come before any work is done"
    );

    // Excluding a site takes effect without a reload (#48's requirement), and
    // that has to cover the controls, not only the highlights.
    const stateChange = contentSource.match(
        /function handleExtensionStateChange\(enabled\)[\s\S]*?\n\}/
    )?.[0];
    assert.ok(stateChange, "expected handleExtensionStateChange");
    const disabledBranch = stateChange.slice(stateChange.indexOf("} else {"));
    assert.match(
        disabledBranch,
        /dismissActiveWidget\(\);/,
        "excluding a site must tear down any control already open"
    );

    // Stale copy: the sentence control still advertised "(Premium)" after #28
    // was closed and the gate became the trial.
    assert.equal(
        contentSource.includes('"Save sentence (Premium)"'),
        false,
        "the sentence control must not advertise a premium tier"
    );
});

test("exclusion entries are removed by data, not by the row's rendered text", async () => {
    const popupSource = await readFile(path.join(repositoryRoot, "popup.js"), "utf8");

    // A row is `<li><span>site</span><button>×</button></li>`, so
    // `li.textContent` is `chatgpt.com×`. Both removal paths compared that
    // against storage, matched nothing, and the "×" did nothing.
    //
    // The toggle path was worse: it used the same comparison to FIND the row,
    // never found it, and then called `.remove()` on undefined. That threw
    // before the storage write at the end of the function, so re-enabling a
    // site silently did nothing at all.
    assert.equal(
        /node\.textContent\.trim\(\) === currentSiteHostname/.test(popupSource),
        false,
        "the toggle must not identify a row by its rendered text"
    );
    assert.equal(
        /button\.parentElement\.textContent\.trim\(\)/.test(popupSource),
        false,
        "removal must not read the site name out of the row's text"
    );
    assert.match(popupSource, /listItem\.dataset\.site = String\(text \|\| ""\);/);

    const remove = popupSource.match(
        /async function removeSiteFromExclusion\(e\)[\s\S]*?\n\}/
    )?.[0];
    assert.ok(remove, "expected removeSiteFromExclusion");
    assert.match(remove, /listItem\.dataset\.site/);

    // The row used to be removed unconditionally, so a failed removal still
    // looked like it worked until the panel was reopened.
    const removedIndex = remove.indexOf("listItem.remove();");
    const guardIndex = remove.indexOf("updatedList.length === result.excludedSites.length");
    assert.ok(guardIndex !== -1, "a no-op removal must not touch the DOM");
    assert.ok(guardIndex < removedIndex, "the guard must run before the row is removed");
    // Storage first, then the UI, so the panel never shows a state that was
    // not persisted.
    assert.ok(
        remove.indexOf("chrome.storage.local.set") < removedIndex,
        "storage must be written before the row is removed"
    );

    // Exercise the two filters, rather than asserting they look right.
    const context = vm.createContext({});
    vm.runInContext(
        [
            popupSource.match(/function normalizeExcludedSite\(value\)[\s\S]*?\n\}/)[0],
            popupSource.match(/function hostnameMatches\(hostname, excludedHostname\)[\s\S]*?\n\}/)[0]
        ].join("\n"),
        context
    );
    const { normalizeExcludedSite, hostnameMatches } = context;

    const removeFrom = (list, target) => {
        const normalized = normalizeExcludedSite(target);
        return list.filter((site) => normalizeExcludedSite(site) !== normalized);
    };
    assert.deepEqual(
        removeFrom(["developer.chrome.com", "chatgpt.com"], "chatgpt.com"),
        ["developer.chrome.com"]
    );
    // The value the old code actually compared with.
    assert.deepEqual(
        removeFrom(["developer.chrome.com", "chatgpt.com"], "chatgpt.com×"),
        ["developer.chrome.com", "chatgpt.com"],
        "the old comparison could never match -- this is the reported bug"
    );
    assert.deepEqual(removeFrom(["ChatGPT.com"], "chatgpt.com"), []);

    // Enabling a site must clear a parent-domain entry too, or the site is
    // re-disabled as soon as the list is re-read.
    const enableFilter = (list, host) => list.filter((site) => !hostnameMatches(host, site));
    assert.deepEqual(enableFilter(["example.com", "other.com"], "www.example.com"), ["other.com"]);

    // Duplicates would defeat the normalised removal: one click clears both
    // storage entries while only one row disappears.
    assert.match(popupSource, /const alreadyExcluded = result\.excludedSites\.some\(/);
});

test("the per-site switch rests ON, and names the site", async () => {
    const popupHtml = await readFile(path.join(repositoryRoot, "popup.html"), "utf8");
    const popupJs = await readFile(path.join(repositoryRoot, "popup.js"), "utf8");
    const popupCss = await readFile(path.join(repositoryRoot, "popup.css"), "utf8");

    assert.match(popupHtml, /Translate this site/);
    assert.match(popupHtml, /<span class="switch-label-site" id="currentSiteName">/);
    assert.match(popupHtml, /<input type="checkbox" id="translateThisSite" \/>/);

    // The id has to move with the meaning, every time the meaning moves. An
    // input called `enableExtension` whose checked state meant "excluded" is
    // the read-it-from-the-wrong-place trap that broke removal in this panel;
    // `disableTranslationForSite` now reads backwards for the same reason.
    const htmlCode = popupHtml.replace(/<!--[\s\S]*?-->/g, "");
    const jsCode = popupJs
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
    for (const stale of ["enableExtension", "disableTranslationForSite", "disableTranslationCheckbox"]) {
        assert.equal(htmlCode.includes(stale), false, `${stale} must not survive in the markup`);
        assert.equal(jsCode.includes(stale), false, `${stale} must not survive in the script`);
    }

    // One place owns the assignment. Four call sites used to set `.checked` by
    // hand, and any of them could have drifted from the rest.
    const sync = popupJs.match(/function syncSiteSwitch\(\)[\s\S]*?\n\}/)?.[0];
    assert.ok(sync, "expected syncSiteSwitch");
    const assignments = jsCode.match(/siteTranslationCheckbox\.checked\s*=/g) || [];
    assert.equal(
        assignments.length,
        1,
        "the checkbox state must only be set inside syncSiteSwitch"
    );

    // The reported behaviour, run rather than pattern-matched: open the panel
    // on a site nobody has excluded and the switch is already on.
    const context = vm.createContext({ URL });
    vm.runInContext(
        [
            popupJs.match(/function getSiteHostname\(site\)[\s\S]*?\n\}/)[0],
            popupJs.match(/function hostnameMatches\(hostname, excludedHostname\)[\s\S]*?\n\}/)[0],
            popupJs.match(/function checkIfCurrentSiteEnabled\(\)[\s\S]*?\n\}/)[0],
            sync,
            `var currentSite, excludedSites, isEnabled;
             var siteTranslationCheckbox = { checked: null, disabled: null, closest: () => null };
             var currentSiteNameLabel = { textContent: "", title: "" };
             function openPanelOn(url, list) {
                 currentSite = url;
                 excludedSites = list;
                 isEnabled = checkIfCurrentSiteEnabled();
                 syncSiteSwitch();
                 return siteTranslationCheckbox;
             }`
        ].join("\n"),
        context
    );
    const { openPanelOn, currentSiteNameLabel } = context;

    assert.equal(
        openPanelOn("https://www.linkedin.com/feed/", []).checked,
        true,
        "a site nobody excluded must open with translation showing as on"
    );
    assert.equal(currentSiteNameLabel.textContent, "www.linkedin.com");
    assert.equal(
        openPanelOn("https://www.linkedin.com/feed/", ["linkedin.com"]).checked,
        false,
        "an excluded site -- parent domain included -- must show as off"
    );

    // Checked now means "translation is on", so the branch that CLEARS
    // exclusions is the checked one.
    const toggle = popupJs.match(/async function toggleExtensionState\(\)[\s\S]*?\n\}/)?.[0];
    assert.ok(toggle, "expected toggleExtensionState");
    assert.match(toggle, /if \(siteTranslationCheckbox\.checked\) \{/);
    const clearIndex = toggle.indexOf("excludedSites.filter(");
    const addIndex = toggle.indexOf("[...excludedSites, currentSiteHostname]");
    assert.ok(clearIndex !== -1 && addIndex !== -1);
    assert.ok(clearIndex < addIndex, "checked clears the exclusion, unchecked adds it");

    // A local file or about:blank has no hostname. Leaving the switch live
    // would store an empty entry, which hostnameMatches then matches against
    // nothing -- a toggle that appears to do nothing at all.
    //
    // Note this does not cover chrome:// pages: `chrome` is a non-special
    // scheme, so `new URL("chrome://extensions").hostname` is "extensions",
    // and the switch there stays live and would store that as a host.
    assert.equal(openPanelOn("about:blank", []).disabled, true);
    assert.equal(currentSiteNameLabel.textContent, "No site to translate");
    assert.match(sync, /classList\.toggle\("switch-unavailable", !actionable\)/);
    assert.match(toggle, /if \(!currentSiteHostname\) \{\s*syncSiteSwitch\(\);\s*return;/);

    // Hostnames have no spaces to wrap at, so an untruncated one would widen
    // the panel. Verified by measurement: a 62-character host renders a 304px
    // box over 323px of content and the body does not scroll horizontally.
    assert.match(popupCss, /\.switch-label-site \{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/);
    assert.match(popupCss, /\.switch\.switch-unavailable \{[\s\S]*?opacity: 0\.55;/);
    assert.match(sync, /currentSiteNameLabel\.title = hostname \|\| "";/);
});

test("a control still fires when the page swallows clicks in the capture phase", async () => {
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");

    // Reported on a Google results page: selecting a word raises Google's own
    // "Translate" bubble in the same spot, and clicking our "+" over it did
    // nothing.
    //
    // A listener on the button is the LAST thing a click reaches -- dispatch
    // runs window -> document -> ... -> target. Any page that registers a
    // capture-phase click listener on `document` and calls stopPropagation()
    // (UI that manages its own popups routinely does) silences every control
    // we own. Being in a shadow root does not help: the event descends through
    // the page's light-DOM ancestors first.
    assert.match(contentSource, /window\.addEventListener\(\s*"click",[\s\S]*?true\s*\)/);

    // No control may keep its own click listener, or it inherits the problem.
    // Plain string checks: the point is that this exact call shape is absent.
    for (const control of ["button", "deleteButton", "saveButton"]) {
        assert.equal(
            contentSource.includes(control + '.addEventListener("click"'),
            false,
            control + " must be activated through the capture-phase router, not its own listener"
        );
        assert.equal(
            contentSource.includes(control + ".addEventListener('click'"),
            false,
            control + " must be activated through the capture-phase router, not its own listener"
        );
    }
    assert.equal((contentSource.match(/setControlActivation\(/g) || []).length >= 5, true);

    // Behaviour, not shape: run the real activation router against a page that
    // kills clicks at document capture, exactly as the reported page does.
    const routerSource = contentSource.match(
        /const CONTROL_ACTIVATION = new WeakMap\(\);[\s\S]*?\n\);/
    )?.[0];
    assert.ok(routerSource, "expected the activation router");

    const listeners = { window: [], document: [] };
    const context = vm.createContext({
        WeakMap,
        console,
        window: {
            addEventListener: (type, handler, capture) =>
                listeners.window.push({ type, handler, capture })
        }
    });
    vm.runInContext(routerSource, context);

    const button = { id: "add-new-word" };
    let fired = 0;
    context.setControlActivation(button, () => { fired += 1; });

    const registration = listeners.window.find((l) => l.type === "click");
    assert.ok(registration, "the router must listen for click");
    assert.equal(registration.capture, true, "on window, in the capture phase -- the earliest point in dispatch");

    // The page's own capture listener on `document` would run AFTER this one,
    // so by the time it calls stopPropagation the action has already happened.
    const hostBubble = { id: "google-translate-bubble" };
    registration.handler({
        composedPath: () => [button, hostBubble, "shadow-host", "documentElement", "window"]
    });
    assert.equal(fired, 1, "the control must act before the page can cancel the event");

    // A click that misses every control activates nothing.
    registration.handler({ composedPath: () => [hostBubble, "documentElement"] });
    assert.equal(fired, 1);

    // Only the innermost matching control acts, so a control nested in another
    // cannot trigger two actions from one click.
    const outer = { id: "outer" };
    context.setControlActivation(outer, () => { fired += 10; });
    registration.handler({ composedPath: () => [button, outer] });
    assert.equal(fired, 2, "the first match in the path wins, and only it");
});

test("one boundary rule for every matcher, and it works outside ASCII (#72)", async () => {
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");

    // Pure and DOM-free, so it is extracted and executed rather than
    // pattern-matched -- same style as classifySelectionType above.
    const helperSource = [
        contentSource.match(/function escapeRegExp\(value\)[\s\S]*?\r?\n}\r?\n/)?.[0],
        contentSource.match(/const WORD_EDGE_BEFORE[\s\S]*?function wordMatchExpression\(words\)[\s\S]*?\r?\n}\r?\n/)?.[0],
    ];
    assert.ok(helperSource[0] && helperSource[1], "expected the shared matcher");
    const context = vm.createContext({});
    vm.runInContext(helperSource.join("\n"), context);
    const matches = (word, text) => {
        const expression = context.wordMatchExpression(word);
        expression.lastIndex = 0;
        return expression.test(text);
    };

    // The reported bug: a saved `a` rendered inside unrelated words.
    assert.equal(matches("a", "tya Bely"), false);
    assert.equal(matches("a", "In a Max"), true);
    assert.equal(matches("a", "Max"), false);

    // Still matches where it should: sentence edges and next to punctuation
    // are the cases a naive "surround with spaces" fix would break.
    assert.equal(matches("dog", "dog runs"), true);
    assert.equal(matches("dog", "the dog"), true);
    assert.equal(matches("dog", "a dog, then"), true);
    assert.equal(matches("dog", "(dog)"), true);
    assert.equal(matches("dog", "dogs run"), false);
    assert.equal(matches("dog", "hotdog"), false);

    /*
      The reason \b could not simply be kept. It is defined against
      [A-Za-z0-9_], so a Cyrillic letter is a NON-word character to it and
      /\bвін\b/ matches nothing at all in "це він тут" -- meaning saved words
      in Cyrillic, Greek and accented scripts have never highlighted. Asserted
      both ways: the old rule fails the case, the new one passes it.
    */
    assert.equal(/\bвін\b/giu.test("це він тут"), false, "this is what \b did");
    assert.equal(matches("він", "це він тут"), true);
    assert.equal(matches("він", "це вінтаж тут"), false);
    assert.equal(matches("Ελλάδα", "στην Ελλάδα σήμερα"), true);
    assert.equal(matches("café", "un café noir"), true);
    assert.equal(matches("café", "deux cafés"), false);

    // Digits are word characters for this purpose: `2` inside `2026` is not an
    // occurrence of the saved word `2`.
    assert.equal(matches("2", "in 2026"), false);
    assert.equal(matches("2", "part 2 here"), true);

    // Longest-first, or a saved "New" would consume the start of a saved
    // "New York" that begins at the same offset.
    assert.deepEqual(
        // Spread into this realm's Array: the split is performed by the vm
        // context's RegExp, so the array it builds has that realm's prototype
        // and deepStrictEqual would reject it on identity alone.
        [..."New York today".split(context.wordMatchExpression(["New", "New York"]))],
        ["", "New York", " today"]
    );

    assert.equal(context.wordMatchExpression([]), null);
    assert.equal(context.wordMatchExpression(""), null);

    // Regex metacharacters in a saved word must not become syntax.
    assert.equal(matches("c++", "learning c++ now"), true);
    assert.equal(matches("c++", "learning cxx now"), false);

    // All three call sites share it. Three matchers that each spelled out
    // their own boundary is exactly how they drifted apart.
    const code = contentSource
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
    assert.equal(
        code.includes("\\b"),
        false,
        "no matcher may spell out an ASCII word boundary any more"
    );
    for (const caller of [
        /function replaceTextNode\(node, targetWords, translations\)[\s\S]*?wordMatchExpression\(targetWords\)/,
        /function showTemporaryHighlightWithLoader\(text\)[\s\S]*?wordMatchExpression\(text\)/,
        /function countWordOccurrences\(textNodes, word\)[\s\S]*?wordMatchExpression\(word\)/,
    ]) {
        assert.match(code, caller);
    }

    // A global regex reused across nodes carries lastIndex between calls; the
    // in-flight highlighter tests it against every text node on the page.
    const inFlight = contentSource.match(
        /function showTemporaryHighlightWithLoader\(text\)[\s\S]*?\r?\n}\r?\n/
    )?.[0];
    assert.ok(inFlight);
    assert.match(inFlight, /matcher\.lastIndex = 0;/);
});

test("only things with a letter in them are treated as words (#71)", async () => {
    const contentSource = await readFile(path.join(repositoryRoot, "content.js"), "utf8");

    const classifierSource = contentSource.match(
        /const CONTAINS_LETTER[\s\S]*?function classifySelectionType\(text\)[\s\S]*?\r?\n}\r?\n/
    )?.[0];
    assert.ok(classifierSource, "expected the classifier");
    const context = vm.createContext({});
    vm.runInContext(classifierSource, context);
    const classify = (text) => context.classifySelectionType(text);

    // The reported junk. Each of these was translated -- a paid call -- and
    // written to the dictionary.
    for (const junk of ["|", "7", "2026", "©", "—", "🙂", "...", "$", "42%"]) {
        assert.equal(classify(junk), "not-a-word", `${junk} must be refused`);
    }

    // URLs and identifiers have letters in them, so the letter rule alone
    // would pass them.
    const backslash = String.fromCharCode(92);
    for (const shape of [
        "https://example.com",
        "user_name",
        "example.com",
        "a@b.com",
        `C:${backslash}Users`,
    ]) {
        assert.equal(classify(shape), "not-a-word", `${shape} must be refused`);
    }

    // Real words still classify as before, INCLUDING single letters: `I` and
    // `a` are English words, `я` and `і` Ukrainian ones, and one-character
    // words are ordinary in CJK. A length rule would have broken all of them.
    assert.equal(classify("dog"), "word");
    assert.equal(classify("I"), "word");
    assert.equal(classify("a"), "word");
    assert.equal(classify("я"), "word");
    assert.equal(classify("水"), "word");
    assert.equal(classify("café"), "word");
    assert.equal(classify("don't"), "word");
    assert.equal(classify("well-known"), "word");
    // Digits inside a real word are allowed: refusing `covid19` to catch `h1`
    // blocks something a user wants in order to prevent something harmless.
    assert.equal(classify("covid19"), "word");
    assert.equal(classify("New York City"), "phrase");

    // A sentence is not held to the URL rule -- prose containing an address is
    // still prose, and refusing it would be a new bug in place of the old one.
    assert.equal(
        classify("Go to example.com for the rest of the story."),
        "sentence"
    );
    assert.equal(
        classify("This is a full sentence with several words in it."),
        "sentence"
    );

    assert.equal(classify(""), null);
    assert.equal(classify("   "), null);

    const code = contentSource
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");

    // Refused before the control is built, so no "+" appears that would then
    // do nothing.
    const handler = code.match(/const selectionType = classifySelectionType\(selectedText\);[\s\S]*?const button = document\.createElement\("button"\);/)?.[0];
    assert.ok(handler, "expected the mouseup control path");
    assert.match(handler, /selectionType === "not-a-word"/);
    assert.match(handler, /return;/);

    // And refused again inside runLogic, which the keyboard shortcut reaches
    // without passing the mouseup handler at all. This is the check that keeps
    // a refusal from costing a provider call.
    const runLogicSource = code.match(/async function runLogic\(selectedText, rect\)[\s\S]*?\r?\n}\r?\n/)?.[0];
    assert.ok(runLogicSource, "expected runLogic");
    const guardIndex = runLogicSource.indexOf('classifySelectionType(originalWord) === "not-a-word"');
    const translateIndex = runLogicSource.indexOf("saveWordToDictionary(originalWord)");
    assert.ok(guardIndex !== -1, "runLogic must refuse a non-word");
    assert.ok(
        guardIndex < translateIndex,
        "the refusal must come before the call that costs a translation"
    );
});
