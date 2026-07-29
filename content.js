let settings = {};
const countedWordIdsOnPage = new Set();

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
        background: ${type === "error" ? "#b42318" : "#344054"};
        border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, .2);
        z-index: 999999;
        font: 600 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    `;
    notification.textContent = String(message || "LazyLex operation failed.");
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 5000);
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

function isEligibleTextNode(node) {
    if (!node?.parentElement || !node.nodeValue || /^\s*$/.test(node.nodeValue)) {
        return false;
    }

    const parent = node.parentElement;
    if (parent.closest(
        "script, style, noscript, textarea, input, select, option, button, code, pre, svg, math, iframe, canvas, video, audio, [contenteditable]:not([contenteditable='false'])"
    )) {
        return false;
    }

    return !parent.closest(
        ".highlight-wrapper, #add-new-word, #deleteWordBtn, #lazylex-limit-notification, #lazylex-status-notification"
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
    if (enabled) {
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

function checkInitialExtensionState() {
    chrome.runtime.sendMessage({ action: "checkExtensionState" }, function (response) {
        const enabled = response.enabled;
        handleExtensionStateChange(enabled);
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
    if (event.target.id === "add-new-word") {
        return;
    }

    const existingButton = document.getElementById("add-new-word");
    if (existingButton) {
        existingButton.remove();
    }
    if (event.target.tagName !== "BUTTON") {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();
        if (selectedText) {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();

            const button = document.createElement("button");
            button.id = "add-new-word";
            button.className = "action-button";
            button.innerText = "+";
            button.style.top = event.pageY + 20 + "px";
            button.style.left = event.pageX + 20 + "px";
            button.addEventListener("click", function () {
                console.log('[LazyLexExt] + button clicked, selectedText:', selectedText);
                runLogic(selectedText, rect);
                window.getSelection().empty();
                window.getSelection().removeAllRanges();
                button.remove();
            });
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
    if (request.action === "wordsChanged") {
        console.log('[LazyLexExt] Received wordsChanged message', request);
        const { operation, word, words } = request.newValue;

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

loadInitialSettings();

console.log('[LazyLexExt] Content script loaded');
