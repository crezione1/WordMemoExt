const ENV = 'prod';

const config = {
    dev: {
        API_URL: 'http://localhost:8080',
    },
    prod: {
        API_URL: 'https://sea-lion-app-ut382.ondigitalocean.app',
    },
};

const API_URL = config[ENV].API_URL;

let settings = {};
let originalTextContent = [];

async function getToken() {
    const result = await chrome.storage.local.get(['token']);
    return result.token;
}

// Saving/deleting words

async function deleteWordFromStorage(wordId) {
    const { words } = await chrome.storage.local.get(['words']);
    const updatedWords = words.filter((word) => word.id !== Number(wordId));

    chrome.storage.local.set({ words: updatedWords });
}

async function runLogic(selectedText) {
    saveWordToDictionary(selectedText)
        .then((_) => {
            animateWordToToolbar();
        })
        .catch((error) => {
            console.log('error', error);
            console.log('error.code', error.code);
            if (error.code === 403) {
                console.log('please login');
            } else {
                console.log('some error happened');
            }
        });
}

async function saveWordToDictionary(word) {
    try {
        const token = await getToken();

        await fetch(`${API_URL}/api/words`, {
            method: 'POST',
            body: JSON.stringify({ word: word.toLowerCase(), ...settings }),
            headers: {
                Authorization: 'Bearer ' + token,
                Accept: 'application/json, application/xml, text/plain, text/html, */*',
                'Content-Type': 'application/json',
            },
        });
    } catch (error) {
        console.error('Error saving word:', error);
    }
}

function animateWordToToolbar() {
    let selection = window.getSelection();
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const floatingWord = document.createElement('span');
    floatingWord.textContent = selection;
    floatingWord.style.position = 'fixed';
    floatingWord.style.zIndex = '999999';
    floatingWord.style.background = '#68c2ff';
    floatingWord.style.border = '1px solid #3A8FC9FF';
    floatingWord.style.borderRadius = '5px';
    floatingWord.style.left = `${rect.left}px`;
    floatingWord.style.top = `${rect.top}px`;
    floatingWord.style.transition = 'top 0.5s linear, left 0.5s linear';

    document.body.appendChild(floatingWord);
    window.getSelection().removeAllRanges();
    // Animate the word towards the top-right corner (where the extension icon usually is)
    setTimeout(() => {
        floatingWord.style.left = '95%';
        floatingWord.style.top = '5px';
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
    const words = node.nodeValue.split(' ');
    const parentNode = node.parentNode;
    const documentFragment = document.createDocumentFragment();

    words.forEach((word) => {
        if (targetWords.includes(word.toLowerCase())) {
            const highlightedSpan = document.createElement('span');
            highlightedSpan.classList.add('highlighted-word');
            highlightedSpan.textContent = word;
            requestAnimationFrame(() => {
                highlightedSpan.classList.add('animate-border');
            });
            documentFragment.appendChild(highlightedSpan);

            setTimeout(() => {
                highlightedSpan.classList.add('animate-background');
            }, 10);

            const translationText = `[${
                translations[word.toLowerCase()].translation
            }] `;
            const translationNode = document.createElement('span');
            translationNode.classList.add('translation');
            translationNode.dataset.wordId =
                translations[word.toLowerCase()].id;
            translationNode.textContent = translationText;

            documentFragment.appendChild(translationNode);
        } else {
            const wordNode = document.createTextNode(word + ' ');
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
        if (
            targetWords.some((targetWord) =>
                node.nodeValue.toLowerCase().includes(targetWord)
            )
        ) {
            replaceTextNode(node, targetWords, translations);
        }
    });
}

function handleExtensionStateChange(enabled) {
    if (enabled) {
        chrome.storage.local.get(['words']).then((result) => {
            if (result.words !== undefined && result.words.length > 0) {
                highlightWords(result.words);
            }
        });

        console.log('Extension is enabled for this site.');
    } else {
        clearHighlighting();
        console.log('Extension is disabled for this site.');
    }
}

function checkInitialExtensionState() {
    chrome.runtime.sendMessage(
        { action: 'checkExtensionState' },
        function (response) {
            const enabled = response.enabled;
            handleExtensionStateChange(enabled);
        }
    );
}

// Event listeners and initialization

(function loadSettings() {
    return chrome.storage.local.get(
        ['translateTo', 'animationToggle', 'sentenceCounter'],
        (items) => {
            settings['languageCode'] = items.translateTo || 'UK';
            settings['languageFull'] = 'Ukrainian';
            settings['animationToggle'] =
                items.animationToggle !== undefined
                    ? items.animationToggle === 'true'
                    : true;
            settings['sentenceCounter'] = items.sentenceCounter || 1;
        }
    );
})();

document.addEventListener('keydown', function (event) {
    if (event.ctrlKey && event.shiftKey && event.code === 'KeyS') {
        const selectedText = window.getSelection().toString().trim();
        if (selectedText) {
            runLogic(selectedText);
            console.log(`Saved: ${selectedText}`);
        }
    }
});

document.addEventListener('mousedown', function (event) {
    if (event.target.tagName !== 'BUTTON') {
        const existingButton = document.getElementById('add new word');
        if (existingButton) {
            window.getSelection().empty();
            window.getSelection().removeAllRanges();
            existingButton.remove();
        }
    }
});

document.addEventListener('mouseup', function (event) {
    if (event.target.tagName !== 'BUTTON') {
        const selectedText = window.getSelection().toString().trim();
        if (selectedText) {
            const button = document.createElement('div');
            button.id = 'add new word';
            button.innerText = '+';
            button.style.width = '20px';
            button.style.height = '20px';
            button.style.padding = '4px';
            button.style.backgroundColor = 'white';
            button.style.border = '1px solid black';
            button.style.borderRadius = '2px';
            button.style.textAlign = 'center';
            button.style.display = 'inline-block';
            button.style.cursor = 'pointer';
            button.style.position = 'absolute';
            button.style.top = event.pageY + 20 + 'px';
            button.style.left = event.pageX + 20 + 'px';
            button.addEventListener('click', function () {
                alert('Button clicked!');
                window.getSelection().empty();
                window.getSelection().removeAllRanges();
                button.remove();
                // add logic for saving the word
            });
            // button.onclick = function () {
            //     alert('Button clicked!');
            //     window.getSelection().empty();
            //     window.getSelection().removeAllRanges();
            //     button.remove()
            //     // add logic for saving the word
            // };
            document.body.appendChild(button);
        }
    }
});

document.addEventListener('click', (e) => {
    const existingButton = document.getElementById('deleteWordBtn');

    if (existingButton) existingButton.remove();

    if (!e.target.dataset.wordId) return;

    const deleteButton = document.createElement('button');
    deleteButton.textContent = '-';
    deleteButton.id = 'deleteWordBtn';

    deleteButton.addEventListener('click', (event) => {
        event.stopPropagation();

        const clickedWordId = e.target.dataset.wordId;

        deleteWordFromStorage(clickedWordId);

        deleteButton.remove();
    });

    e.target.appendChild(deleteButton);
});

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === 'saveWordToDictionary') {
        console.log('Received selected text:', request.text);
        runLogic(request.text);
        sendResponse({ status: 'success' });
    }
});

chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'extensionStateChanged') {
        const enabled = request.newValue;

        handleExtensionStateChange(enabled);
    }

    if (request.action === 'wordsChanged') {
        const words = request.newValue;

        clearHighlighting();

        if (words.length > 0) {
            highlightWords(words);
        }

        console.log('words were changed: ', words);
    }
});

checkInitialExtensionState();
