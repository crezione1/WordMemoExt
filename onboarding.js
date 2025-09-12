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
});

// Step navigation
function nextStep() {
    if (currentStep < totalSteps) {
        // Validate current step before proceeding
        if (currentStep === 3 && !selectedLevel) {
            alert('Please select your English level to continue.');
            return;
        }
        
        // Hide current step
        document.getElementById(`step${currentStep}`).classList.remove('active');
        
        // Show next step
        currentStep++;
        document.getElementById(`step${currentStep}`).classList.add('active');
        
        updateProgressBar();
    }
}

function prevStep() {
    if (currentStep > 1) {
        // Hide current step
        document.getElementById(`step${currentStep}`).classList.remove('active');
        
        // Show previous step
        currentStep--;
        document.getElementById(`step${currentStep}`).classList.add('active');
        
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

// Handle browser back/forward buttons
window.addEventListener('popstate', function(e) {
    // Prevent users from navigating away during onboarding
    history.pushState(null, null, location.href);
});

// Push initial state to prevent back button
history.pushState(null, null, location.href);