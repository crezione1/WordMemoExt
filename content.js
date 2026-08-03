let settings = {};
const countedWordIdsOnPage = new Set();

// Exclusion-list gating (#48)
//
// Whether LazyLex is allowed to render on this page. The background service
// worker owns the exclusion list; the content script only ever mirrors the
// answer here. Two things keep this flag honest:
//
//   1. `checkInitialExtensionState()` resolves it from the background worker
//      at bootstrap, and the first highlight pass is chained onto that
//      promise rather than racing it. Before this existed the check was
//      defined but never called, so an excluded site still highlighted.
//   2. The "extensionStateChanged" broadcast updates it live, so toggling a
//      site removes (or restores) the translations on an already-open page
//      with no reload.
//
// It defaults to `true` so that a page is never left permanently blank if
// the service worker is slow or unreachable; the broadcast corrects it.
let extensionEnabledForSite = true;

function setExtensionEnabledForSite(enabled) {
    // Anything other than an explicit `false` (including an undefined
    // response from a torn-down service worker) means "render".
    extensionEnabledForSite = enabled !== false;
    return extensionEnabledForSite;
}

// Selection classification (word / phrase / sentence)
//
// Sentence saving is a premium-only feature with its own backend contract
// and private per-user storage (see issue #28). Word/phrase selection must
// keep working exactly as before, so this only needs to reliably recognize
// "this selection is sentence-shaped" and route those (and only those)
// selections down a different path -- it is intentionally conservative
// about calling something a sentence.
const SENTENCE_MAX_LENGTH = 500;

// Pure, side-effect free so it can be unit tested directly (see
// tests/local-build.test.mjs), matching this repo's existing no-DOM-
// dependency test style for content.js logic.
function classifySelectionType(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) {
        return null;
    }

    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    const endsWithSentencePunctuation = /[.!?]["'’”)\]]?$/.test(trimmed);
    const isSentence = wordCount >= 6
        || trimmed.length > 120
        || (wordCount >= 3 && endsWithSentencePunctuation);

    if (isSentence) {
        return "sentence";
    }

    return wordCount > 1 ? "phrase" : "word";
}

// YouTube SPA navigation handling
//
// YouTube swaps videos through client-side (pushState-based) navigation, so
// the content script is never re-injected between videos. Without explicit
// handling, LazyLex wrappers created for the previous video's title/page
// text are never cleaned up and sit on screen next to the new video.

const YOUTUBE_HOSTNAMES = new Set(["www.youtube.com", "youtube.com", "m.youtube.com"]);

function getYouTubeVideoIdFromUrl(url) {
    try {
        const parsed = new URL(url);
        if (!YOUTUBE_HOSTNAMES.has(parsed.hostname)) {
            return null;
        }
        if (parsed.pathname === "/watch") {
            return parsed.searchParams.get("v");
        }
        const shortsMatch = parsed.pathname.match(/^\/shorts\/([^/?#]+)/);
        if (shortsMatch) {
            return shortsMatch[1];
        }
        return null;
    } catch (error) {
        return null;
    }
}

// Pure decision helper (kept side-effect free and exported to the file's
// top level so it can be unit tested in isolation): given the video id we
// last processed and a candidate URL, decide whether this is a transition
// to a genuinely different video that requires a DOM cleanup + reprocess.
function isNewYouTubeNavigation(previousVideoId, url) {
    const videoId = getYouTubeVideoIdFromUrl(url);
    return {
        videoId,
        isNewVideo: videoId !== null && videoId !== previousVideoId
    };
}

function isYouTubeHost(hostname = window.location.hostname) {
    return YOUTUBE_HOSTNAMES.has(hostname);
}

let lastProcessedYouTubeVideoId = isYouTubeHost() ? getYouTubeVideoIdFromUrl(window.location.href) : null;
let youtubeNavigationHandlersInstalled = false;
let youtubeNavigationChain = Promise.resolve();

// Removes every LazyLex-owned DOM node (wrappers, highlights, translations,
// delete controls) and reprocesses the current word list against the
// current DOM exactly once. Reuses the same clear+highlight primitives the
// "reload" wordsChanged broadcast already relies on, so there is a single,
// already-tested code path for "wipe the page and rehighlight."
async function resyncHighlightsForCurrentPage() {
    clearHighlighting();
    const existingDeleteButton = document.getElementById("deleteWordBtn");
    if (existingDeleteButton) {
        existingDeleteButton.remove();
    }

    if (!extensionEnabledForSite) {
        // Excluded site: the cleanup above is still correct (stale wrappers
        // from a previous video must go), but nothing may be re-rendered.
        return;
    }

    const { words } = await chrome.storage.local.get({ words: [] });
    if (words && words.length > 0) {
        await highlightWords(words);
    }
}

// YouTube renders the new video's metadata asynchronously after
// yt-navigate-finish fires, so poll briefly (bounded attempts) for the
// title element to carry text before reprocessing, instead of racing it.
function waitForYouTubeTitleReady(videoId, attemptsLeft = 10) {
    return new Promise((resolve) => {
        const titleElement = document.querySelector(
            "#title h1, ytd-watch-metadata h1, h1.ytd-watch-metadata, #container h1.title"
        );
        const isStillCurrent = getYouTubeVideoIdFromUrl(window.location.href) === videoId;
        const hasTitleText = !!(titleElement && titleElement.textContent && titleElement.textContent.trim());

        if (!isStillCurrent || hasTitleText || attemptsLeft <= 0) {
            resolve();
            return;
        }

        setTimeout(() => resolve(waitForYouTubeTitleReady(videoId, attemptsLeft - 1)), 150);
    });
}

function handleYouTubeNavigation(url = window.location.href) {
    if (!isYouTubeHost()) {
        return;
    }

    const { videoId, isNewVideo } = isNewYouTubeNavigation(lastProcessedYouTubeVideoId, url);
    if (!isNewVideo) {
        return;
    }
    lastProcessedYouTubeVideoId = videoId;

    // Chain onto any in-flight navigation handling so overlapping triggers
    // (yt-navigate-finish, the pushState hook, and the polling fallback can
    // all fire for the same transition) process the new video exactly once
    // instead of racing or duplicating cleanup/highlight work.
    youtubeNavigationChain = youtubeNavigationChain
        .then(() => waitForYouTubeTitleReady(videoId))
        .then(() => resyncHighlightsForCurrentPage())
        .catch((error) => {
            console.warn(
                "[LazyLexExt] Unable to refresh highlights after YouTube navigation:",
                error?.message || error
            );
        });
}

function installYouTubeNavigationHandlers() {
    if (youtubeNavigationHandlersInstalled || !isYouTubeHost()) {
        return;
    }
    youtubeNavigationHandlersInstalled = true;

    // Primary signal: YouTube's own SPA router dispatches these on window.
    window.addEventListener("yt-navigate-start", () => clearHighlighting());
    window.addEventListener("yt-navigate-finish", () => handleYouTubeNavigation());

    // Fallback signal: some navigations (or older/changed YouTube markup)
    // may not dispatch the events above. Cover both pushState-driven
    // navigation and browser Back/Forward.
    const originalPushState = history.pushState;
    history.pushState = function (...args) {
        const result = originalPushState.apply(this, args);
        handleYouTubeNavigation();
        return result;
    };
    window.addEventListener("popstate", () => handleYouTubeNavigation());

    // Last-resort fallback in case none of the above fire for a given
    // transition; cheap (a URL parse) and only runs on YouTube hosts.
    setInterval(() => handleYouTubeNavigation(), 1000);
}

if (isYouTubeHost()) {
    installYouTubeNavigationHandlers();
}

// Saving/deleting words

async function deleteWordFromStorage(wordId) {
    const response = await chrome.runtime.sendMessage({
        action: "deleteWord",
        wordId: Number(wordId)
    });
    if (!response?.success) {
        throw new Error(response?.error?.message || "Unable to delete the word.");
    }
}

async function updateWordInStorage(wordId, newTranslation) {
    const { words } = await chrome.storage.local.get(["words"]);
    const word = (words || []).find((item) => item.id === Number(wordId));
    if (!word) {
        throw new Error("The word is no longer in your dictionary.");
    }

    const response = await chrome.runtime.sendMessage({
        action: "persistWord",
        word: {
            ...word,
            translation: newTranslation,
            lastUpdated: Date.now()
        }
    });
    if (!response?.success) {
        throw new Error(response?.error?.message || "Unable to update the translation.");
    }
}

async function runLogic(selectedText, rect) {
    // Clean the selection to only get the original word, not the translation
    const originalWord = selectedText.split('[')[0].trim();
    if (!originalWord) return;

    console.log('[LazyLexExt] runLogic called with:', originalWord);

    const { words } = await chrome.storage.local.get(["words"]) || [];
    const wordList = words || [];
    const wordExists = wordList.some(w => w.word.toLowerCase() === originalWord.toLowerCase());

    if (wordExists) {
        console.log(`Word "${originalWord}" already exists.`);
        return;
    }

    // Provide immediate UI feedback
    if (settings["animationToggle"]) {
        animateWordToToolbar(originalWord, rect);
    }
    showTemporaryHighlightWithLoader(originalWord);

    // Perform saving and translation in the background
    saveWordToDictionary(originalWord).catch((error) => {
        console.error("Error saving word:", error);
        removeTemporaryHighlight(originalWord);
        showContentNotification(error?.message || "Unable to save this word.", "error");
    });
}

// Replace saveWordToDictionary to use local storage and GPT API for translation
async function saveWordToDictionary(word) {
    console.log('[LazyLexExt] saveWordToDictionary called with:', word);
        
    const limitCheck = await chrome.runtime.sendMessage({ action: "checkSubscriptionLimits" });
    if (!limitCheck.canAdd && limitCheck.reason === 'daily_limit_reached') {
        showSubscriptionLimitNotification();
        throw new Error("Daily word limit reached.");
    }

    const { words } = await chrome.storage.local.get({ words: [] });
    const baseWord = (word || '').trim().toLowerCase();
    if (!baseWord) {
        throw new Error("Select a word before saving.");
    }

    const tr = await translateWithTAS(baseWord, settings["languageCode"] || "uk");
    const translation = String(tr.translation || "").trim();
    if (!translation) {
        throw new Error("LazyLex did not return a translation. Please try again.");
    }
    const synonyms = Array.isArray(tr.synonyms) ? tr.synonyms : [];
    const examples = Array.isArray(tr.examples) ? tr.examples : [];
    let newId = Date.now();
    const ids = new Set((words || []).map(w => Number(w.id)));
    while (ids.has(newId)) newId += 1;
    const newWord = {
        id: newId,
        word: baseWord,
        translation,
        dateAdded: Date.now(),
        status: "new",
        learned: false,
        encounterCount: 0,
        synonyms,
        examples
    };

    const response = await chrome.runtime.sendMessage({
        action: "persistWord",
        word: newWord
    });
    if (!response?.success) {
        throw new Error(response?.error?.message || "Unable to save the word.");
    }

    // The current page updates immediately; the background notification keeps
    // other extension surfaces synchronized.
    addHighlightForWord(response.word || newWord);
    return response.word || newWord;
}

// Implement translateWithTAS by delegating to Firebase callable function (minimal change)
async function translateWithTAS(word, targetLang) {
    try {
        console.log('[LazyLexExt] translateWithTAS request', { word, targetLang });
        const response = await chrome.runtime.sendMessage({
            action: 'translateWord',
            word,
            targetLanguage: targetLang || 'uk'
        });
        if (response && response.success && response.result && response.result.translation) {
            console.log('[LazyLexExt] translateWithTAS success', { word, translation: response.result.translation, synonymsCount: (response.result.synonyms||[]).length });
            return response.result;
        }
        throw new Error(response?.error?.message || response?.error || 'Translate failed');
    } catch (e) {
        console.warn('[LazyLexExt] translateWithTAS failed:', e?.message || e);
        throw e;
    }
}

function showSubscriptionLimitNotification() {
    // Remove any existing notification
    const existingNotification = document.getElementById('lazylex-limit-notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    // Create notification element
    const notification = document.createElement('div');
    notification.id = 'lazylex-limit-notification';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #ff9d7b, #e17e5d);
        color: white;
        padding: 16px 20px;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(255, 157, 123, 0.4);
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        font-weight: 600;
        max-width: 320px;
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        animation: slideInRight 0.3s ease-out;
    `;

    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:8px";

    const title = document.createElement("div");
    title.style.cssText = "font-size:16px;font-weight:700";
    title.textContent = "Daily Limit Reached";

    const closeButton = document.createElement("button");
    closeButton.id = "lazylex-close-notification";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Dismiss notification");
    closeButton.style.cssText = "background:none;border:none;color:white;cursor:pointer;font-size:18px;padding:0;width:44px;height:44px";
    closeButton.textContent = "×";

    const description = document.createElement("div");
    description.style.cssText = "margin-bottom:12px;opacity:.9;line-height:1.4";
    description.textContent = "You've reached your daily limit of 5 words. Upgrade to Premium for unlimited words!";

    const upgradeButton = document.createElement("button");
    upgradeButton.id = "lazylex-upgrade-btn";
    upgradeButton.type = "button";
    upgradeButton.style.cssText = "background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.3);color:white;padding:10px 16px;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px;transition:all .2s ease;width:100%;min-height:44px";
    upgradeButton.textContent = "Upgrade to Premium";

    header.append(title, closeButton);
    notification.append(header, description, upgradeButton);

    // Add animation styles
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOutRight {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
        #lazylex-upgrade-btn:hover {
            background: rgba(255, 255, 255, 0.3) !important;
            transform: translateY(-1px);
        }
    `;
    document.head.appendChild(style);

    document.body.appendChild(notification);

    // Add event listeners
    document.getElementById('lazylex-close-notification').addEventListener('click', () => {
        notification.style.animation = 'slideOutRight 0.3s ease-in';
        setTimeout(() => notification.remove(), 300);
    });

    document.getElementById('lazylex-upgrade-btn').addEventListener('click', () => {
        window.open('https://lazylex.com/#/pricing', '_blank');
        notification.style.animation = 'slideOutRight 0.3s ease-in';
        setTimeout(() => notification.remove(), 300);
    });

    // Auto-remove after 8 seconds
    setTimeout(() => {
        if (document.getElementById('lazylex-limit-notification')) {
            notification.style.animation = 'slideOutRight 0.3s ease-in';
            setTimeout(() => notification.remove(), 300);
        }
    }, 8000);
}

function removeTemporaryHighlight(text) {
    const normalizedText = String(text || "").toLocaleLowerCase();
    const parentsToNormalize = new Set();
    document.querySelectorAll(".highlight-wrapper:not([data-word-id])").forEach((wrapper) => {
        if (String(wrapper.dataset.originalText || "").toLocaleLowerCase() !== normalizedText) {
            return;
        }
        const parent = wrapper.parentNode;
        if (parent) {
            parent.replaceChild(document.createTextNode(wrapper.dataset.originalText || ""), wrapper);
            parentsToNormalize.add(parent);
        }
    });
    parentsToNormalize.forEach((parent) => parent.normalize());
}

function showContentNotification(message, type = "info") {
    const existing = document.getElementById("lazylex-status-notification");
    if (existing) {
        existing.remove();
    }

    const notification = document.createElement("div");
    notification.id = "lazylex-status-notification";
    notification.setAttribute("role", type === "error" ? "alert" : "status");
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        max-width: 340px;
        padding: 14px 18px;
        color: white;
        background: ${type === "error" ? "#b42318" : type === "success" ? "#1a7f45" : "#344054"};
        border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, .2);
        z-index: 999999;
        font: 600 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    `;
    notification.textContent = String(message || "LazyLex operation failed.");
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 5000);
}

// Premium sentence selection (issue #28)
//
// Sentences are gated to premium/lifetime users, never touch the shared
// word/phrase translation flow (translateWithTAS/translateWord), and are
// stored privately per-account -- see background.js's translateSentence
// handler and persistSentenceMutation/deleteSentenceMutation.

function showSentencePremiumNotification() {
    const existing = document.getElementById("lazylex-sentence-premium-notification");
    if (existing) {
        existing.remove();
    }

    const notification = document.createElement("div");
    notification.id = "lazylex-sentence-premium-notification";
    notification.setAttribute("role", "status");
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        max-width: 320px;
        padding: 16px 20px;
        color: white;
        background: linear-gradient(135deg, #ff9d7b, #e17e5d);
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(255, 157, 123, 0.4);
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;

    const title = document.createElement("div");
    title.style.cssText = "font-size:16px;font-weight:700;margin-bottom:8px";
    title.textContent = "Sentence Saving is Premium";

    const description = document.createElement("div");
    description.style.cssText = "margin-bottom:12px;opacity:.9;line-height:1.4;font-size:13px";
    description.textContent = "Saving and translating full sentences is a Premium feature. Word lookups stay free.";

    const upgradeButton = document.createElement("button");
    upgradeButton.type = "button";
    upgradeButton.id = "lazylex-sentence-upgrade-btn";
    upgradeButton.style.cssText = "background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.3);color:white;padding:10px 16px;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px;width:100%;min-height:44px";
    upgradeButton.textContent = "Upgrade to Premium";
    upgradeButton.addEventListener("click", () => {
        window.open("https://lazylex.com/#/pricing", "_blank");
        notification.remove();
    });

    notification.append(title, description, upgradeButton);
    document.body.appendChild(notification);

    setTimeout(() => notification.remove(), 8000);
}

function describeSentenceError(error) {
    const code = error?.code || "";
    if (code === "entitlement" || code.includes("403")) {
        return null; // Caller shows the premium upsell instead of a generic error.
    }
    if (code === "validation" || code.includes("400") || code.includes("413")) {
        return error?.message || `Sentences are limited to ${SENTENCE_MAX_LENGTH} characters.`;
    }
    if (code === "rate_limit" || code.includes("429")) {
        return "You've reached today's sentence limit. Try again tomorrow.";
    }
    if (code === "api/timeout" || code === "api/network") {
        return "Unable to reach LazyLex. Check your connection and try again.";
    }
    return "Unable to translate this sentence right now. Please try again.";
}

async function handleSentenceSelection(rawText) {
    const text = String(rawText || "").trim();
    if (!text) {
        return;
    }

    if (text.length > SENTENCE_MAX_LENGTH) {
        showContentNotification(
            `Sentences are limited to ${SENTENCE_MAX_LENGTH} characters. This selection is ${text.length}.`,
            "error"
        );
        return;
    }

    // Entitlement is checked here purely so a free user never triggers a
    // network call -- the background handler re-checks authoritatively
    // before it will call the translation backend.
    let subscription;
    try {
        subscription = await chrome.runtime.sendMessage({ action: "getSubscriptionStatus" });
    } catch (error) {
        subscription = null;
    }

    if (!subscription?.isPremium) {
        showSentencePremiumNotification();
        return;
    }

    showContentNotification("Translating sentence…", "info");

    try {
        const response = await chrome.runtime.sendMessage({
            action: "translateSentence",
            text,
            targetLanguage: settings["languageCode"] || "uk"
        });

        if (!response?.success) {
            const error = response?.error;
            const message = describeSentenceError(error);
            if (message === null) {
                showSentencePremiumNotification();
            } else {
                showContentNotification(message, "error");
            }
            return;
        }

        showContentNotification("Sentence saved to your private list.", "success");
    } catch (error) {
        showContentNotification(describeSentenceError({ code: "api/network" }), "error");
    }
}

function animateWordToToolbar(selectedText, rect) {
    if (!rect) return;

    const floatingWord = document.createElement("span");
    floatingWord.textContent = selectedText;
    floatingWord.style.position = "fixed";
    floatingWord.style.zIndex = "999999";
    floatingWord.style.background = "#ff6b35";
    floatingWord.style.border = "1px solid #3A8FC9FF";
    floatingWord.style.borderRadius = "5px";
    floatingWord.style.left = `${rect.left}px`;
    floatingWord.style.top = `${rect.top}px`;
    floatingWord.style.transition = "top 0.5s linear, left 0.5s linear";

    document.body.appendChild(floatingWord);

    setTimeout(() => {
        floatingWord.style.left = "95%";
        floatingWord.style.top = "5px";
    }, 50);

    setTimeout(() => {
        floatingWord.remove();
    }, 550);
}

// Highlighting/clearing highlighting saved words

function clearHighlighting() {
    const wrappers = document.querySelectorAll('span.highlight-wrapper');
    const parentsToNormalize = new Set();

    wrappers.forEach(wrapper => {
        const parent = wrapper.parentNode;
        if (parent) {
            const originalText = wrapper.dataset.originalText || '';
            parent.replaceChild(document.createTextNode(originalText), wrapper);
            parentsToNormalize.add(parent);
        }
    });

    parentsToNormalize.forEach(parent => parent.normalize());
}

function disableHighlightingDisplay() {
    document.querySelectorAll('span.highlight-wrapper').forEach(wrapper => {
        const highlighted = wrapper.querySelector('.highlighted-word');
        const translation = wrapper.querySelector('.translation');
        if (highlighted) {
            highlighted.classList.remove('highlighted-word', 'animate-border', 'animate-background');
        }
        if (translation) {
            translation.classList.remove('translation');
        }
    });
}

function showTemporaryHighlightWithLoader(text) {
    if (!extensionEnabledForSite) {
        return;
    }

    const textNodes = Array.from(findTextNodes(document.body));
    const lowerCaseText = text.toLowerCase();
    const replacements = [];

    textNodes.forEach(node => {
        if (node.parentNode.closest('.highlight-wrapper')) {
            return;
        }

        if (node.nodeValue.toLowerCase().includes(lowerCaseText)) {
            const fragment = document.createDocumentFragment();
            const parts = node.nodeValue.split(new RegExp(`(${escapeRegExp(text)})`, 'gi'));

            parts.forEach(part => {
                if (part.toLowerCase() === lowerCaseText) {
                    const wrapper = document.createElement('span');
                    wrapper.className = 'highlight-wrapper';
                    wrapper.dataset.originalText = part;

                    const highlightedSpan = document.createElement("span");
                    highlightedSpan.classList.add("highlighted-word");
                    highlightedSpan.textContent = part;

                    const loader = document.createElement('span');
                    loader.className = 'translation-loader';

                    wrapper.appendChild(highlightedSpan);
                    wrapper.appendChild(loader);
                    fragment.appendChild(wrapper);
                } else {
                    fragment.appendChild(document.createTextNode(part));
                }
            });
            replacements.push({ originalNode: node, newFragment: fragment });
        }
    });

    replacements.forEach(rep => {
        rep.originalNode.parentNode.replaceChild(rep.newFragment, rep.originalNode);
    });
}

function addHighlightForWord(word) {
    if (!extensionEnabledForSite) {
        // Saving a word from an excluded page still works (the user asked
        // for it); it just must not paint anything here. (#48 AC4)
        return;
    }

    if (word?.status === "learned" || word?.learned === true || Number(word?.encounterCount) > 200) {
        return;
    }

    // First, update any existing temporary highlight wrappers
    const existingWrappers = document.querySelectorAll('.highlight-wrapper');
    existingWrappers.forEach(wrapper => {
        if (!wrapper.dataset.wordId && wrapper.dataset.originalText.toLowerCase() === word.word.toLowerCase()) {
            const loader = wrapper.querySelector('.translation-loader');
            if (loader) loader.remove();

            const translationNode = document.createElement("span");
            translationNode.classList.add("translation");
            translationNode.textContent = `[${word.translation}]`;
            wrapper.appendChild(translationNode);

            wrapper.dataset.wordId = word.id;

            const highlightedSpan = wrapper.querySelector('.highlighted-word');
            if (highlightedSpan) {
                applyFrequencyTier(highlightedSpan, word);
                requestAnimationFrame(() => {
                    highlightedSpan.classList.add("animate-border");
                });

                setTimeout(() => {
                    highlightedSpan.classList.add("animate-background");
                }, 10);
            }
        }
    });

    // Then, scan the entire page for new instances of this word and highlight them
    const textNodes = Array.from(findTextNodes(document.body));
    const targetWord = word.word.toLowerCase();
    const translations = { [targetWord]: word };
    recordEncounterCounts([word], textNodes).catch((error) => {
        console.warn("Unable to record word encounters:", error?.message || error);
    });

    textNodes.forEach((node) => {
        if (node.nodeValue.toLowerCase().includes(targetWord) && !node.parentNode.closest('.highlight-wrapper')) {
            replaceTextNode(node, [targetWord], translations);
        }
    });

    if (!settings.highlightingEnabled) {
        disableHighlightingDisplay();
    }
}

function updateHighlightsForWord(word) {
    const wrappers = document.querySelectorAll(`.highlight-wrapper[data-word-id="${word.id}"]`);
    wrappers.forEach(wrapper => {
        const translationSpan = wrapper.querySelector('.translation');
        if (translationSpan) {
            translationSpan.textContent = `[${word.translation}]`;
            translationSpan.style.display = ''; // Ensure span is visible
        }
    });
}

function removeHighlightsForWord(word) {
    const wrappers = document.querySelectorAll(`.highlight-wrapper[data-word-id="${word.id}"]`);
    const parentsToNormalize = new Set();
    wrappers.forEach(wrapper => {
        const parent = wrapper.parentNode;
        if (parent) {
            const originalText = wrapper.dataset.originalText || '';
            parent.replaceChild(document.createTextNode(originalText), wrapper);
            parentsToNormalize.add(parent);
        }
    });
    parentsToNormalize.forEach(parent => parent.normalize());
}

function replaceTextNode(node, targetWords, translations) {
    const fragment = document.createDocumentFragment();
    const escapedWords = targetWords
        .filter(Boolean)
        .map(escapeRegExp)
        .sort((left, right) => right.length - left.length);
    if (escapedWords.length === 0) {
        return;
    }
    const parts = node.nodeValue.split(new RegExp(`\\b(${escapedWords.join('|')})\\b`, 'gi'));

    if (parts.length <= 1) {
        return; // No matches
    }

    parts.forEach(part => {
        const lowerPart = part.toLowerCase();
        if (targetWords.includes(lowerPart)) {
            const wrapper = document.createElement('span');
            wrapper.className = 'highlight-wrapper';
            wrapper.dataset.originalText = part;
            wrapper.dataset.wordId = translations[lowerPart].id;

            const highlightedSpan = document.createElement("span");
            highlightedSpan.classList.add("highlighted-word");
            highlightedSpan.textContent = part;
            applyFrequencyTier(highlightedSpan, translations[lowerPart]);

            requestAnimationFrame(() => {
                highlightedSpan.classList.add("animate-border");
            });

            setTimeout(() => {
                highlightedSpan.classList.add("animate-background");
            }, 10);

            wrapper.appendChild(highlightedSpan);

            const translationNode = document.createElement("span");
            translationNode.classList.add("translation");
            translationNode.textContent = `[${translations[lowerPart].translation}]`;
            wrapper.appendChild(translationNode);
            fragment.appendChild(wrapper);
        } else {
            fragment.appendChild(document.createTextNode(part));
        }
    });

    node.parentNode.replaceChild(fragment, node);
}

function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Where LazyLex refuses to render (#50).
//
// READ THIS BEFORE EDITING THE LIST.
//
// The distinction this list draws is *not* "interactive tag vs. not". It is
// **prose vs. chrome**: running text a learner reads, versus the controls
// they operate. Highlighting a control is actively harmful -- the injected
// "[translation]" span widens the control, wraps its label and drops a second
// click target on top of the first. The reported case was the
// developer.chrome.com sidebar rendering "Before[перед] you publish".
//
// The original list only named controls as HTML wrote them in 2005. Every
// modern component library (Material UI, Ant Design, Bootstrap, Radix)
// composes its controls out of generic <div>/<span> elements carrying ARIA
// roles, so all of them slipped straight through. The ARIA groups below are
// the composed equivalents of the native tags in the first group.
//
// LINK POLICY -- deliberate, do not "fix" it by adding `a` here:
//   A plain `<a href>` in body prose stays ELIGIBLE. Links inside article
//   text are exactly where a learner meets useful vocabulary, and #11
//   deliberately built capture-phase click isolation so a highlighted word
//   inside a link shows the LazyLex controls without navigating. Excluding
//   all anchors would silently undo that feature.
//   Navigation links are still excluded -- not because they are anchors, but
//   because they sit inside `nav` / `[role="navigation"]` / a menu / a
//   toolbar, which is the chrome half of the distinction.
//   The only anchors this list can reach are ones that are also composed
//   controls (e.g. `<a role="menuitem">`), which is correct.
//
// The last group catches bespoke focusable widgets that declare no role at
// all: anything the author put in the tab order is a control. `a[href]` is
// carved back out of it so a prose link that also carries an explicit
// tabindex keeps working, per the policy above.
//
// Role values are a token list, so `~=` is used rather than `=`; a
// `role="button link"` element is still a button. `menu*` and `tab*` are
// enumerated instead of prefix-matched on purpose: `role="tabpanel"` is a
// *content* container whose text is prose and must stay eligible.
//
// If this turns out to be too coarse, the fallback discussed in #50 is to
// decide by ancestry instead: a link whose nearest block ancestor is a `<p>`
// or `<li>` in an article is prose; one inside a `<nav>` or a toolbar is
// chrome.
const NON_PROSE_SELECTOR = [
    // Native controls, non-text content and editable regions.
    "script, style, noscript, textarea, input, select, option, button",
    "code, pre, svg, math, iframe, canvas, video, audio",
    "[contenteditable]:not([contenteditable='false'])",

    // Interactive containers that carry no ARIA role of their own.
    // `summary` is the clickable half of a <details>; clicking a `label`
    // activates its control.
    "nav, menu, summary, label",

    // ARIA-composed controls.
    // Note the absence of [role="link"]: it is the ARIA spelling of a plain
    // hyperlink, so it follows the same prose policy as <a href>.
    '[role~="button"], [role~="checkbox"], [role~="radio"]',
    '[role~="switch"], [role~="slider"], [role~="spinbutton"], [role~="searchbox"]',
    '[role~="combobox"], [role~="listbox"], [role~="option"]',
    '[role~="menu"], [role~="menubar"], [role~="menuitem"]',
    '[role~="menuitemcheckbox"], [role~="menuitemradio"]',
    '[role~="tab"], [role~="tablist"]',
    '[role~="navigation"], [role~="toolbar"], [role~="tree"], [role~="treeitem"]',
    '[role~="grid"], [role~="gridcell"], [role~="dialog"], [role~="alertdialog"]',

    // Anything that opens a popup, whatever it is built from.
    "[aria-haspopup]",

    // Bespoke focusable widgets with no role -- but never a plain prose link.
    '[tabindex]:not([tabindex="-1"]):not(a[href])'
].join(", ");

function isEligibleTextNode(node) {
    if (!node?.parentElement || !node.nodeValue || /^\s*$/.test(node.nodeValue)) {
        return false;
    }

    const parent = node.parentElement;
    if (parent.closest(NON_PROSE_SELECTOR)) {
        return false;
    }

    return !parent.closest(
        ".highlight-wrapper, #add-new-word, #add-new-sentence, #deleteWordBtn, #lazylex-limit-notification, #lazylex-status-notification, #lazylex-sentence-premium-notification"
    );
}

function findTextNodes(element) {
    if (!element) {
        return [];
    }

    const nodes = [];
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode(node) {
                return isEligibleTextNode(node)
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_REJECT;
            }
        }
    );

    while (walker.nextNode()) {
        nodes.push(walker.currentNode);
    }
    return nodes;
}

function getFrequencyTier(encounterCount) {
    const count = Number(encounterCount) || 0;
    if (count > 200) return "learned";
    if (count > 120) return "retained";
    if (count > 50) return "familiar";
    return "new";
}

function applyFrequencyTier(highlightedSpan, word) {
    highlightedSpan.classList.remove(
        "lazylex-frequency-new",
        "lazylex-frequency-familiar",
        "lazylex-frequency-retained"
    );
    if (settings.frequencyColoringEnabled === false) {
        return;
    }

    const tier = getFrequencyTier(word?.encounterCount);
    if (tier !== "learned") {
        highlightedSpan.classList.add(`lazylex-frequency-${tier}`);
    }
}

function countWordOccurrences(textNodes, word) {
    const expression = new RegExp(`\\b${escapeRegExp(word)}\\b`, "gi");
    return textNodes.reduce((count, node) => {
        const matches = node.nodeValue.match(expression);
        return count + (matches ? matches.length : 0);
    }, 0);
}

async function recordEncounterCounts(words, textNodes) {
    const increments = new Map();
    words.forEach((word) => {
        const id = Number(word?.id);
        if (!Number.isSafeInteger(id) || countedWordIdsOnPage.has(id)) {
            return;
        }

        const count = countWordOccurrences(textNodes, String(word.word || ""));
        countedWordIdsOnPage.add(id);
        if (count > 0) {
            increments.set(id, count);
        }
    });

    if (increments.size === 0) {
        return;
    }

    const { words: storedWords = [] } = await chrome.storage.local.get({ words: [] });
    const updatedWords = storedWords.map((word) => {
        const increment = increments.get(Number(word.id));
        if (!increment) {
            return word;
        }

        const encounterCount = Number(word.encounterCount || 0) + increment;
        const learned = encounterCount > 200;
        return {
            ...word,
            encounterCount,
            learned,
            status: learned ? "learned" : (word.status || "new"),
            learnedDate: learned ? (word.learnedDate || new Date().toISOString()) : word.learnedDate,
            lastUpdated: Date.now()
        };
    });
    await chrome.storage.local.set({ words: updatedWords });
}

async function highlightWords(words) {
    if (!extensionEnabledForSite) {
        // Single chokepoint for the full-page pass: every caller
        // (applySettings, the wordsChanged "reload" branch, the YouTube SPA
        // resync, the initial bootstrap) funnels through here, so an
        // excluded site cannot be re-highlighted by any of them. Returning
        // before recordEncounterCounts also keeps encounter statistics from
        // counting pages the user chose to opt out of.
        return;
    }

    const visibleWords = (Array.isArray(words) ? words : []).filter((word) => (
        word
        && word.word
        && word.status !== "learned"
        && word.learned !== true
        && Number(word.encounterCount || 0) <= 200
    ));
    const targetWords = visibleWords.map((t) => t.word.toLowerCase());
    const textNodes = findTextNodes(document.body);

    const translations = visibleWords.reduce((result, item) => {
        const key = item.word.toLowerCase();
        result[key] = item;
        return result;
    }, {});

    await recordEncounterCounts(visibleWords, textNodes);

    textNodes.forEach((node) => {
        if (targetWords.some((targetWord) => node.nodeValue.toLowerCase().includes(targetWord))) {
            replaceTextNode(node, targetWords, translations);
        }
    });
}

function handleExtensionStateChange(enabled) {
    // Update the flag *before* touching the DOM: highlightWords() reads it,
    // so setting it late would let the page re-highlight itself.
    setExtensionEnabledForSite(enabled);

    if (extensionEnabledForSite) {
        clearHighlighting();
        chrome.storage.local.get(["words"]).then((result) => {
            if (result.words !== undefined && result.words.length > 0) {
                highlightWords(result.words);
            }
        });

        console.log("Extension is enabled for this site.");
    } else {
        clearHighlighting();
        console.log("Extension is disabled for this site.");
    }
}

// Resolves the exclusion state for *this* tab from the background service
// worker. Returns a promise so the bootstrap can await it before the first
// highlight pass instead of racing it.
function checkInitialExtensionState() {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ action: "checkExtensionState" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn(
                        "[LazyLexExt] Unable to read the extension state:",
                        chrome.runtime.lastError.message
                    );
                    resolve(setExtensionEnabledForSite(true));
                    return;
                }
                resolve(setExtensionEnabledForSite(response?.enabled));
            });
        } catch (error) {
            console.warn("[LazyLexExt] Unable to read the extension state:", error?.message || error);
            resolve(setExtensionEnabledForSite(true));
        }
    });
}

// Event listeners and initialization

function applySettings(newSettings) {
    settings = {...settings, ...newSettings};

    // Apply visual changes based on settings
    updateHighlightColors(settings.highlightColor, settings.translationColor);

    chrome.storage.local.get(["words"]).then((result) => {
        const words = result.words || [];
        clearHighlighting();
        // On an excluded site the clear above is the whole job: changing a
        // setting from the popup must not bring highlights back. (#48 AC5)
        if (!extensionEnabledForSite) {
            return;
        }
        if (words.length > 0) {
            highlightWords(words);
            if (!settings.highlightingEnabled) {
                disableHighlightingDisplay();
            }
        }
    });
}

function loadInitialSettings() {
    chrome.storage.local.get([
        "translateTo",
        "animationToggle",
        "sentenceCounter",
        "highlightingEnabled",
        "highlightColor",
        "translationColor",
        "frequencyColoringEnabled"
    ], (items) => {
        const initialSettings = {
            languageCode: items.translateTo || "uk",
            languageFull: "Ukrainian",
            animationToggle: items.animationToggle !== undefined ? items.animationToggle === "true" : true,
            sentenceCounter: items.sentenceCounter || 1,
            highlightingEnabled: items.highlightingEnabled !== undefined ? items.highlightingEnabled : true,
            highlightColor: items.highlightColor,
            translationColor: items.translationColor,
            frequencyColoringEnabled: items.frequencyColoringEnabled !== false
        };
        applySettings(initialSettings);
    });
}

document.addEventListener("keydown", function (event) {
    if (event.ctrlKey && event.shiftKey && event.code === "KeyS") {
        const selectedText = window.getSelection().toString().trim();
        if (selectedText) {
            runLogic(selectedText);
            console.log(`Saved: ${selectedText}`);
        }
    }
});

document.addEventListener("mouseup", function (event) {
    if (event.target.id === "add-new-word" || event.target.id === "add-new-sentence") {
        return;
    }

    const existingButton = document.getElementById("add-new-word") || document.getElementById("add-new-sentence");
    if (existingButton) {
        existingButton.remove();
    }
    if (event.target.tagName !== "BUTTON") {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();
        if (selectedText) {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            const selectionType = classifySelectionType(selectedText);

            const button = document.createElement("button");
            button.className = "action-button";
            button.style.top = event.pageY + 20 + "px";
            button.style.left = event.pageX + 20 + "px";

            if (selectionType === "sentence") {
                // Distinct control: sentence saving is a separate, gated
                // action and must never fall through to the word flow.
                button.id = "add-new-sentence";
                button.innerText = "S+";
                button.title = "Save sentence (Premium)";
                button.setAttribute("aria-label", "Save sentence (Premium)");
                button.addEventListener("click", function () {
                    console.log('[LazyLexExt] sentence button clicked, length:', selectedText.length);
                    handleSentenceSelection(selectedText);
                    window.getSelection().empty();
                    window.getSelection().removeAllRanges();
                    button.remove();
                });
            } else {
                button.id = "add-new-word";
                button.innerText = "+";
                button.addEventListener("click", function () {
                    console.log('[LazyLexExt] + button clicked, selectedText:', selectedText);
                    runLogic(selectedText, rect);
                    window.getSelection().empty();
                    window.getSelection().removeAllRanges();
                    button.remove();
                });
            }

            document.body.appendChild(button);
        }
    }
});

// A highlighted word can live inside a link. Guard both mousedown and click
// so the link's own handlers (and default navigation) never fire ahead of
// the delete/edit controls - preventDefault() alone on click is not enough
// once the event has already reached other listeners via bubbling.
document.addEventListener("mousedown", (e) => {
    const wrapper = e.target.closest('.highlight-wrapper');
    if (wrapper?.closest("a[href]")) {
        e.preventDefault();
        e.stopPropagation();
    }
}, true);

document.addEventListener("click", (e) => {
    const wrapper = e.target.closest('.highlight-wrapper');

    // A highlighted word can live inside a link. Keep the first click on the
    // highlight available for LazyLex controls instead of navigating away.
    if (wrapper?.closest("a[href]")) {
        e.preventDefault();
        e.stopPropagation();
    }

    // Handle click on translation to edit
    if (e.target.classList.contains('translation') && wrapper) {
        showEditUI(e.target, wrapper.dataset.wordId);
        // Prevent delete button from showing up when we click to edit
        return;
    }

    const existingDeleteButton = document.getElementById("deleteWordBtn");
    if (existingDeleteButton) existingDeleteButton.remove();

    // This logic shows the delete button when a highlighted word is clicked
    if (!wrapper) return;

    const deleteButton = document.createElement("button");
    deleteButton.textContent = "-";
    deleteButton.id = "deleteWordBtn";
    deleteButton.className = "action-button";
    deleteButton.title = "Delete saved word";
    const wrapperRect = wrapper.getBoundingClientRect();
    deleteButton.style.position = "fixed";
    deleteButton.style.top = `${Math.max(8, wrapperRect.top - 36)}px`;
    deleteButton.style.left = `${Math.min(window.innerWidth - 40, wrapperRect.right + 4)}px`;

    deleteButton.setAttribute("aria-label", "Delete saved word");
    deleteButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        deleteButton.disabled = true;
        try {
            await deleteWordFromStorage(wrapper.dataset.wordId);
            deleteButton.remove();
        } catch (error) {
            deleteButton.disabled = false;
            showContentNotification(error?.message || "Unable to delete the word.", "error");
        }
    });

    // Append to the document so clipped links/containers cannot hide the control.
    document.body.appendChild(deleteButton);
});

function showEditUI(translationSpan, wordId) {
    const existingEditContainer = document.querySelector('.edit-translation-container');
    if (existingEditContainer) {
        const originalSpan = existingEditContainer.previousSibling;
        if (originalSpan && originalSpan.style.display === 'none') {
            originalSpan.style.display = '';
        }
        existingEditContainer.remove();

        if (originalSpan === translationSpan) {
            return;
        }
    }

    translationSpan.style.display = 'none';

    const input = document.createElement('input');
    input.type = 'text';
    const currentTranslation = translationSpan.textContent.slice(1, -1);
    input.value = currentTranslation;
    input.className = 'edit-translation-input';

    const saveButton = document.createElement('button');
    saveButton.className = 'action-button';
    saveButton.type = "button";
    saveButton.setAttribute("aria-label", "Save translation");
    saveButton.textContent = "✓";

    const editContainer = document.createElement('span');
    editContainer.className = 'edit-translation-container';
    editContainer.appendChild(input);
    editContainer.appendChild(saveButton);

    translationSpan.parentNode.insertBefore(editContainer, translationSpan.nextSibling);

    input.focus();

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            saveButton.click();
        }
    });

    saveButton.addEventListener('click', async () => {
        const newTranslation = input.value.trim();

        if (newTranslation && wordId) {
            saveButton.disabled = true;
            try {
                await updateWordInStorage(wordId, newTranslation);
            } catch (error) {
                saveButton.disabled = false;
                showContentNotification(error?.message || "Unable to update the translation.", "error");
                return;
            }
        }

        editContainer.remove();
    });
}

// Helper function to update CSS custom properties for highlight colors
function updateHighlightColors(highlightColor, translationColor) {
    if (highlightColor) {
        document.documentElement.style.setProperty('--highlight-color', highlightColor);
    }
    if (translationColor) {
        document.documentElement.style.setProperty('--translation-color', translationColor);
    }
}

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === "saveWordToDictionary") {
        console.log("Received selected text:", request.text);
        runLogic(request.text);
        sendResponse({ status: "success" });
    }
});

chrome.runtime.onMessage.addListener((request) => {
    // The background worker broadcasts this whenever the exclusion list
    // changes, with the value computed for *this* tab's own URL. Without
    // this listener the broadcast went nowhere and handleExtensionStateChange
    // was dead code (#48).
    if (request.action === "extensionStateChanged") {
        console.log('[LazyLexExt] Extension state changed:', request.newValue);
        handleExtensionStateChange(request.newValue);
    }

    if (request.action === "wordsChanged") {
        console.log('[LazyLexExt] Received wordsChanged message', request);
        const { operation, word, words } = request.newValue;

        if (!extensionEnabledForSite) {
            // Adding, updating or reloading words must not repaint an
            // excluded page. Clearing keeps a delete/clear correct too.
            clearHighlighting();
            return;
        }

        switch (operation) {
            case 'add':
                addHighlightForWord(word);
                break;
            case 'update':
                if (word?.status === "learned" || word?.learned === true || Number(word?.encounterCount) > 200) {
                    removeHighlightsForWord(word);
                } else {
                    updateHighlightsForWord(word);
                }
                break;
            case 'delete':
                removeHighlightsForWord(word);
                break;
            case 'reload':
                clearHighlighting();
                highlightWords(words);
                break;
            case 'clear':
                clearHighlighting();
                break;
        }
    }

    if (request.action === "settingsChanged") {
        console.log('[LazyLexExt] Settings changed:', request.settings);
        applySettings(request.settings);
    }
});

// Resolve the exclusion state first, then load settings. loadInitialSettings()
// ends in applySettings(), which triggers the first highlight pass, so the
// state has to be known by then -- otherwise an excluded site paints once and
// only un-paints when the broadcast happens to arrive. (#48)
checkInitialExtensionState().then(() => {
    loadInitialSettings();
});

console.log('[LazyLexExt] Content script loaded');
