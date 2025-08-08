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
let originalTextContent = [];

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

async function runLogic(selectedText) {
    console.log('[WordMemoExt] runLogic called with:', selectedText);
    saveWordToDictionary(selectedText)
        .then((_) => {
            if (settings["animationToggle"]) {
                animateWordToToolbar();
            }
        })
        .catch((error) => {
            console.log("error", error);
            console.log("error.code", error.code);
            if (error.code === 403) {
                console.log("please login");
            } else {
                console.log("some error happened");
            }
        });
}

// Replace saveWordToDictionary to use local storage and GPT API for translation
async function saveWordToDictionary(word) {
    try {
        console.log('[WordMemoExt] saveWordToDictionary called with:', word);
        // Get current words
        const { words } = await chrome.storage.local.get(["words"]);
        const wordList = words || [];

        const wordExists = wordList.some(
            (w) => w.word.toLowerCase() === word.toLowerCase()
        );
        if (wordExists) {
            console.log(
                `[WordMemoExt] Word "${word}" already exists in the dictionary.`
            );
            return; // Exit if the word is already saved
        }
        // Use GPT API for translation (placeholder)
        const translation = await translateWithGPT(word, settings["languageCode"] || "uk");
        // Create new word object
        const newWord = {
            id: Date.now(),
            word: word.toLowerCase(),
            translation: translation,
        };
        // Save to local storage
        const updatedWords = [...wordList, newWord];
        await chrome.storage.local.set({ words: updatedWords });
        console.log('[WordMemoExt] Updated words list:', updatedWords);
    } catch (error) {
        console.error("Error saving word:", error);
    }
}

function animateWordToToolbar() {
    let selection = window.getSelection();
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const floatingWord = document.createElement("span");
    floatingWord.textContent = selection;
    floatingWord.style.position = "fixed";
    floatingWord.style.zIndex = "999999";
    floatingWord.style.background = "#68c2ff";
    floatingWord.style.border = "1px solid #3A8FC9FF";
    floatingWord.style.borderRadius = "5px";
    floatingWord.style.left = `${rect.left}px`;
    floatingWord.style.top = `${rect.top}px`;
    floatingWord.style.transition = "top 0.5s linear, left 0.5s linear";

    document.body.appendChild(floatingWord);
    window.getSelection().removeAllRanges();
    // Animate the word towards the top-right corner (where the extension icon usually is)
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
    originalTextContent.forEach(([parentNode, innerHTML]) => {
        parentNode.innerHTML = innerHTML;
    });

    originalTextContent = [];
}

function replaceTextNode(node, targetWords, translations) {
    const words = node.nodeValue.split(" ");
    const parentNode = node.parentNode;
    const documentFragment = document.createDocumentFragment();

    words.forEach((word) => {
        if (targetWords.includes(word.toLowerCase())) {
            const highlightedSpan = document.createElement("span");
            highlightedSpan.classList.add("highlighted-word");
            highlightedSpan.textContent = word;
            requestAnimationFrame(() => {
                highlightedSpan.classList.add("animate-border");
            });
            documentFragment.appendChild(highlightedSpan);

            setTimeout(() => {
                highlightedSpan.classList.add("animate-background");
            }, 10);

            const translationText = `[${translations[word.toLowerCase()].translation}] `;
            const translationNode = document.createElement("span");
            translationNode.classList.add("translation");
            translationNode.dataset.wordId = translations[word.toLowerCase()].id;
            translationNode.textContent = translationText;

            documentFragment.appendChild(translationNode);
        } else {
            const wordNode = document.createTextNode(word + " ");
            documentFragment.appendChild(wordNode);
        }
    });

    originalTextContent.push([parentNode, parentNode.innerHTML]);

    parentNode.replaceChild(documentFragment, node);
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

(function loadSettings() {
    return chrome.storage.local.get(["translateTo", "animationToggle", "sentenceCounter", "apiKey"], (items) => {
        settings["languageCode"] = items.translateTo || "UK";
        settings["languageFull"] = "Ukrainian";
        settings["animationToggle"] = items.animationToggle !== undefined ? items.animationToggle === "true" : true;
        settings["sentenceCounter"] = items.sentenceCounter || 1;
        settings["apiKey"] = items.apiKey || "";
    });
})();

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
    if (event.target.id === "add new word") {
        return;
    }

    const existingButton = document.getElementById("add new word");
    if (existingButton) {
        existingButton.remove();
    }
    if (event.target.tagName !== "BUTTON") {
        const selectedText = window.getSelection().toString().trim();
        if (selectedText) {
            const button = document.createElement("div");
            button.id = "add new word";
            button.innerText = "+";
            button.style.width = "20px";
            button.style.height = "20px";
            button.style.padding = "4px";
            button.style.backgroundColor = "white";
            button.style.border = "1px solid black";
            button.style.borderRadius = "2px";
            button.style.textAlign = "center";
            button.style.display = "inline-block";
            button.style.cursor = "pointer";
            button.style.position = "absolute";
            button.style.top = event.pageY + 20 + "px";
            button.style.left = event.pageX + 20 + "px";
            button.addEventListener("click", function () {
                console.log('[WordMemoExt] + button clicked, selectedText:', selectedText);
                runLogic(selectedText);
                window.getSelection().empty();
                window.getSelection().removeAllRanges();
                button.remove();
            });
            document.body.appendChild(button);
        }
    }
});

document.addEventListener("click", (e) => {
    const existingButton = document.getElementById("deleteWordBtn");

    if (existingButton) existingButton.remove();

    if (!e.target.dataset.wordId) return;

    const deleteButton = document.createElement("button");
    deleteButton.textContent = "-";
    deleteButton.id = "deleteWordBtn";

    deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();

        const clickedWordId = e.target.dataset.wordId;

        deleteWordFromStorage(clickedWordId);

        deleteButton.remove();
    });

    e.target.appendChild(deleteButton);
});

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === "saveWordToDictionary") {
        console.log("Received selected text:", request.text);
        runLogic(request.text);
        sendResponse({ status: "success" });
    }
});

chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "extensionStateChanged") {
        const enabled = request.newValue;

        handleExtensionStateChange(enabled);
    }

    if (request.action === "wordsChanged") {
        console.log('[WordMemoExt] Received wordsChanged message', request.newValue);
        const words = request.newValue;

        clearHighlighting();

        if (words.length > 0) {
            highlightWords(words);
        }

        console.log("words were changed: ", words);
    }
});

window.addEventListener("message", (event) => {
    if (event.data.token) {
        chrome.storage.local.set({ token: event.data.token }, () => {
            console.log("Token stored in chrome storage");
        });
    }
});

checkInitialExtensionState();

// Add a function for translation using GPT API (placeholder)
async function translateWithGPT(text, targetLang) {
    const apiKey = settings["apiKey"];
    if (!apiKey) {
        console.log("API key is missing. Please set it in the options.");
        return `[translation disabled]`;
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [
                {
                    role: 'system',
                    content: 'You are a translator.'
                },
                {
                    role: 'user',
                    content: `Translate the following English word to ${targetLang}: ${text}`
                }
            ],
            max_tokens: 10,
            temperature: 0.1
        })
    });

    if (!response.ok) {
        console.error("GPT API request failed:", response.status, response.statusText);
        const errorBody = await response.json();
        console.error("Error details:", errorBody);
        if (response.status === 401) {
            return `[invalid API key]`;
        }
        if (response.status === 429) {
            return `[rate limit exceeded]`;
        }
        return `[translation failed]`;
    }

    const data = await response.json();
    if (data.choices && data.choices.length > 0 && data.choices[0].message) {
        return data.choices[0].message.content.trim();
    } else {
        console.error("Invalid response from GPT API:", data);
        return `[invalid response]`;
    }
}

console.log('[WordMemoExt] Content script loaded');
