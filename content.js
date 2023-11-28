const ENV = 'prod';

const config = {
    dev: {
        API_URL: 'http://localhost:8080'
    },
    prod: {
        API_URL: 'https://sea-lion-app-ut382.ondigitalocean.app'
    }
};

const API_URL = config[ENV].API_URL;

let settings = {};
(function loadSettings() {
   return chrome.storage.local.get(['translateTo', 'animationToggle', 'sentenceCounter'], function(items) {
       settings['languageCode'] = items.translateTo;
       settings['animationToggle'] = items.animationToggle === 'true';
       settings['sentenceCounter'] = items.sentenceCounter;
    });
})();
// document.addEventListener('click', function(event) {
//     let targetElement = event.target; // Starting point
//     console.log("AAAAAAAAAAAAAA")
//     while (targetElement != null) {
//         if (targetElement.classList.contains('s-item')) {
//             // Found the item card root element
//             console.log('Item card root element:', targetElement);
//             break;
//         }
//         targetElement = targetElement.parentElement; // Move up in the DOM tree
//     }
// });

document.addEventListener('keydown', function (event) {
    console.log(chrome)
    if (event.ctrlKey && event.shiftKey && event.code === 'KeyS') {
        const selectedText = window.getSelection().toString().trim();
        if (selectedText) {
            runLogic(selectedText);
            console.log(`Saved: ${selectedText}`);
        }

    }
});

document.addEventListener('mousedown', function(event) {
    if (event.target.tagName !== 'BUTTON') {
        const existingButton = document.getElementById('add new word');
        if (existingButton) {
            window.getSelection().empty();
            window.getSelection().removeAllRanges();
            existingButton.remove();
        }
    }
});

document.addEventListener('mouseup', function(event) {
    if (event.target.tagName !== 'BUTTON') {
        const selectedText = window.getSelection().toString().trim();
        if (selectedText) {
            const button = document.createElement('div');
            button.id = "add new word"
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
                button.remove()
                // add logic for saving the word
            })
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

async function runLogic(selectedText) {
    saveWordToDictionary(selectedText)
        .then(_ => {
            animateWordToToolbar()
        })
        .catch(error => {
        console.log('error', error)
        console.log('error.code', error.code)
        if (error.code === 403) {
            console.log('please login')
        } else {
            console.log('some error happened')
        }
    });
}

async function saveWordToDictionary(word) {
    chrome.storage.local.get(['token'], function (result) {
        console.log(chrome.storage.local.get(['token']))
        let token = result.token;
        console.log('result', result)
        console.log('result.token', token)
        fetch(`${API_URL}/api/word/${word}`, {
            method: 'POST',
            body: JSON.stringify(settings),
            headers: {
                'Authorization': 'Bearer ' + token,
                'Accept': 'application/json, application/xml, text/plain, text/html, */*',
                'Content-Type': 'application/json'
            }
        })
    });
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
    window.getSelection().removeAllRanges()
    // Animate the word towards the top-right corner (where the extension icon usually is)
    setTimeout(() => {
        floatingWord.style.left = '95%';
        floatingWord.style.top = '5px';
    }, 50);

    setTimeout(() => {
        floatingWord.remove();
    }, 550);
}

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    console.log("Received selected text:", request.text);
    runLogic(request.text);
    sendResponse({status: "success"});
});

function replaceTextNode(node, targetWords, translations) {
    const words = node.nodeValue.split(' ');
    const parentNode = node.parentNode;
    let documentFragment = document.createDocumentFragment();

    words.forEach(word => {
        let wordNode = document.createTextNode(word + ' ');

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

            const translationText = '[' + translations[word.toLowerCase()] + '] ';
            const translationNode = document.createElement('span');
            translationNode.style.color = '#d0d0d0';
            translationNode.textContent = translationText;
            documentFragment.appendChild(translationNode);
        } else {
            documentFragment.appendChild(wordNode);
        }
    });

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

async function highlightWords() {
    const translationsDto = await getAllTranslations();
    const translations = translationsDto.map(t => {
        let key = t.word.toLowerCase();
        return {[key]: t.translation};
    });

    const targetWords = translationsDto.map(t => t.word.toLowerCase());
    const textNodes = findTextNodes(document.body);

    const trans = translations.reduce(function(result, item) {
        var key = Object.keys(item)[0]; //first property: a, b, c
        result[key] = item[key];
        return result;
    }, {});
    textNodes.forEach(node => {
        if (targetWords.some(targetWord => node.nodeValue.toLowerCase().includes(targetWord))) {
            replaceTextNode(node, targetWords, trans);
        }
    });
}
// async function getTranslation(word) {
//     // checkLocalDb()
//     let translateTo = 'ua';
//     return fetch(`${API_URL}/translate`, {
//         method: 'POST',
//         headers: {
//             'Authorization': 'Bearer ' + apiToken,
//             'Accept': 'application/json, application/xml, text/plain, text/html, */*',
//             'Content-Type': 'application/json'
//         },
//         body : {
//             word: word,
//             translateTo: translateTo
//         }
//     })
// }

async function getAllTranslations() {
    let translations = {};
    try {
        const result = await chrome.storage.local.get(['token']);
        const token = result.token;
        const response = await fetch(`${API_URL}/translations`, {
            method: 'POST',
            body: JSON.stringify(settings), // Make sure 'settings' is an object that can be stringified
            headers: {
                'Authorization': 'Bearer ' + token,
                'Accept': 'application/json, application/xml, text/plain, text/html, */*',
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        translations = await response.json();
    } catch (error) {
        console.error('Error fetching translations:', error);
    }
    console.log(translations);
    return translations;
}

highlightWords();

