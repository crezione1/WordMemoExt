// Function to save the settings
function saveSettings() {
    const translateTo = document.getElementById('translateTo').value;
    const animationToggle = document.getElementById('animationToggle').value;
    const sentenceCounter = document.getElementById('sentenceCounter').value;

    chrome.storage.local.set({
        'translateTo': translateTo,
        'animationToggle': animationToggle,
        'sentenceCounter': sentenceCounter
    }, function() {
        const savedMessage = document.getElementById('savedMessage');
        savedMessage.style.display = 'inline';

        // Hide the "Saved" message after the animation completes
        setTimeout(() => {
            savedMessage.style.display = 'none';
        }, 3000); // Match this duration with the animation-duration in the CSS
    });
}

// Function to load the settings when the options page is opened
function loadSettings() {
    chrome.storage.local.get(['translateTo', 'animationToggle', 'sentenceCounter'], function(items) {
        if (items.translateTo) {
            document.getElementById('translateTo').value = items.translateTo;
        }
        if (items.animationToggle) {
            document.getElementById('animationToggle').value = items.animationToggle;
        }
        if (items.sentenceCounter) {
            document.getElementById('sentenceCounter').value = items.sentenceCounter;
        }
    });
}

// Event listener for the save button
document.getElementById('save').addEventListener('click', saveSettings);

// Load settings when the options page is loaded
document.addEventListener('DOMContentLoaded', loadSettings);
