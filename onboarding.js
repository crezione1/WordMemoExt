// Onboarding flow management
let currentStep = 1;
const totalSteps = 5;
let selectedLevel = null;

// Default word lists for different levels
const defaultWords = {
    beginner: [
        { word: 'hello', translation: 'привіт' },
        { word: 'house', translation: 'будинок' },
        { word: 'water', translation: 'вода' },
        { word: 'food', translation: 'їжа' },
        { word: 'time', translation: 'час' },
        { word: 'people', translation: 'люди' },
        { word: 'good', translation: 'добрий' },
        { word: 'work', translation: 'робота' },
        { word: 'come', translation: 'приходити' },
        { word: 'friend', translation: 'друг' }
    ],
    intermediate: [
        { word: 'important', translation: 'важливий' },
        { word: 'business', translation: 'бізнес' },
        { word: 'opportunity', translation: 'можливість' },
        { word: 'experience', translation: 'досвід' },
        { word: 'development', translation: 'розвиток' },
        { word: 'knowledge', translation: 'знання' },
        { word: 'relationship', translation: 'відносини' },
        { word: 'environment', translation: 'навколишнє середовище' },
        { word: 'technology', translation: 'технологія' },
        { word: 'communication', translation: 'спілкування' }
    ],
    advanced: [
        { word: 'sophisticated', translation: 'складний' },
        { word: 'phenomenon', translation: 'явище' },
        { word: 'tremendous', translation: 'величезний' },
        { word: 'ambiguous', translation: 'двозначний' },
        { word: 'substantial', translation: 'значний' },
        { word: 'comprehensive', translation: 'всебічний' },
        { word: 'inevitable', translation: 'неминучий' },
        { word: 'paradigm', translation: 'парадигма' },
        { word: 'arbitrary', translation: 'довільний' },
        { word: 'prevalent', translation: 'поширений' }
    ]
};

// Initialize onboarding
document.addEventListener('DOMContentLoaded', function() {
    // Add event listeners for all buttons
    document.getElementById('step1NextBtn').addEventListener('click', nextStep);
    document.getElementById('step2BackBtn').addEventListener('click', prevStep);
    document.getElementById('step2NextBtn').addEventListener('click', nextStep);
    document.getElementById('step3BackBtn').addEventListener('click', prevStep);
    document.getElementById('levelNextBtn').addEventListener('click', nextStep);
    document.getElementById('step4BackBtn').addEventListener('click', prevStep);
    document.getElementById('step4NextBtn').addEventListener('click', nextStep);
    document.getElementById('completeBtn').addEventListener('click', completeOnboarding);
    
    updateProgressBar();
    setupLevelSelection();
    setupMinimalisticToggle();
    setupHowItWorksDemo();
});

// Step navigation
function nextStep() {
    if (currentStep < totalSteps) {
        // Validate current step before proceeding
        if (currentStep === 3 && !selectedLevel) {
            alert('Please select your English level to continue.');
            return;
        }
        
        // Reset demo when leaving Step 2
        if (currentStep === 2) {
            resetHowItWorksDemo();
        }
        
        // Hide current step
        document.getElementById(`step${currentStep}`).classList.remove('active');
        
        // Show next step
        currentStep++;
        document.getElementById(`step${currentStep}`).classList.add('active');
        
        // Reset demo when entering Step 2
        if (currentStep === 2) {
            setTimeout(() => resetHowItWorksDemo(), 100);
        }
        
        updateProgressBar();
    }
}

function prevStep() {
    if (currentStep > 1) {
        // Reset demo when leaving Step 2
        if (currentStep === 2) {
            resetHowItWorksDemo();
        }
        
        // Hide current step
        document.getElementById(`step${currentStep}`).classList.remove('active');
        
        // Show previous step
        currentStep--;
        document.getElementById(`step${currentStep}`).classList.add('active');
        
        // Reset demo when entering Step 2
        if (currentStep === 2) {
            setTimeout(() => resetHowItWorksDemo(), 100);
        }
        
        updateProgressBar();
    }
}

function updateProgressBar() {
    const progress = (currentStep / totalSteps) * 100;
    document.getElementById('progressBar').style.width = progress + '%';
    updateBreadcrumbs();
}

function updateBreadcrumbs() {
    const breadcrumbSteps = document.querySelectorAll('.breadcrumb-step');
    const breadcrumbDividers = document.querySelectorAll('.breadcrumb-divider');
    
    breadcrumbSteps.forEach((step, index) => {
        const stepNumber = index + 1;
        
        // Remove existing classes
        step.classList.remove('active', 'completed');
        
        if (stepNumber < currentStep) {
            // Completed steps
            step.classList.add('completed');
        } else if (stepNumber === currentStep) {
            // Current active step
            step.classList.add('active');
        }
    });
    
    // Update dividers
    breadcrumbDividers.forEach((divider, index) => {
        divider.classList.remove('completed');
        if (index + 1 < currentStep) {
            divider.classList.add('completed');
        }
    });
}

// Level selection setup
function setupLevelSelection() {
    const levelCards = document.querySelectorAll('.level-card');
    const nextBtn = document.getElementById('levelNextBtn');
    
    levelCards.forEach(card => {
        card.addEventListener('click', function() {
            // Remove selected class from all cards
            levelCards.forEach(c => c.classList.remove('selected'));
            
            // Add selected class to clicked card
            this.classList.add('selected');
            
            // Store selected level
            selectedLevel = this.dataset.level;
            
            // Enable next button
            nextBtn.disabled = false;
            nextBtn.style.opacity = '1';
        });
    });
}

// Minimalistic mode toggle
function setupMinimalisticToggle() {
    const checkbox = document.getElementById('minimalisticMode');
    const preview = document.getElementById('stylePreview');
    
    checkbox.addEventListener('change', function() {
        if (this.checked) {
            preview.classList.add('minimalistic');
        } else {
            preview.classList.remove('minimalistic');
        }
    });
}

// Complete onboarding
async function completeOnboarding() {
    try {
        const minimalisticMode = document.getElementById('minimalisticMode').checked;
        
        // Save onboarding completion and preferences
        const settings = {
            onboardingCompleted: true,
            selectedLevel: selectedLevel,
            minimalisticMode: minimalisticMode,
            completedAt: new Date().toISOString()
        };
        
        await chrome.storage.local.set(settings);
        
        // Add default words based on selected level
        if (selectedLevel && selectedLevel !== 'none' && defaultWords[selectedLevel]) {
            await addDefaultWords(selectedLevel);
        }
        
        // Apply minimalistic mode settings if enabled
        if (minimalisticMode) {
            await applyMinimalisticSettings();
        }
        
        console.log('Onboarding completed successfully!', settings);
        
        // Small delay to ensure all storage operations are fully committed
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Notify that onboarding is completed and ask background to close this tab
        chrome.runtime.sendMessage({ action: 'onboardingCompleted' });
        chrome.runtime.sendMessage({ action: 'closeSelf' });
        
    } catch (error) {
        console.error('Error completing onboarding:', error);
        alert('There was an error saving your settings. Please try again.');
    }
}

// Add default words to storage
async function addDefaultWords(level) {
    try {
        // Get existing words from storage
        const result = await chrome.storage.local.get(['words']);
        const existingWords = result.words || [];
        
        // Generate new words with proper IDs
        let currentId = Date.now();
        const wordsToAdd = defaultWords[level].map(wordData => ({
            id: currentId++,
            word: wordData.word,
            translation: wordData.translation,
            status: 'new',
            imported: false,
            isDefault: true,
            level: level,
            dateAdded: Date.now(),
            createdAt: new Date().toISOString(),
            addedDuringOnboarding: true
        }));
        
        // Check for duplicates (case-insensitive)
        const existingWordTexts = new Set(
            existingWords.map(w => w.word.toLowerCase())
        );
        
        const newWords = wordsToAdd.filter(word => 
            !existingWordTexts.has(word.word.toLowerCase())
        );
        
        // Merge with existing words
        const updatedWords = [...existingWords, ...newWords];
        
        // Save to storage
        await chrome.storage.local.set({ words: updatedWords });
        
        console.log(`Added ${newWords.length} default words for ${level} level`);
        
    } catch (error) {
        console.error('Error adding default words:', error);
    }
}

// Apply minimalistic mode settings
async function applyMinimalisticSettings() {
    try {
        const minimalisticSettings = {
            // Disable animations
            animationToggle: false,
            
            // Set grey translation color  
            translationColor: '#999999',
            
            // Disable word highlighting
            highlightingEnabled: false,
            
            // Save minimalistic preference
            minimalisticMode: true
        };
        
        await chrome.storage.local.set(minimalisticSettings);
        console.log('Applied minimalistic mode settings');
        
    } catch (error) {
        console.error('Error applying minimalistic settings:', error);
    }
}

// Interactive Demo State
let demoState = {
    selectedWord: null,
    selectedWordElement: null,
    isAnimating: false,
    isCompleted: false
};

// Setup How It Works Interactive Demo
function setupHowItWorksDemo() {
    const selectableWords = document.querySelectorAll('.selectable-word');
    const addPopover = document.getElementById('addPopover');
    const addWordBtn = document.getElementById('addWordBtn');
    
    // Add click listeners to selectable words
    selectableWords.forEach(word => {
        word.addEventListener('click', function(e) {
            if (demoState.isAnimating || word.classList.contains('saved')) {
                return;
            }
            
            selectWord(word, e);
        });
    });
    
    // Add click listener to Add button
    addWordBtn.addEventListener('click', function() {
        if (demoState.selectedWordElement && !demoState.isAnimating) {
            animateWordToExtension();
        }
    });
    
    // Hide popover when clicking outside
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.selectable-word') && !e.target.closest('.add-popover')) {
            hideAddPopover();
        }
    });
}

function selectWord(wordElement, event) {
    // Remove previous selections
    document.querySelectorAll('.selectable-word.selected').forEach(word => {
        word.classList.remove('selected');
    });
    
    // Select the clicked word
    wordElement.classList.add('selected');
    demoState.selectedWord = wordElement.dataset.word;
    demoState.selectedWordElement = wordElement;
    
    // Show the Add popover near the word
    showAddPopover(wordElement);
    
    // Update instruction text
    const instructionText = document.querySelector('.instruction-text');
    instructionText.innerHTML = '<i class="fas fa-plus-circle"></i> Now click "Add Word" to save it!';
}

function showAddPopover(wordElement) {
    const addPopover = document.getElementById('addPopover');
    const rect = wordElement.getBoundingClientRect();
    const demoRect = document.getElementById('howitworksDemo').getBoundingClientRect();
    
    // Position popover above the word
    const left = rect.left - demoRect.left + (rect.width / 2) - 50; // Center the popover
    const top = rect.top - demoRect.top - 45; // Position above the word
    
    addPopover.style.left = left + 'px';
    addPopover.style.top = top + 'px';
    addPopover.classList.add('visible');
}

function hideAddPopover() {
    const addPopover = document.getElementById('addPopover');
    addPopover.classList.remove('visible');
    
    // Remove selection from words
    document.querySelectorAll('.selectable-word.selected').forEach(word => {
        word.classList.remove('selected');
    });
    
    demoState.selectedWord = null;
    demoState.selectedWordElement = null;
}

function animateWordToExtension() {
    if (!demoState.selectedWordElement || demoState.isAnimating) {
        return;
    }
    
    demoState.isAnimating = true;
    hideAddPopover();
    
    const wordElement = demoState.selectedWordElement;
    const extIcon = document.getElementById('extIcon');
    const animationOverlay = document.getElementById('animationOverlay');
    
    // Get positions
    const wordRect = wordElement.getBoundingClientRect();
    const iconRect = extIcon.getBoundingClientRect();
    const overlayRect = animationOverlay.getBoundingClientRect();
    
    // Create flying clone
    const flyingClone = document.createElement('div');
    flyingClone.classList.add('flying-clone');
    flyingClone.textContent = demoState.selectedWord;
    
    // Set initial position (relative to overlay)
    const startX = wordRect.left - overlayRect.left;
    const startY = wordRect.top - overlayRect.top;
    const endX = iconRect.left - overlayRect.left + (iconRect.width / 2);
    const endY = iconRect.top - overlayRect.top + (iconRect.height / 2);
    
    flyingClone.style.left = startX + 'px';
    flyingClone.style.top = startY + 'px';
    flyingClone.style.transform = `translate(0, 0)`;
    
    animationOverlay.appendChild(flyingClone);
    
    // Animate to extension icon
    setTimeout(() => {
        flyingClone.style.transform = `translate(${endX - startX}px, ${endY - startY}px) scale(0.3)`;
        flyingClone.style.opacity = '0';
    }, 50);
    
    // Complete animation after delay
    setTimeout(() => {
        // Remove flying clone
        flyingClone.remove();
        
        // Pulse the extension icon
        extIcon.classList.add('pulse');
        setTimeout(() => extIcon.classList.remove('pulse'), 600);
        
        // Mark word as saved and show translation
        wordElement.classList.remove('selected');
        wordElement.classList.add('saved');
        
        // Complete the demo
        completeDemoStep();
        
        demoState.isAnimating = false;
        
    }, 1000);
}

function completeDemoStep() {
    if (demoState.isCompleted) return;
    
    demoState.isCompleted = true;
    
    // Show completion message
    const demoCompletion = document.getElementById('demoCompletion');
    const instructionText = document.querySelector('.instruction-text');
    
    demoCompletion.style.display = 'block';
    instructionText.style.display = 'none';
    
    // Enable Continue button
    const nextBtn = document.getElementById('step2NextBtn');
    nextBtn.disabled = false;
    nextBtn.style.opacity = '1';
    nextBtn.textContent = 'Continue';
}

function resetHowItWorksDemo() {
    // Return early if elements don't exist (not on Step 2)
    const nextBtn = document.getElementById('step2NextBtn');
    if (!nextBtn) return;
    
    // Reset demo state
    demoState = {
        selectedWord: null,
        selectedWordElement: null,
        isAnimating: false,
        isCompleted: false
    };
    
    // Clear all word states
    document.querySelectorAll('.selectable-word').forEach(word => {
        word.classList.remove('selected', 'saved');
    });
    
    // Hide and cleanup popover
    hideAddPopover();
    const addPopover = document.getElementById('addPopover');
    if (addPopover) {
        addPopover.classList.remove('visible');
        addPopover.style.display = 'none';
    }
    
    // Remove any flying clones and clear animations
    document.querySelectorAll('.flying-clone').forEach(clone => clone.remove());
    
    // Remove pulse effect from extension icon
    const extIcon = document.getElementById('extIcon');
    if (extIcon) {
        extIcon.classList.remove('pulse');
    }
    
    // Clear animation overlay
    const animationOverlay = document.getElementById('animationOverlay');
    if (animationOverlay) {
        animationOverlay.innerHTML = '';
    }
    
    // Reset completion message and instruction text
    const demoCompletion = document.getElementById('demoCompletion');
    const instructionText = document.querySelector('.instruction-text');
    
    if (demoCompletion) demoCompletion.style.display = 'none';
    if (instructionText) {
        instructionText.style.display = 'block';
        instructionText.innerHTML = '<i class="fas fa-hand-pointer"></i> Click on any highlighted word above to try it!';
    }
    
    // Always disable and reset Continue button
    nextBtn.disabled = true;
    nextBtn.style.opacity = '0.5';
    nextBtn.textContent = 'Try the Demo Above';
}

// Handle browser back/forward buttons
window.addEventListener('popstate', function(e) {
    // Prevent users from navigating away during onboarding
    history.pushState(null, null, location.href);
});

// Push initial state to prevent back button
history.pushState(null, null, location.href);