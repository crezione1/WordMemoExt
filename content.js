const ENV = "prod";

const config = {
    dev: {
        API_URL: "http://localhost:8080",
    },
    prod: {
        API_URL: "https://sea-lion-app-ut382.ondigitalocean.app",
    },
};

const API_URL = config[ENV].API_URL;

let settings = {};

async function getToken() {
    const result = await chrome.storage.local.get(["token"]);
    return result.token;
}

// Saving/deleting words

async function deleteWordFromStorage(wordId) {
    const { words } = await chrome.storage.local.get(["words"]);
    const updatedWords = words.filter((word) => word.id !== Number(wordId));

    chrome.storage.local.set({ words: updatedWords });
}

async function updateWordInStorage(wordId, newTranslation) {
    const { words } = await chrome.storage.local.get(["words"]);
    const updatedWords = words.map(word => {
        if (word.id === Number(wordId)) {
            return { ...word, translation: newTranslation, lastUpdated: Date.now() };
        }
        return word;
    });
    chrome.storage.local.set({ words: updatedWords });
}

async function runLogic(selectedText, rect) {
    // Clean the selection to only get the original word, not the translation
    const originalWord = selectedText.split('[')[0].trim();
    if (!originalWord) return;

    console.log('[WordMemoExt] runLogic called with:', originalWord);

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
        console.log("Error saving word in background:", error);
    });
}

// Replace saveWordToDictionary to use local storage and GPT API for translation
async function saveWordToDictionary(word) {
    try {
        console.log('[WordMemoExt] saveWordToDictionary called with:', word);
        // Get current words
        const { words } = await chrome.storage.local.get({ words: [] });

        // Normalize the word to lowercase for consistent storage and Firebase
        const baseWord = (word || '').toLowerCase();

        // Use Firebase Cloud Function for translation (Google Translation API)
        const tr = await translateWithTAS(baseWord, settings["languageCode"] || "uk");
        const translation = typeof tr === 'string' ? tr : (tr?.translation || word);
        const synonyms = Array.isArray(tr?.synonyms) ? tr.synonyms : [];
        const examples = Array.isArray(tr?.examples) ? tr.examples : [];
        // Create new word object with unique id (avoid same-ms collisions)
        let newId = Date.now();
        const ids = new Set((words || []).map(w => Number(w.id)));
        while (ids.has(newId)) newId += 1;
        const newWord = {
            id: newId,
            word: baseWord,
            translation: translation,
            dateAdded: Date.now(), // Add current date
            learned: false, // Default learned status
            synonyms: synonyms,
            examples: examples
        };
        chrome.runtime.sendMessage({ action: "saveWordsToStorage" });
        // addHighlightForWord(newWord);

        // Save to local storage
        const updatedWords = [...words, newWord];
        await chrome.storage.local.set({ words: updatedWords });
        console.log('[WordMemoExt] Updated words list:', updatedWords);
    } catch (error) {
        console.error("Error saving word:", error);
    }
}

// Implement translateWithTAS by delegating to Firebase callable function (minimal change)
async function translateWithTAS(word, targetLang) {
    try {
        console.log('[WordMemoExt] translateWithTAS request', { word, targetLang });
        const response = await chrome.runtime.sendMessage({
            action: 'translateWord',
            word,
            targetLanguage: targetLang || 'uk'
        });
        if (response && response.success && response.result && response.result.translation) {
            console.log('[WordMemoExt] translateWithTAS success', { word, translation: response.result.translation, synonymsCount: (response.result.synonyms||[]).length });
            return response.result;
        }
        throw new Error(response?.error || 'Translate failed');
    } catch (e) {
        console.warn('[WordMemoExt] translateWithTAS fallback due to error:', e?.message || e);
        // Fallback: return original word if function failed
        return { translation: word, synonyms: [] };
    }
}

function animateWordToToolbar(selectedText, rect) {
    if (!rect) return;

    const floatingWord = document.createElement("span");
    floatingWord.textContent = selectedText;
    floatingWord.style.position = "fixed";
    floatingWord.style.zIndex = "999999";
    floatingWord.style.background = "#68c2ff";
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
            const parts = node.nodeValue.split(new RegExp(`(${text})`, 'gi'));

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
    const parts = node.nodeValue.split(new RegExp(`\\b(${targetWords.join('|')})\\b`, 'gi'));

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

function findTextNodes(element) {
    let nodes = [];
    for (element = element.firstChild; element; element = element.nextSibling) {
        if (element.nodeType === 3 && !element.nodeValue.match(/^\s*$/)) {
            nodes.push(element);
        } else if (element.nodeType === 1) {
            nodes = nodes.concat(findTextNodes(element));
        }
    }
    return nodes;
}

async function highlightWords(words) {
    const targetWords = words.map((t) => t.word.toLowerCase());
    const textNodes = findTextNodes(document.body);

    const translations = words.reduce((result, item) => {
        const key = item.word;
        result[key] = item;
        return result;
    }, {});

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
        "translationColor"
    ], (items) => {
        const initialSettings = {
            languageCode: items.translateTo || "uk",
            languageFull: "Ukrainian",
            animationToggle: items.animationToggle !== undefined ? items.animationToggle === "true" : true,
            sentenceCounter: items.sentenceCounter || 1,
            highlightingEnabled: items.highlightingEnabled !== undefined ? items.highlightingEnabled : true,
            highlightColor: items.highlightColor,
            translationColor: items.translationColor
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
                console.log('[WordMemoExt] + button clicked, selectedText:', selectedText);
                runLogic(selectedText, rect);
                window.getSelection().empty();
                window.getSelection().removeAllRanges();
                button.remove();
            });
            document.body.appendChild(button);
        }
    }
});

document.addEventListener("click", (e) => {
    const wrapper = e.target.closest('.highlight-wrapper');

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

    deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteWordFromStorage(wrapper.dataset.wordId);
        deleteButton.remove();
    });

    // Append to the wrapper for correct positioning relative to the highlighted word
    wrapper.appendChild(deleteButton);
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
    saveButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z"/></svg>';

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

    saveButton.addEventListener('click', () => {
        const newTranslation = input.value.trim();

        if (newTranslation && wordId) {
            updateWordInStorage(wordId, newTranslation);
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
        console.log('[WordMemoExt] Received wordsChanged message', request);
        const { operation, word, words } = request.newValue;

        switch (operation) {
            case 'add':
                addHighlightForWord(word);
                break;
            case 'update':
                updateHighlightsForWord(word);
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
        console.log('[WordMemoExt] Settings changed:', request.settings);
        applySettings(request.settings);
    }
});

window.addEventListener("message", (event) => {
    if (event.data.token) {
        chrome.storage.local.set({ token: event.data.token }, () => {
            console.log("Token stored in chrome storage");
        });
    }
});

loadInitialSettings();

async function translateWithTAS(word, targetLang) {
    try {
        console.log('[WordMemoExt] translateWithTAS request', { word, targetLang });
        const response = await chrome.runtime.sendMessage({
            action: 'translateWord',
            word,
            targetLanguage: targetLang || 'uk'
        });
        if (response && response.success && response.result && response.result.translation) {
            console.log('[WordMemoExt] translateWithTAS success', { word, translation: response.result.translation, synonymsCount: (response.result.synonyms||[]).length });
            return response.result;
        }
        throw new Error(response?.error || 'Translate failed');
    } catch (e) {
        console.warn('[WordMemoExt] translateWithTAS fallback due to error:', e?.message || e);
        return { translation: word, synonyms: [], examples: [] };
    }
}

console.log('[WordMemoExt] Content script loaded');
