// Onboarding JavaScript

document.addEventListener('DOMContentLoaded', function() {
    let currentStep = 1;
    const totalSteps = 4;
    let selectedLanguage = null;
    let selectedGoal = null;

    // DOM Elements
    const progressFill = document.getElementById('progressFill');
    const currentStepSpan = document.getElementById('currentStep');
    const backBtn = document.getElementById('backBtn');
    const nextBtn = document.getElementById('nextBtn');
    const steps = document.querySelectorAll('.step');
    
    // Language and goal options
    const languageOptions = document.querySelectorAll('.language-option');
    const goalOptions = document.querySelectorAll('.goal-option');
    
    // Final step elements
    const selectedLanguageSpan = document.getElementById('selectedLanguage');
    const selectedGoalSpan = document.getElementById('selectedGoal');
    const finishOnboardingBtn = document.getElementById('finishOnboardingBtn');
    const openSettingsBtn = document.getElementById('openSettingsBtn');

    // Initialize
    updateUI();

    // Language selection handlers
    languageOptions.forEach(option => {
        option.addEventListener('click', function() {
            // Remove previous selection
            languageOptions.forEach(opt => opt.classList.remove('selected'));
            
            // Add selection to clicked option
            this.classList.add('selected');
            selectedLanguage = {
                code: this.dataset.lang,
                name: this.dataset.name
            };
            
            // Enable next button
            updateNextButton();
        });
    });

    // Goal selection handlers
    goalOptions.forEach(option => {
        option.addEventListener('click', function() {
            // Remove previous selection
            goalOptions.forEach(opt => opt.classList.remove('selected'));
            
            // Add selection to clicked option
            this.classList.add('selected');
            selectedGoal = {
                type: this.dataset.goal,
                name: this.querySelector('.goal-title').textContent
            };
            
            // Enable next button
            updateNextButton();
        });
    });

    // Navigation handlers
    backBtn.addEventListener('click', function() {
        if (currentStep > 1) {
            currentStep--;
            updateUI();
        }
    });

    nextBtn.addEventListener('click', function() {
        if (currentStep < totalSteps) {
            currentStep++;
            updateUI();
        }
    });

    // Final step handlers
    finishOnboardingBtn.addEventListener('click', function() {
        completeOnboarding();
    });

    openSettingsBtn.addEventListener('click', function() {
        completeOnboarding(true);
    });

    // Demo word selection (Step 3)
    const selectableWord = document.querySelector('.selectable-word');
    if (selectableWord) {
        selectableWord.addEventListener('click', function() {
            this.style.background = 'rgba(255, 107, 53, 0.6)';
            this.style.transform = 'scale(1.05)';
            
            // Create a mini demo button
            const demoButton = document.createElement('span');
            demoButton.textContent = '+';
            demoButton.style.cssText = `
                position: absolute;
                top: -8px;
                right: -8px;
                width: 16px;
                height: 16px;
                background: #ff6b35;
                color: white;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
                font-weight: bold;
                cursor: pointer;
                animation: pulse 1s infinite;
            `;
            
            this.style.position = 'relative';
            this.appendChild(demoButton);
            
            // Add pulse animation
            const style = document.createElement('style');
            style.textContent = `
                @keyframes pulse {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                    100% { transform: scale(1); }
                }
            `;
            document.head.appendChild(style);
            
            // Remove demo button after 3 seconds
            setTimeout(() => {
                if (demoButton.parentNode) {
                    demoButton.remove();
                }
                this.style.background = 'rgba(255, 157, 123, 0.3)';
                this.style.transform = 'scale(1)';
            }, 3000);
        });
    }

    // Update UI based on current step
    function updateUI() {
        // Update progress bar
        const progressPercent = (currentStep / totalSteps) * 100;
        progressFill.style.width = progressPercent + '%';
        currentStepSpan.textContent = currentStep;

        // Show/hide steps
        steps.forEach((step, index) => {
            step.classList.toggle('active', index + 1 === currentStep);
        });

        // Update navigation buttons
        backBtn.disabled = currentStep === 1;
        
        // Update next button based on step requirements
        updateNextButton();

        // Update final step summary
        if (currentStep === 4) {
            if (selectedLanguage) {
                selectedLanguageSpan.textContent = selectedLanguage.name;
            }
            if (selectedGoal) {
                selectedGoalSpan.textContent = selectedGoal.name;
            }
        }
    }

    function updateNextButton() {
        let canProceed = true;
        
        switch (currentStep) {
            case 1:
                canProceed = selectedLanguage !== null;
                break;
            case 2:
                canProceed = selectedGoal !== null;
                break;
            case 3:
                canProceed = true; // Always can proceed from demo
                break;
            case 4:
                nextBtn.style.display = 'none'; // Hide next button on final step
                return;
        }
        
        nextBtn.style.display = 'block';
        nextBtn.disabled = !canProceed;
        nextBtn.style.opacity = canProceed ? '1' : '0.5';
    }

    function completeOnboarding(openSettings = false) {
        // Save user preferences
        const preferences = {
            onboardingCompleted: true,
            language: selectedLanguage,
            goal: selectedGoal,
            completedAt: Date.now()
        };

        chrome.storage.local.set(preferences, function() {
            console.log('Onboarding completed with preferences:', preferences);
            
            // Also save to the extension's settings format
            chrome.storage.local.set({
                'translateTo': selectedLanguage?.code || 'UK',
                'animationToggle': 'true',
                'sentenceCounter': 1
            });

            if (openSettings) {
                // Open settings page
                chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
            }
            
            // Close onboarding
            window.close();
        });
    }

    // Keyboard navigation
    document.addEventListener('keydown', function(e) {
        if (e.key === 'ArrowRight' || e.key === 'Enter') {
            if (!nextBtn.disabled && nextBtn.style.display !== 'none') {
                nextBtn.click();
            }
        } else if (e.key === 'ArrowLeft') {
            if (!backBtn.disabled) {
                backBtn.click();
            }
        }
    });

    // Auto-advance on selections (optional UX improvement)
    languageOptions.forEach(option => {
        option.addEventListener('click', function() {
            setTimeout(() => {
                if (currentStep === 1 && selectedLanguage) {
                    nextBtn.click();
                }
            }, 800);
        });
    });

    goalOptions.forEach(option => {
        option.addEventListener('click', function() {
            setTimeout(() => {
                if (currentStep === 2 && selectedGoal) {
                    nextBtn.click();
                }
            }, 800);
        });
    });
});
