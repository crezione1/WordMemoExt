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
    closeButton.textContent = "Ã—";

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
×mt¶‰žËkºwµçA…ÉÑt¤ì(4(€€€€€€€€€€€É•ÅÕ•ÍÑ¹¥µ…Ñ¥½¹É…µ”  ¤€ôøì4(€€€€€€€€€€€€€€€¡¥¡±¥¡Ñ•‘MÁ…¸¹±…ÍÍ1¥ÍÐ¹…‘ ‰…¹¥µ…Ñ”µ‰½É‘•Èˆ¤ì4(€€€€€€€€€€€ô¤ì4(4(€€€€€€€€€€€Í•ÑQ¥µ•½ÕÐ  ¤€ôøì4(€€€€€€€€€€€€€€€¡¥¡±¥¡Ñ•‘MÁ…¸¹±…ÍÍ1¥ÍÐ¹…‘ ‰…¹¥µ…Ñ”µ‰…­É½Õ¹ˆ¤ì4(€€€€€€€€€€€ô°€ÄÀ¤ì4(4(€€€€€€€€€€€ÝÉ…ÁÁ•È¹…ÁÁ•¹‘¡¥±¡¡¥¡±¥¡Ñ•‘MÁ…¸¤ì4(4(€€€€€€€€€€€½¹ÍÐÑÉ…¹Í±…Ñ¥½¹9½‘”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÍÁ…¸ˆ¤ì4(€€€€€€€€€€€ÑÉ…¹Í±…Ñ¥½¹9½‘”¹±…ÍÍ1¥ÍÐ¹…‘ ‰ÑÉ…¹Í±…Ñ¥½¸ˆ¤ì4(€€€€€€€€€€€ÑÉ…¹Í±…Ñ¥½¹9½‘”¹Ñ•áÑ½¹Ñ•¹Ð€ôl‘íÑÉ…¹Í±…Ñ¥½¹Ím±½Ý•ÉA…ÉÑt¹ÑÉ…¹Í±…Ñ¥½¹õu€ì4(€€€€€€€€€€€ÝÉ…ÁÁ•È¹…ÁÁ•¹‘¡¥±¡ÑÉ…¹Í±…Ñ¥½¹9½‘”¤ì4(€€€€€€€€€€€™É…µ•¹Ð¹…ÁÁ•¹‘¡¥±¡ÝÉ…ÁÁ•È¤ì4(€€€€€€€ô•±Í”ì4(€€€€€€€€€€€™É…µ•¹Ð¹…ÁÁ•¹‘¡¥±¡‘½Õµ•¹Ð¹É•…Ñ•Q•áÑ9½‘”¡Á…ÉÐ¤¤ì4(€€€€€€€ô4(€€€ô¤ì4(4(€€€¹½‘”¹Á…É•¹Ñ9½‘”¹É•Á±…•¡¥±¡™É…µ•¹Ð°¹½‘”¤ì4)ô4(4)™Õ¹Ñ¥½¸•Í…Á•I•áÀ¡Ù…±Õ”¤ì(€€€É•ÑÕÉ¸MÑÉ¥¹œ¡Ù…±Õ”ñð€ˆˆ¤¹É•Á±…” ½l¸¨¬ýx‘íô ¥ñmquqqt½œ°€‰qp˜ˆ¤ì)ô()™Õ¹Ñ¥½¸¥Í±¥¥‰±•Q•áÑ9½‘”¡¹½‘”¤ì(€€€¥˜€ …¹½‘”ü¹Á…É•¹Ñ±•µ•¹Ðñð€…¹½‘”¹¹½‘•Y…±Õ”ñð€½yqÌ¨¼¹Ñ•ÍÐ¡¹½‘”¹¹½‘•Y…±Õ”¤¤ì(€€€€€€€É•ÑÕÉ¸™…±Í”ì(€€€ô((€€€½¹ÍÐÁ…É•¹Ð€ô¹½‘”¹Á…É•¹Ñ±•µ•¹Ðì(€€€¥˜€¡Á…É•¹Ð¹±½Í•ÍÐ (€€€€€€€€‰ÍÉ¥ÁÐ°ÍÑå±”°¹½ÍÉ¥ÁÐ°Ñ•áÑ…É•„°¥¹ÁÕÐ°Í•±•Ð°½ÁÑ¥½¸°‰ÕÑÑ½¸°½‘”°ÁÉ”°ÍÙœ°µ…Ñ °¥™É…µ”°…¹Ù…Ì°Ù¥‘•¼°…Õ‘¥¼°m½¹Ñ•¹Ñ•‘¥Ñ…‰±•té¹½Ð¡m½¹Ñ•¹Ñ•‘¥Ñ…‰±”ô™…±Í”t¤ˆ(€€€€¤¤ì(€€€€€€€É•ÑÕÉ¸™…±Í”ì(€€€ô((€€€É•ÑÕÉ¸€…Á…É•¹Ð¹±½Í•ÍÐ (€€€€€€€€ˆ¹¡¥¡±¥¡ÐµÝÉ…ÁÁ•È°€…‘µ¹•ÜµÝ½É°€‘•±•Ñ•]½É‘	Ñ¸°€±…éå±•àµ±¥µ¥Ðµ¹½Ñ¥™¥…Ñ¥½¸°€±…éå±•àµÍÑ…ÑÕÌµ¹½Ñ¥™¥…Ñ¥½¸ˆ(€€€€¤ì)ô()™Õ¹Ñ¥½¸™¥¹‘Q•áÑ9½‘•Ì¡•±•µ•¹Ð¤ì(€€€¥˜€ …•±•µ•¹Ð¤ì(€€€€€€€É•ÑÕÉ¸mtì(€€€ô((€€€½¹ÍÐ¹½‘•Ì€ômtì(€€€½¹ÍÐÝ…±­•È€ô‘½Õµ•¹Ð¹É•…Ñ•QÉ••]…±­•È (€€€€€€€•±•µ•¹Ð°(€€€€€€€9½‘•¥±Ñ•È¹M!=]}QaP°(€€€€€€€ì(€€€€€€€€€€€…•ÁÑ9½‘”¡¹½‘”¤ì(€€€€€€€€€€€€€€€É•ÑÕÉ¸¥Í±¥¥‰±•Q•áÑ9½‘”¡¹½‘”¤(€€€€€€€€€€€€€€€€€€€€ü9½‘•¥±Ñ•È¹%1QI}AP(€€€€€€€€€€€€€€€€€€€€è9½‘•¥±Ñ•È¹%1QI}I)Pì(€€€€€€€€€€€ô(€€€€€€€ô(€€€€¤ì((€€€Ý¡¥±”€¡Ý…±­•È¹¹•áÑ9½‘” ¤¤ì(€€€€€€€¹½‘•Ì¹ÁÕÍ ¡Ý…±­•È¹ÕÉÉ•¹Ñ9½‘”¤ì(€€€ô(€€€É•ÑÕÉ¸¹½‘•Ìì)ô()™Õ¹Ñ¥½¸•ÑÉ•ÅÕ•¹åQ¥•È¡•¹½Õ¹Ñ•É½Õ¹Ð¤ì(€€€½¹ÍÐ½Õ¹Ð€ô9Õµ‰•È¡•¹½Õ¹Ñ•É½Õ¹Ð¤ñð€Àì(€€€¥˜€¡½Õ¹Ð€ø€ÈÀÀ¤É•ÑÕÉ¸€‰±•…É¹•ˆì(€€€¥˜€¡½Õ¹Ð€ø€ÄÈÀ¤É•ÑÕÉ¸€‰É•Ñ…¥¹•ˆì(€€€¥˜€¡½Õ¹Ð€ø€ÔÀ¤É•ÑÕÉ¸€‰™…µ¥±¥…Èˆì(€€€É•ÑÕÉ¸€‰¹•Üˆì)ô()™Õ¹Ñ¥½¸…ÁÁ±åÉ•ÅÕ•¹åQ¥•È¡¡¥¡±¥¡Ñ•‘MÁ…¸°Ý½É¤ì(€€€¡¥¡±¥¡Ñ•‘MÁ…¸¹±…ÍÍ1¥ÍÐ¹É•µ½Ù” (€€€€€€€€‰±…éå±•àµ™É•ÅÕ•¹äµ¹•Üˆ°(€€€€€€€€‰±…éå±•àµ™É•ÅÕ•¹äµ™…µ¥±¥…Èˆ°(€€€€€€€€‰±…éå±•àµ™É•ÅÕ•¹äµÉ•Ñ…¥¹•ˆ(€€€€¤ì(€€€¥˜€¡Í•ÑÑ¥¹Ì¹™É•ÅÕ•¹å½±½É¥¹¹…‰±•€ôôô™…±Í”¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€ô((€€€½¹ÍÐÑ¥•È€ô•ÑÉ•ÅÕ•¹åQ¥•È¡Ý½Éü¹•¹½Õ¹Ñ•É½Õ¹Ð¤ì(€€€¥˜€¡Ñ¥•È€„ôô€‰±•…É¹•ˆ¤ì(€€€€€€€¡¥¡±¥¡Ñ•‘MÁ…¸¹±…ÍÍ1¥ÍÐ¹…‘¡±…éå±•àµ™É•ÅÕ•¹ä´‘íÑ¥•Éõ€¤ì(€€€ô)ô()™Õ¹Ñ¥½¸½Õ¹Ñ]½É‘=ÕÉÉ•¹•Ì¡Ñ•áÑ9½‘•Ì°Ý½É¤ì(€€€½¹ÍÐ•áÁÉ•ÍÍ¥½¸€ô¹•ÜI•áÀ¡qqˆ‘í•Í…Á•I•áÀ¡Ý½É¥õqq‰€°€‰¤ˆ¤ì(€€€É•ÑÕÉ¸Ñ•áÑ9½‘•Ì¹É•‘Õ” ¡½Õ¹Ð°¹½‘”¤€ôøì(€€€€€€€½¹ÍÐµ…Ñ¡•Ì€ô¹½‘”¹¹½‘•Y…±Õ”¹µ…Ñ ¡•áÁÉ•ÍÍ¥½¸¤ì(€€€€€€€É•ÑÕÉ¸½Õ¹Ð€¬€¡µ…Ñ¡•Ì€üµ…Ñ¡•Ì¹±•¹Ñ €è€À¤ì(€€€ô°€À¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸É•½É‘¹½Õ¹Ñ•É½Õ¹ÑÌ¡Ý½É‘Ì°Ñ•áÑ9½‘•Ì¤ì(€€€½¹ÍÐ¥¹É•µ•¹ÑÌ€ô¹•Ü5…À ¤ì(€€€Ý½É‘Ì¹™½É…  ¡Ý½É¤€ôøì(€€€€€€€½¹ÍÐ¥€ô9Õµ‰•È¡Ý½Éü¹¥¤ì(€€€€€€€¥˜€ …9Õµ‰•È¹¥ÍM…™•%¹Ñ••È¡¥¤ñð½Õ¹Ñ•‘]½É‘%‘Í=¹A…”¹¡…Ì¡¥¤¤ì(€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€ô((€€€€€€€½¹ÍÐ½Õ¹Ð€ô½Õ¹Ñ]½É‘=ÕÉÉ•¹•Ì¡Ñ•áÑ9½‘•Ì°MÑÉ¥¹œ¡Ý½É¹Ý½Éñð€ˆˆ¤¤ì(€€€€€€€½Õ¹Ñ•‘]½É‘%‘Í=¹A…”¹…‘¡¥¤ì(€€€€€€€¥˜€¡½Õ¹Ð€ø€À¤ì(€€€€€€€€€€€¥¹É•µ•¹ÑÌ¹Í•Ð¡¥°½Õ¹Ð¤ì(€€€€€€€ô(€€€ô¤ì((€€€¥˜€¡¥¹É•µ•¹ÑÌ¹Í¥é”€ôôô€À¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€ô((€€€½¹ÍÐìÝ½É‘ÌèÍÑ½É•‘]½É‘Ì€ômtô€ô…Ý…¥Ð¡É½µ”¹ÍÑ½É…”¹±½…°¹•Ð¡ìÝ½É‘Ìèmtô¤ì(€€€½¹ÍÐÕÁ‘…Ñ•‘]½É‘Ì€ôÍÑ½É•‘]½É‘Ì¹µ…À ¡Ý½É¤€ôøì(€€€€€€€½¹ÍÐ¥¹É•µ•¹Ð€ô¥¹É•µ•¹ÑÌ¹•Ð¡9Õµ‰•È¡Ý½É¹¥¤¤ì(€€€€€€€¥˜€ …¥¹É•µ•¹Ð¤ì(€€€€€€€€€€€É•ÑÕÉ¸Ý½Éì(€€€€€€€ô((€€€€€€€½¹ÍÐ•¹½Õ¹Ñ•É½Õ¹Ð€ô9Õµ‰•È¡Ý½É¹•¹½Õ¹Ñ•É½Õ¹Ðñð€À¤€¬¥¹É•µ•¹Ðì(€€€€€€€½¹ÍÐ±•…É¹•€ô•¹½Õ¹Ñ•É½Õ¹Ð€ø€ÈÀÀì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€€¸¸¹Ý½É°(€€€€€€€€€€€•¹½Õ¹Ñ•É½Õ¹Ð°(€€€€€€€€€€€±•…É¹•°(€€€€€€€€€€€ÍÑ…ÑÕÌè±•…É¹•€ü€‰±•…É¹•ˆ€è€¡Ý½É¹ÍÑ…ÑÕÌñð€‰¹•Üˆ¤°(€€€€€€€€€€€±•…É¹•‘…Ñ”è±•…É¹•€ü€¡Ý½É¹±•…É¹•‘…Ñ”ñð¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¤€èÝ½É¹±•…É¹•‘…Ñ”°(€€€€€€€€€€€±…ÍÑUÁ‘…Ñ•è…Ñ”¹¹½Ü ¤(€€€€€€€ôì(€€€ô¤ì(€€€…Ý…¥Ð¡É½µ”¹ÍÑ½É…”¹±½…°¹Í•Ð¡ìÝ½É‘ÌèÕÁ‘…Ñ•‘]½É‘Ìô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¡¥¡±¥¡Ñ]½É‘Ì¡Ý½É‘Ì¤ì(€€€½¹ÍÐÙ¥Í¥‰±•]½É‘Ì€ô€¡ÉÉ…ä¹¥ÍÉÉ…ä¡Ý½É‘Ì¤€üÝ½É‘Ì€èmt¤¹™¥±Ñ•È ¡Ý½É¤€ôø€ (€€€€€€€Ý½É(€€€€€€€€˜˜Ý½É¹Ý½É(€€€€€€€€˜˜Ý½É¹ÍÑ…ÑÕÌ€„ôô€‰±•…É¹•ˆ(€€€€€€€€˜˜Ý½É¹±•…É¹•€„ôôÑÉÕ”(€€€€€€€€˜˜9Õµ‰•È¡Ý½É¹•¹½Õ¹Ñ•É½Õ¹Ðñð€À¤€ðô€ÈÀÀ(€€€€¤¤ì(€€€½¹ÍÐÑ…É•Ñ]½É‘Ì€ôÙ¥Í¥‰±•]½É‘Ì¹µ…À ¡Ð¤€ôøÐ¹Ý½É¹Ñ½1½Ý•É…Í” ¤¤ì(€€€½¹ÍÐÑ•áÑ9½‘•Ì€ô™¥¹‘Q•áÑ9½‘•Ì¡‘½Õµ•¹Ð¹‰½‘ä¤ì((€€€½¹ÍÐÑÉ…¹Í±…Ñ¥½¹Ì€ôÙ¥Í¥‰±•]½É‘Ì¹É•‘Õ” ¡É•ÍÕ±Ð°¥Ñ•´¤€ôøì(€€€€€€€½¹ÍÐ­•ä€ô¥Ñ•´¹Ý½É¹Ñ½1½Ý•É…Í” ¤ì(€€€€€€€É•ÍÕ±Ñm­•åt€ô¥Ñ•´ì(€€€€€€€É•ÑÕÉ¸É•ÍÕ±Ðì(€€€ô°íô¤ì((€€€…Ý…¥ÐÉ•½É‘¹½Õ¹Ñ•É½Õ¹ÑÌ¡Ù¥Í¥‰±•]½É‘Ì°Ñ•áÑ9½‘•Ì¤ì((€€€Ñ•áÑ9½‘•Ì¹™½É…  ¡¹½‘”¤€ôøì4(€€€€€€€¥˜€¡Ñ…É•Ñ]½É‘Ì¹Í½µ” ¡Ñ…É•Ñ]½É¤€ôø¹½‘”¹¹½‘•Y…±Õ”¹Ñ½1½Ý•É…Í” ¤¹¥¹±Õ‘•Ì¡Ñ…É•Ñ]½É¤¤¤ì4(€€€€€€€€€€€É•Á±…•Q•áÑ9½‘”¡¹½‘”°Ñ…É•Ñ]½É‘Ì°ÑÉ…¹Í±…Ñ¥½¹Ì¤ì4(€€€€€€€ô4(€€€ô¤ì4)ô4(4)™Õ¹Ñ¥½¸¡…¹‘±•áÑ•¹Í¥½¹MÑ…Ñ•¡…¹”¡•¹…‰±•¤ì4(€€€¥˜€¡•¹…‰±•¤ì4(€€€€€€€±•…É!¥¡±¥¡Ñ¥¹œ ¤ì4(€€€€€€€¡É½µ”¹ÍÑ½É…”¹±½…°¹•Ð¡l‰Ý½É‘Ì‰t¤¹Ñ¡•¸ ¡É•ÍÕ±Ð¤€ôøì4(€€€€€€€€€€€¥˜€¡É•ÍÕ±Ð¹Ý½É‘Ì€„ôôÕ¹‘•™¥¹•€˜˜É•ÍÕ±Ð¹Ý½É‘Ì¹±•¹Ñ €ø€À¤ì4(€€€€€€€€€€€€€€€¡¥¡±¥¡Ñ]½É‘Ì¡É•ÍÕ±Ð¹Ý½É‘Ì¤ì4(€€€€€€€€€€€ô4(€€€€€€€ô¤ì4(4(€€€€€€€½¹Í½±”¹±½œ ‰áÑ•¹Í¥½¸¥Ì•¹…‰±•™½ÈÑ¡¥ÌÍ¥Ñ”¸ˆ¤ì4(€€€ô•±Í”ì4(€€€€€€€±•…É!¥¡±¥¡Ñ¥¹œ ¤ì4(€€€€€€€½¹Í½±”¹±½œ ‰áÑ•¹Í¥½¸¥Ì‘¥Í…‰±•™½ÈÑ¡¥ÌÍ¥Ñ”¸ˆ¤ì4(€€€ô4)ô4(4)™Õ¹Ñ¥½¸¡•­%¹¥Ñ¥…±áÑ•¹Í¥½¹MÑ…Ñ” ¤ì4(€€€¡É½µ”¹ÉÕ¹Ñ¥µ”¹Í•¹‘5•ÍÍ…”¡ì…Ñ¥½¸è€‰¡•­áÑ•¹Í¥½¹MÑ…Ñ”ˆô°™Õ¹Ñ¥½¸€¡É•ÍÁ½¹Í”¤ì4(€€€€€€€½¹ÍÐ•¹…‰±•€ôÉ•ÍÁ½¹Í”¹•¹…‰±•ì4(€€€€€€€¡…¹‘±•áÑ•¹Í¥½¹MÑ…Ñ•¡…¹”¡•¹…‰±•¤ì4(€€€ô¤ì4)ô4(4(¼¼Ù•¹Ð±¥ÍÑ•¹•ÉÌ…¹¥¹¥Ñ¥…±¥é…Ñ¥½¸4(4)™Õ¹Ñ¥½¸…ÁÁ±åM•ÑÑ¥¹Ì¡¹•ÝM•ÑÑ¥¹Ì¤ì4(€€€Í•ÑÑ¥¹Ì€ôì¸¸¹Í•ÑÑ¥¹Ì°€¸¸¹¹•ÝM•ÑÑ¥¹Íôì4(4(€€€€¼¼ÁÁ±äÙ¥ÍÕ…°¡…¹•Ì‰…Í•½¸Í•ÑÑ¥¹Ì4(€€€ÕÁ‘…Ñ•!¥¡±¥¡Ñ½±½ÉÌ¡Í•ÑÑ¥¹Ì¹¡¥¡±¥¡Ñ½±½È°Í•ÑÑ¥¹Ì¹ÑÉ…¹Í±…Ñ¥½¹½±½È¤ì4(4(€€€¡É½µ”¹ÍÑ½É…”¹±½…°¹•Ð¡l‰Ý½É‘Ì‰t¤¹Ñ¡•¸ ¡É•ÍÕ±Ð¤€ôøì4(€€€€€€€½¹ÍÐÝ½É‘Ì€ôÉ•ÍÕ±Ð¹Ý½É‘Ìñðmtì4(€€€€€€€±•…É!¥¡±¥¡Ñ¥¹œ ¤ì4(€€€€€€€¥˜€¡Ý½É‘Ì¹±•¹Ñ €ø€À¤ì4(€€€€€€€€€€€¡¥¡±¥¡Ñ]½É‘Ì¡Ý½É‘Ì¤ì4(€€€€€€€€€€€¥˜€ …Í•ÑÑ¥¹Ì¹¡¥¡±¥¡Ñ¥¹¹…‰±•¤ì4(€€€€€€€€€€€€€€€‘¥Í…‰±•!¥¡±¥¡Ñ¥¹¥ÍÁ±…ä ¤ì4(€€€€€€€€€€€ô4(€€€€€€€ô4(€€€ô¤ì4)ô4(4)™Õ¹Ñ¥½¸±½…‘%¹¥Ñ¥…±M•ÑÑ¥¹Ì ¤ì4(€€€¡É½µ”¹ÍÑ½É…”¹±½…°¹•Ð¡l4(€€€€€€€€‰ÑÉ…¹Í±…Ñ•Q¼ˆ°4(€€€€€€€€‰…¹¥µ…Ñ¥½¹Q½±”ˆ°4(€€€€€€€€‰Í•¹Ñ•¹•½Õ¹Ñ•Èˆ°4(€€€€€€€€‰¡¥¡±¥¡Ñ¥¹¹…‰±•ˆ°4(€€€€€€€€‰¡¥¡±¥¡Ñ½±½Èˆ°(€€€€€€€€‰ÑÉ…¹Í±…Ñ¥½¹½±½Èˆ°(€€€€€€€€‰™É•ÅÕ•¹å½±½É¥¹¹…‰±•ˆ(€€€t°€¡¥Ñ•µÌ¤€ôøì4(€€€€€€€½¹ÍÐ¥¹¥Ñ¥…±M•ÑÑ¥¹Ì€ôì4(€€€€€€€€€€€±…¹Õ…•½‘”è¥Ñ•µÌ¹ÑÉ…¹Í±…Ñ•Q¼ñð€‰Õ¬ˆ°4(€€€€€€€€€€€±…¹Õ…•Õ±°è€‰U­É…¥¹¥…¸ˆ°4(€€€€€€€€€€€…¹¥µ…Ñ¥½¹Q½±”è¥Ñ•µÌ¹…¹¥µ…Ñ¥½¹Q½±”€„ôôÕ¹‘•™¥¹•€ü¥Ñ•µÌ¹…¹¥µ…Ñ¥½¹Q½±”€ôôô€‰ÑÉÕ”ˆ€èÑÉÕ”°4(€€€€€€€€€€€Í•¹Ñ•¹•½Õ¹Ñ•Èè¥Ñ•µÌ¹Í•¹Ñ•¹•½Õ¹Ñ•Èñð€Ä°4(€€€€€€€€€€€¡¥¡±¥¡Ñ¥¹¹…‰±•è¥Ñ•µÌ¹¡¥¡±¥¡Ñ¥¹¹…‰±•€„ôôÕ¹‘•™¥¹•€ü¥Ñ•µÌ¹¡¥¡±¥¡Ñ¥¹¹…‰±•€èÑÉÕ”°4(€€€€€€€€€€€¡¥¡±¥¡Ñ½±½Èè¥Ñ•µÌ¹¡¥¡±¥¡Ñ½±½È°(€€€€€€€€€€€ÑÉ…¹Í±…Ñ¥½¹½±½Èè¥Ñ•µÌ¹ÑÉ…¹Í±…Ñ¥½¹½±½È°(€€€€€€€€€€€™É•ÅÕ•¹å½±½É¥¹¹…‰±•è¥Ñ•µÌ¹™É•ÅÕ•¹å½±½É¥¹¹…‰±•€„ôô™…±Í”(€€€€€€€ôì4(€€€€€€€…ÁÁ±åM•ÑÑ¥¹Ì¡¥¹¥Ñ¥…±M•ÑÑ¥¹Ì¤ì4(€€€ô¤ì4)ô4(4)‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰­•å‘½Ý¸ˆ°™Õ¹Ñ¥½¸€¡•Ù•¹Ð¤ì4(€€€¥˜€¡•Ù•¹Ð¹ÑÉ±-•ä€˜˜•Ù•¹Ð¹Í¡¥™Ñ-•ä€˜˜•Ù•¹Ð¹½‘”€ôôô€‰-•åLˆ¤ì4(€€€€€€€½¹ÍÐÍ•±•Ñ•‘Q•áÐ€ôÝ¥¹‘½Ü¹•ÑM•±•Ñ¥½¸ ¤¹Ñ½MÑÉ¥¹œ ¤¹ÑÉ¥´ ¤ì4(€€€€€€€¥˜€¡Í•±•Ñ•‘Q•áÐ¤ì4(€€€€€€€€€€€ÉÕ¹1½¥Œ¡Í•±•Ñ•‘Q•áÐ¤ì4(€€€€€€€€€€€½¹Í½±”¹±½œ¡M…Ù•è€‘íÍ•±•Ñ•‘Q•áÑõ€¤ì4(€€€€€€€ô4(€€€ô4)ô¤ì4(4)‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰µ½ÕÍ•ÕÀˆ°™Õ¹Ñ¥½¸€¡•Ù•¹Ð¤ì4(€€€¥˜€¡•Ù•¹Ð¹Ñ…É•Ð¹¥€ôôô€‰…‘µ¹•ÜµÝ½Éˆ¤ì4(€€€€€€€É•ÑÕÉ¸ì4(€€€ô4(4(€€€½¹ÍÐ•á¥ÍÑ¥¹	ÕÑÑ½¸€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰…‘µ¹•ÜµÝ½Éˆ¤ì4(€€€¥˜€¡•á¥ÍÑ¥¹	ÕÑÑ½¸¤ì4(€€€€€€€•á¥ÍÑ¥¹	ÕÑÑ½¸¹É•µ½Ù” ¤ì4(€€€ô4(€€€¥˜€¡•Ù•¹Ð¹Ñ…É•Ð¹Ñ…9…µ”€„ôô€‰	UQQ=8ˆ¤ì4(€€€€€€€½¹ÍÐÍ•±•Ñ¥½¸€ôÝ¥¹‘½Ü¹•ÑM•±•Ñ¥½¸ ¤ì4(€€€€€€€½¹ÍÐÍ•±•Ñ•‘Q•áÐ€ôÍ•±•Ñ¥½¸¹Ñ½MÑÉ¥¹œ ¤¹ÑÉ¥´ ¤ì4(€€€€€€€¥˜€¡Í•±•Ñ•‘Q•áÐ¤ì4(€€€€€€€€€€€½¹ÍÐÉ…¹”€ôÍ•±•Ñ¥½¸¹•ÑI…¹•Ð À¤ì4(€€€€€€€€€€€½¹ÍÐÉ•Ð€ôÉ…¹”¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì4(4(€€€€€€€€€€€½¹ÍÐ‰ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰‰ÕÑÑ½¸ˆ¤ì4(€€€€€€€€€€€‰ÕÑÑ½¸¹¥€ô€‰…‘µ¹•ÜµÝ½Éˆì4(€€€€€€€€€€€‰ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€‰…Ñ¥½¸µ‰ÕÑÑ½¸ˆì4(€€€€€€€€€€€‰ÕÑÑ½¸¹¥¹¹•ÉQ•áÐ€ô€ˆ¬ˆì4(€€€€€€€€€€€‰ÕÑÑ½¸¹ÍÑå±”¹Ñ½À€ô•Ù•¹Ð¹Á…•d€¬€ÈÀ€¬€‰Áàˆì4(€€€€€€€€€€€‰ÕÑÑ½¸¹ÍÑå±”¹±•™Ð€ô•Ù•¹Ð¹Á…•`€¬€ÈÀ€¬€‰Áàˆì4(€€€€€€€€€€€‰ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°™Õ¹Ñ¥½¸€ ¤ì4(€€€€€€€€€€€€€€€½¹Í½±”¹±½œ m1…éå1•ááÑt€¬‰ÕÑÑ½¸±¥­•°Í•±•Ñ•‘Q•áÐèœ°Í•±•Ñ•‘Q•áÐ¤ì4(€€€€€€€€€€€€€€€ÉÕ¹1½¥Œ¡Í•±•Ñ•‘Q•áÐ°É•Ð¤ì4(€€€€€€€€€€€€€€€Ý¥¹‘½Ü¹•ÑM•±•Ñ¥½¸ ¤¹•µÁÑä ¤ì4(€€€€€€€€€€€€€€€Ý¥¹‘½Ü¹•ÑM•±•Ñ¥½¸ ¤¹É•µ½Ù•±±I…¹•Ì ¤ì4(€€€€€€€€€€€€€€€‰ÕÑÑ½¸¹É•µ½Ù” ¤ì4(€€€€€€€€€€€ô¤ì4(€€€€€€€€€€€‘½Õµ•¹Ð¹‰½‘ä¹…ÁÁ•¹‘¡¥±¡‰ÕÑÑ½¸¤ì4(€€€€€€€ô4(€€€ô4)ô¤ì4(4)‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€¡”¤€ôøì(€€€½¹ÍÐÝÉ…ÁÁ•È€ô”¹Ñ…É•Ð¹±½Í•ÍÐ œ¹¡¥¡±¥¡ÐµÝÉ…ÁÁ•Èœ¤ì((€€€€¼¼¡¥¡±¥¡Ñ•Ý½É…¸±¥Ù”¥¹Í¥‘”„±¥¹¬¸-••ÀÑ¡”™¥ÉÍÐ±¥¬½¸Ñ¡”(€€€€¼¼¡¥¡±¥¡Ð…Ù…¥±…‰±”™½È1…éå1•à½¹ÑÉ½±Ì¥¹ÍÑ•…½˜¹…Ù¥…Ñ¥¹œ…Ý…ä¸(€€€¥˜€¡ÝÉ…ÁÁ•Èü¹±½Í•ÍÐ ‰…m¡É•™tˆ¤¤ì(€€€€€€€”¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì(€€€ô((€€€€¼¼!…¹‘±”±¥¬½¸ÑÉ…¹Í±…Ñ¥½¸Ñ¼•‘¥Ð(€€€¥˜€¡”¹Ñ…É•Ð¹±…ÍÍ1¥ÍÐ¹½¹Ñ…¥¹Ì ÑÉ…¹Í±…Ñ¥½¸œ¤€˜˜ÝÉ…ÁÁ•È¤ì4(€€€€€€€Í¡½Ý‘¥ÑU$¡”¹Ñ…É•Ð°ÝÉ…ÁÁ•È¹‘…Ñ…Í•Ð¹Ý½É‘%¤ì4(€€€€€€€€¼¼AÉ•Ù•¹Ð‘•±•Ñ”‰ÕÑÑ½¸™É½´Í¡½Ý¥¹œÕÀÝ¡•¸Ý”±¥¬Ñ¼•‘¥Ð4(€€€€€€€É•ÑÕÉ¸ì4(€€€ô4(4(€€€½¹ÍÐ•á¥ÍÑ¥¹•±•Ñ•	ÕÑÑ½¸€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰‘•±•Ñ•]½É‘	Ñ¸ˆ¤ì4(€€€¥˜€¡•á¥ÍÑ¥¹•±•Ñ•	ÕÑÑ½¸¤•á¥ÍÑ¥¹•±•Ñ•	ÕÑÑ½¸¹É•µ½Ù” ¤ì4(4(€€€€¼¼Q¡¥Ì±½¥ŒÍ¡½ÝÌÑ¡”‘•±•Ñ”‰ÕÑÑ½¸Ý¡•¸„¡¥¡±¥¡Ñ•Ý½É¥Ì±¥­•4(€€€¥˜€ …ÝÉ…ÁÁ•È¤É•ÑÕÉ¸ì4(4(€€€½¹ÍÐ‘•±•Ñ•	ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰‰ÕÑÑ½¸ˆ¤ì4(€€€‘•±•Ñ•	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€ˆ´ˆì(€€€‘•±•Ñ•	ÕÑÑ½¸¹¥€ô€‰‘•±•Ñ•]½É‘	Ñ¸ˆì(€€€‘•±•Ñ•	ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€‰…Ñ¥½¸µ‰ÕÑÑ½¸ˆì(€€€‘•±•Ñ•	ÕÑÑ½¸¹Ñ¥Ñ±”€ô€‰•±•Ñ”Í…Ù•Ý½Éˆì(€€€½¹ÍÐÝÉ…ÁÁ•ÉI•Ð€ôÝÉ…ÁÁ•È¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€‘•±•Ñ•	ÕÑÑ½¸¹ÍÑå±”¹Á½Í¥Ñ¥½¸€ô€‰™¥á•ˆì(€€€‘•±•Ñ•	ÕÑÑ½¸¹ÍÑå±”¹Ñ½À€ô€‘í5…Ñ ¹µ…à à°ÝÉ…ÁÁ•ÉI•Ð¹Ñ½À€´€ÌØ¥õÁá€ì(€€€‘•±•Ñ•	ÕÑÑ½¸¹ÍÑå±”¹±•™Ð€ô€‘í5…Ñ ¹µ¥¸¡Ý¥¹‘½Ü¹¥¹¹•É]¥‘Ñ €´€ÐÀ°ÝÉ…ÁÁ•ÉI•Ð¹É¥¡Ð€¬€Ð¥õÁá€ì(4(€€€‘•±•Ñ•	ÕÑÑ½¸¹Í•ÑÑÑÉ¥‰ÕÑ” ‰…É¥„µ±…‰•°ˆ°€‰•±•Ñ”Í…Ù•Ý½Éˆ¤ì(€€€‘•±•Ñ•	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°…Íå¹Œ€¡•Ù•¹Ð¤€ôøì(€€€€€€€•Ù•¹Ð¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€€€€€‘•±•Ñ•	ÕÑÑ½¸¹‘¥Í…‰±•€ôÑÉÕ”ì(€€€€€€€ÑÉäì(€€€€€€€€€€€…Ý…¥Ð‘•±•Ñ•]½É‘É½µMÑ½É…”¡ÝÉ…ÁÁ•È¹‘…Ñ…Í•Ð¹Ý½É‘%¤ì(€€€€€€€€€€€‘•±•Ñ•	ÕÑÑ½¸¹É•µ½Ù” ¤ì(€€€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€€€€€‘•±•Ñ•	ÕÑÑ½¸¹‘¥Í…‰±•€ô™…±Í”ì(€€€€€€€€€€€Í¡½Ý½¹Ñ•¹Ñ9½Ñ¥™¥…Ñ¥½¸¡•ÉÉ½Èü¹µ•ÍÍ…”ñð€‰U¹…‰±”Ñ¼‘•±•Ñ”Ñ¡”Ý½É¸ˆ°€‰•ÉÉ½Èˆ¤ì(€€€€€€€ô(€€€ô¤ì4(4(€€€€¼¼ÁÁ•¹Ñ¼Ñ¡”‘½Õµ•¹ÐÍ¼±¥ÁÁ•±¥¹­Ì½½¹Ñ…¥¹•ÉÌ…¹¹½Ð¡¥‘”Ñ¡”½¹ÑÉ½°¸(€€€‘½Õµ•¹Ð¹‰½‘ä¹…ÁÁ•¹‘¡¥±¡‘•±•Ñ•	ÕÑÑ½¸¤ì)ô¤ì4(4)™Õ¹Ñ¥½¸Í¡½Ý‘¥ÑU$¡ÑÉ…¹Í±…Ñ¥½¹MÁ…¸°Ý½É‘%¤ì4(€€€½¹ÍÐ•á¥ÍÑ¥¹‘¥Ñ½¹Ñ…¥¹•È€ô‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È œ¹•‘¥ÐµÑÉ…¹Í±…Ñ¥½¸µ½¹Ñ…¥¹•Èœ¤ì4(€€€¥˜€¡•á¥ÍÑ¥¹‘¥Ñ½¹Ñ…¥¹•È¤ì4(€€€€€€€½¹ÍÐ½É¥¥¹…±MÁ…¸€ô•á¥ÍÑ¥¹‘¥Ñ½¹Ñ…¥¹•È¹ÁÉ•Ù¥½ÕÍM¥‰±¥¹œì4(€€€€€€€¥˜€¡½É¥¥¹…±MÁ…¸€˜˜½É¥¥¹…±MÁ…¸¹ÍÑå±”¹‘¥ÍÁ±…ä€ôôô€¹½¹”œ¤ì4(€€€€€€€€€€€½É¥¥¹…±MÁ…¸¹ÍÑå±”¹‘¥ÍÁ±…ä€ô€œœì4(€€€€€€€ô4(€€€€€€€•á¥ÍÑ¥¹‘¥Ñ½¹Ñ…¥¹•È¹É•µ½Ù” ¤ì4(4(€€€€€€€¥˜€¡½É¥¥¹…±MÁ…¸€ôôôÑÉ…¹Í±…Ñ¥½¹MÁ…¸¤ì4(€€€€€€€€€€€É•ÑÕÉ¸ì4(€€€€€€€ô4(€€€ô4(4(€€€ÑÉ…¹Í±…Ñ¥½¹MÁ…¸¹ÍÑå±”¹‘¥ÍÁ±…ä€ô€¹½¹”œì4(4(€€€½¹ÍÐ¥¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì4(€€€¥¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì4(€€€½¹ÍÐÕÉÉ•¹ÑQÉ…¹Í±…Ñ¥½¸€ôÑÉ…¹Í±…Ñ¥½¹MÁ…¸¹Ñ•áÑ½¹Ñ•¹Ð¹Í±¥” Ä°€´Ä¤ì4(€€€¥¹ÁÕÐ¹Ù…±Õ”€ôÕÉÉ•¹ÑQÉ…¹Í±…Ñ¥½¸ì4(€€€¥¹ÁÕÐ¹±…ÍÍ9…µ”€ô€•‘¥ÐµÑÉ…¹Í±…Ñ¥½¸µ¥¹ÁÕÐœì4(4(€€€½¹ÍÐÍ…Ù•	ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€Í…Ù•	ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€…Ñ¥½¸µ‰ÕÑÑ½¸œì(€€€Í…Ù•	ÕÑÑ½¸¹ÑåÁ”€ô€‰‰ÕÑÑ½¸ˆì(€€€Í…Ù•	ÕÑÑ½¸¹Í•ÑÑÑÉ¥‰ÕÑ” ‰…É¥„µ±…‰•°ˆ°€‰M…Ù”ÑÉ…¹Í±…Ñ¥½¸ˆ¤ì(€€€Í…Ù•	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€‹ŠrLˆì(4(€€€½¹ÍÐ•‘¥Ñ½¹Ñ…¥¹•È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÁ…¸œ¤ì4(€€€•‘¥Ñ½¹Ñ…¥¹•È¹±…ÍÍ9…µ”€ô€•‘¥ÐµÑÉ…¹Í±…Ñ¥½¸µ½¹Ñ…¥¹•Èœì4(€€€•‘¥Ñ½¹Ñ…¥¹•È¹…ÁÁ•¹‘¡¥±¡¥¹ÁÕÐ¤ì4(€€€•‘¥Ñ½¹Ñ…¥¹•È¹…ÁÁ•¹‘¡¥±¡Í…Ù•	ÕÑÑ½¸¤ì4(4(€€€ÑÉ…¹Í±…Ñ¥½¹MÁ…¸¹Á…É•¹Ñ9½‘”¹¥¹Í•ÉÑ	•™½É”¡•‘¥Ñ½¹Ñ…¥¹•È°ÑÉ…¹Í±…Ñ¥½¹MÁ…¸¹¹•áÑM¥‰±¥¹œ¤ì4(4(€€€¥¹ÁÕÐ¹™½ÕÌ ¤ì4(4(€€€¥¹ÁÕÐ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ­•å‘½Ý¸œ°€¡•Ù•¹Ð¤€ôøì4(€€€€€€€¥˜€¡•Ù•¹Ð¹­•ä€ôôô€¹Ñ•Èœ¤ì4(€€€€€€€€€€€•Ù•¹Ð¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì4(€€€€€€€€€€€Í…Ù•	ÕÑÑ½¸¹±¥¬ ¤ì4(€€€€€€€ô4(€€€ô¤ì4(4(€€€Í…Ù•	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°…Íå¹Œ€ ¤€ôøì(€€€€€€€½¹ÍÐ¹•ÝQÉ…¹Í±…Ñ¥½¸€ô¥¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤ì((€€€€€€€¥˜€¡¹•ÝQÉ…¹Í±…Ñ¥½¸€˜˜Ý½É‘%¤ì(€€€€€€€€€€€Í…Ù•	ÕÑÑ½¸¹‘¥Í…‰±•€ôÑÉÕ”ì(€€€€€€€€€€€ÑÉäì(€€€€€€€€€€€€€€€…Ý…¥ÐÕÁ‘…Ñ•]½É‘%¹MÑ½É…”¡Ý½É‘%°¹•ÝQÉ…¹Í±…Ñ¥½¸¤ì(€€€€€€€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€€€€€€€€€Í…Ù•	ÕÑÑ½¸¹‘¥Í…‰±•€ô™…±Í”ì(€€€€€€€€€€€€€€€Í¡½Ý½¹Ñ•¹Ñ9½Ñ¥™¥…Ñ¥½¸¡•ÉÉ½Èü¹µ•ÍÍ…”ñð€‰U¹…‰±”Ñ¼ÕÁ‘…Ñ”Ñ¡”ÑÉ…¹Í±…Ñ¥½¸¸ˆ°€‰•ÉÉ½Èˆ¤ì(€€€€€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€ô(€€€€€€€ô(4(€€€€€€€•‘¥Ñ½¹Ñ…¥¹•È¹É•µ½Ù” ¤ì4(€€€ô¤ì4)ô4(4(¼¼!•±Á•È™Õ¹Ñ¥½¸Ñ¼ÕÁ‘…Ñ”MLÕÍÑ½´ÁÉ½Á•ÉÑ¥•Ì™½È¡¥¡±¥¡Ð½±½ÉÌ4)™Õ¹Ñ¥½¸ÕÁ‘…Ñ•!¥¡±¥¡Ñ½±½ÉÌ¡¡¥¡±¥¡Ñ½±½È°ÑÉ…¹Í±…Ñ¥½¹½±½È¤ì4(€€€¥˜€¡¡¥¡±¥¡Ñ½±½È¤ì4(€€€€€€€‘½Õµ•¹Ð¹‘½Õµ•¹Ñ±•µ•¹Ð¹ÍÑå±”¹Í•ÑAÉ½Á•ÉÑä œ´µ¡¥¡±¥¡Ðµ½±½Èœ°¡¥¡±¥¡Ñ½±½È¤ì4(€€€ô4(€€€¥˜€¡ÑÉ…¹Í±…Ñ¥½¹½±½È¤ì4(€€€€€€€‘½Õµ•¹Ð¹‘½Õµ•¹Ñ±•µ•¹Ð¹ÍÑå±”¹Í•ÑAÉ½Á•ÉÑä œ´µÑÉ…¹Í±…Ñ¥½¸µ½±½Èœ°ÑÉ…¹Í±…Ñ¥½¹½±½È¤ì4(€€€ô4)ô4(4)¡É½µ”¹ÉÕ¹Ñ¥µ”¹½¹5•ÍÍ…”¹…‘‘1¥ÍÑ•¹•È¡™Õ¹Ñ¥½¸€¡É•ÅÕ•ÍÐ°Í•¹‘•È°Í•¹‘I•ÍÁ½¹Í”¤ì4(€€€¥˜€¡É•ÅÕ•ÍÐ¹…Ñ¥½¸€ôôô€‰Í…Ù•]½É‘Q½¥Ñ¥½¹…Éäˆ¤ì4(€€€€€€€½¹Í½±”¹±½œ ‰I••¥Ù•Í•±•Ñ•Ñ•áÐèˆ°É•ÅÕ•ÍÐ¹Ñ•áÐ¤ì4(€€€€€€€ÉÕ¹1½¥Œ¡É•ÅÕ•ÍÐ¹Ñ•áÐ¤ì4(€€€€€€€Í•¹‘I•ÍÁ½¹Í”¡ìÍÑ…ÑÕÌè€‰ÍÕ•ÍÌˆô¤ì4(€€€ô4)ô¤ì4(4)¡É½µ”¹ÉÕ¹Ñ¥µ”¹½¹5•ÍÍ…”¹…‘‘1¥ÍÑ•¹•È ¡É•ÅÕ•ÍÐ¤€ôøì4(€€€¥˜€¡É•ÅÕ•ÍÐ¹…Ñ¥½¸€ôôô€‰Ý½É‘Í¡…¹•ˆ¤ì4(€€€€€€€½¹Í½±”¹±½œ m1…éå1•ááÑtI••¥Ù•Ý½É‘Í¡…¹•µ•ÍÍ…”œ°É•ÅÕ•ÍÐ¤ì4(€€€€€€€½¹ÍÐì½Á•É…Ñ¥½¸°Ý½É°Ý½É‘Ìô€ôÉ•ÅÕ•ÍÐ¹¹•ÝY…±Õ”ì4(4(€€€€€€€ÍÝ¥Ñ €¡½Á•É…Ñ¥½¸¤ì4(€€€€€€€€€€€…Í”€…‘œè4(€€€€€€€€€€€€€€€…‘‘!¥¡±¥¡Ñ½É]½É¡Ý½É¤ì4(€€€€€€€€€€€€€€€‰É•…¬ì4(€€€€€€€€€€€…Í”€ÕÁ‘…Ñ”œè(€€€€€€€€€€€€€€€¥˜€¡Ý½Éü¹ÍÑ…ÑÕÌ€ôôô€‰±•…É¹•ˆñðÝ½Éü¹±•…É¹•€ôôôÑÉÕ”ñð9Õµ‰•È¡Ý½Éü¹•¹½Õ¹Ñ•É½Õ¹Ð¤€ø€ÈÀÀ¤ì(€€€€€€€€€€€€€€€€€€€É•µ½Ù•!¥¡±¥¡ÑÍ½É]½É¡Ý½É¤ì(€€€€€€€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€€€€€€€€€ÕÁ‘…Ñ•!¥¡±¥¡ÑÍ½É]½É¡Ý½É¤ì(€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€‰É•…¬ì(€€€€€€€€€€€…Í”€‘•±•Ñ”œè4(€€€€€€€€€€€€€€€É•µ½Ù•!¥¡±¥¡ÑÍ½É]½É¡Ý½É¤ì4(€€€€€€€€€€€€€€€‰É•…¬ì4(€€€€€€€€€€€…Í”€É•±½…œè4(€€€€€€€€€€€€€€€±•…É!¥¡±¥¡Ñ¥¹œ ¤ì4(€€€€€€€€€€€€€€€¡¥¡±¥¡Ñ]½É‘Ì¡Ý½É‘Ì¤ì4(€€€€€€€€€€€€€€€‰É•…¬ì4(€€€€€€€€€€€…Í”€±•…Èœè4(€€€€€€€€€€€€€€€±•…É!¥¡±¥¡Ñ¥¹œ ¤ì4(€€€€€€€€€€€€€€€‰É•…¬ì4(€€€€€€€ô4(€€€ô4(4(€€€¥˜€¡É•ÅÕ•ÍÐ¹…Ñ¥½¸€ôôô€‰Í•ÑÑ¥¹Í¡…¹•ˆ¤ì4(€€€€€€€½¹Í½±”¹±½œ m1…éå1•ááÑtM•ÑÑ¥¹Ì¡…¹•èœ°É•ÅÕ•ÍÐ¹Í•ÑÑ¥¹Ì¤ì4(€€€€€€€…ÁÁ±åM•ÑÑ¥¹Ì¡É•ÅÕ•ÍÐ¹Í•ÑÑ¥¹Ì¤ì4(€€€ô4)ô¤ì4(4)±½…‘%¹¥Ñ¥…±M•ÑÑ¥¹Ì ¤ì()½¹Í½±”¹±½œ m1…éå1•ááÑt½¹Ñ•¹ÐÍÉ¥ÁÐ±½…‘•œ¤ì(