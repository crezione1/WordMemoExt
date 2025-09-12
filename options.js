
// Color management
let selectedHighlightColor = 'rgba(255, 0, 0, 0.22)';
let selectedTranslationColor = '#d0d0d0';

// DOM elements
let highlightingToggle, highlightingOptions, customHighlightColor, customTranslationColor;
let previewHighlight, previewTranslation;

function showNotification() {
    const notification = document.getElementById('notification');
    notification.classList.add('show');

    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

function updatePreview() {
    if (previewHighlight && previewTranslation) {
        previewHighlight.style.backgroundColor = selectedHighlightColor;
        previewTranslation.style.color = selectedTranslationColor;
    }
}

function handleColorSelection(container, colorType) {
    container.addEventListener('click', (e) => {
        if (e.target.classList.contains('color-option')) {
            // Remove selected class from siblings
            container.querySelectorAll('.color-option').forEach(option => {
                option.classList.remove('selected');
            });

            // Add selected class to clicked option
            e.target.classList.add('selected');

            // Update the selected color
            const color = e.target.dataset.color;
            if (colorType === 'highlight') {
                selectedHighlightColor = color;
            } else if (colorType === 'translation') {
                selectedTranslationColor = color;
            }

            updatePreview();
        }
    });
}

function handleCustomColorChange(inputElement, colorType) {
    inputElement.addEventListener('change', (e) => {
        const color = e.target.value;
        let rgbaColor;

        if (colorType === 'highlight') {
            // Convert hex to rgba with transparency for highlight
            const r = parseInt(color.substr(1, 2), 16);
            const g = parseInt(color.substr(3, 2), 16);
            const b = parseInt(color.substr(5, 2), 16);
            rgbaColor = `rgba(${r}, ${g}, ${b}, 0.22)`;
            selectedHighlightColor = rgbaColor;
        } else {
            selectedTranslationColor = color;
        }

        // Remove selected class from preset colors
        const container = inputElement.parentElement;
        container.querySelectorAll('.color-option').forEach(option => {
            option.classList.remove('selected');
        });

        updatePreview();
    });
}

function toggleHighlightingOptions() {
    const isEnabled = highlightingToggle.checked;
    highlightingOptions.style.display = isEnabled ? 'block' : 'none';
}

// Function to save the settings
function saveSettings() {
    const translateTo = document.getElementById('translateTo').value;
    const animationToggle = document.getElementById('animationToggle').checked;
    const sentenceCounterElement = document.getElementById('sentenceCounter');
    const sentenceCounter = sentenceCounterElement ? sentenceCounterElement.value : '1';
    const highlightingEnabled = document.getElementById('highlightingToggle').checked;

    chrome.storage.local.set({
        translateTo: translateTo,
        animationToggle: animationToggle.toString(),
        sentenceCounter: sentenceCounter,
        highlightingEnabled: highlightingEnabled,
        highlightColor: selectedHighlightColor,
        translationColor: selectedTranslationColor
    }, function () {
        showNotification();

        // Notify content scripts about the changes
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'settingsChanged',
                        settings: {
                            highlightingEnabled,
                            highlightColor: selectedHighlightColor,
                            translationColor: selectedTranslationColor,
                            translateTo: translateTo,
                            animationToggle: animationToggle
                        }
                    }).catch(() => {
                        // Ignore errors for tabs that don't have content scripts
                    });
                }
            });
        });
    });
}

// Function to load the settings when the options page is opened
function loadSettings() {
    chrome.storage.local.get([
        'translateTo',
        'animationToggle',
        'sentenceCounter',
        'highlightingEnabled',
        'highlightColor',
        'translationColor'
    ], function (items) {
        // Load basic settings
        if (items.translateTo) {
            document.getElementById('translateTo').value = items.translateTo;
        }

        if (items.animationToggle !== undefined) {
            document.getElementById('animationToggle').checked = items.animationToggle === 'true';
        }

        const sentenceCounterElement = document.getElementById('sentenceCounter');
        if (items.sentenceCounter && sentenceCounterElement) {
            sentenceCounterElement.value = items.sentenceCounter;
        }

        // Load highlighting settings
        const highlightingEnabled = items.highlightingEnabled !== undefined ? items.highlightingEnabled : true;
        document.getElementById('highlightingToggle').checked = highlightingEnabled;

        // Load colors
        selectedHighlightColor = items.highlightColor || 'rgba(255, 0, 0, 0.22)';
        selectedTranslationColor = items.translationColor || '#d0d0d0';

        // Update UI to reflect loaded colors
        updateColorSelection();
        updatePreview();
        toggleHighlightingOptions();
    });
}

function updateColorSelection() {
    // Update highlight color selection
    document.querySelectorAll('[data-color]').forEach(option => {
        option.classList.remove('selected');
        if (option.dataset.color === selectedHighlightColor && !option.dataset.type) {
            option.classList.add('selected');
        }
        if (option.dataset.color === selectedTranslationColor && option.dataset.type === 'translation') {
            option.classList.add('selected');
        }
    });
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Get DOM elements
    highlightingToggle = document.getElementById('highlightingToggle');
    highlightingOptions = document.getElementById('highlightingOptions');
    customHighlightColor = document.getElementById('customHighlightColor');
    customTranslationColor = document.getElementById('customTranslationColor');
    previewHighlight = document.getElementById('previewHighlight');
    previewTranslation = document.getElementById('previewTranslation');

    // Event listeners
    document.getElementById('save').addEventListener('click', saveSettings);
    highlightingToggle.addEventListener('change', toggleHighlightingOptions);

    // Color picker event listeners
    const highlightColorContainer = customHighlightColor.parentElement;
    const translationColorContainer = customTranslationColor.parentElement;

    handleColorSelection(highlightColorContainer, 'highlight');
    handleColorSelection(translationColorContainer, 'translation');
    handleCustomColorChange(customHighlightColor, 'highlight');
    handleCustomColorChange(customTranslationColor, 'translation');

    // Import/Export event listeners
    document.getElementById('exportWordsBtn').addEventListener('click', handleExportWords);
    document.getElementById('importWordsBtn').addEventListener('click', () => {
        document.getElementById('importFileInput').click();
    });
    document.getElementById('importFileInput').addEventListener('change', handleImportWords);

    // Load settings on page load
    loadSettings();
});

// Import/Export functionality
async function handleExportWords() {
    try {
        const { words } = await chrome.storage.local.get(["words"]);
        
        if (!words || words.length === 0) {
            showNotificationWithMessage("No words to export", "warning");
            return;
        }

        const exportContent = await window.wordIOManager.exportWords(words, 'txt');
        const filename = window.wordIOManager.generateFilename('wordmemo-words', 'txt');
        
        window.wordIOManager.downloadFile(exportContent, filename, 'text/plain');
        
        showNotificationWithMessage(`Successfully exported ${words.length} words to ${filename}`, "success");
    } catch (error) {
        console.error('Export error:', error);
        showNotificationWithMessage(`Export failed: ${error.message}`, "error");
    }
}

async function handleImportWords(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const content = await readFileContent(file);
        const importedWords = await window.wordIOManager.importWords(content, 'txt');
        
        if (importedWords.length === 0) {
            showNotificationWithMessage("No valid words found in the file", "warning");
            return;
        }

        // Get existing words to avoid duplicates
        const { words: existingWords = [] } = await chrome.storage.local.get(["words"]);
        const existingWordTexts = new Set(existingWords.map(w => w.word.toLowerCase()));
        
        // Filter out duplicates
        const newWords = importedWords.filter(word => 
            !existingWordTexts.has(word.word.toLowerCase())
        );
        
        if (newWords.length === 0) {
            showNotificationWithMessage("All words already exist in your dictionary", "warning");
            return;
        }

        // Merge with existing words
        const updatedWords = [...existingWords, ...newWords];
        await chrome.storage.local.set({ words: updatedWords });
        
        showNotificationWithMessage(`Successfully imported ${newWords.length} new words (${importedWords.length - newWords.length} duplicates skipped)`, "success");
        
    } catch (error) {
        console.error('Import error:', error);
        showNotificationWithMessage(`Import failed: ${error.message}`, "error");
    } finally {
        // Clear the file input
        event.target.value = '';
    }
}

function readFileContent(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
}

function showNotificationWithMessage(message, type = "info") {
    console.log(`${type.toUpperCase()}: ${message}`);
    
    // Update the existing notification element
    const notification = document.getElementById('notification');
    if (notification) {
        notification.textContent = message;
        notification.classList.add('show');
        
        // Auto-hide after 4 seconds
        setTimeout(() => {
            notification.classList.remove('show');
        }, 4000);
    }
}
