document.addEventListener("DOMContentLoaded", async function initializeOnboarding() {
    "use strict";

    const totalSteps = 5;
    const catalog = globalThis.LazyLexLanguageCatalog || [];
    const languageTools = globalThis.LazyLexLanguageTools;
    const urlStep = Number(new URLSearchParams(window.location.search).get("step"));

    const progressFill = document.getElementById("progressFill");
    const currentStepSpan = document.getElementById("currentStep");
    const totalStepsSpan = document.getElementById("totalSteps");
    const backBtn = document.getElementById("backBtn");
    const nextBtn = document.getElementById("nextBtn");
    const steps = Array.from(document.querySelectorAll(".step"));
    const goalOptions = Array.from(document.querySelectorAll(".goal-option"));
    const selectedNativeLanguageSpan = document.getElementById("selectedNativeLanguage");
    const selectedLearningLanguageSpan = document.getElementById("selectedLearningLanguage");
    const selectedGoalSpan = document.getElementById("selectedGoal");
    const finishOnboardingBtn = document.getElementById("finishOnboardingBtn");
    const openSettingsBtn = document.getElementById("openSettingsBtn");

    const storedState = await chrome.storage.local.get({
        onboardingDraft: null,
        language: null,
        learningLanguage: null,
        goal: null
    });
    const storedDraft = storedState.onboardingDraft || {};

    let currentStep = Number.isInteger(urlStep) && urlStep >= 1 && urlStep <= totalSteps
        ? urlStep
        : Math.min(Math.max(Number(storedDraft.currentStep) || 1, 1), totalSteps);
    let selectedNativeLanguage = storedDraft.nativeLanguage || storedState.language || null;
    let selectedLearningLanguage = storedDraft.learningLanguage || storedState.learningLanguage || null;
    let selectedGoal = storedDraft.goal || storedState.goal || null;

    // Interactive "How LazyLex Works" demo state (step 4).
    let demoState = {
        selectedWord: null,
        selectedWordElement: null,
        isAnimating: false,
        isCompleted: false
    };

    totalStepsSpan.textContent = String(totalSteps);

    function createLanguageSelector({
        inputId,
        gridId,
        emptyId,
        getSelection,
        setSelection
    }) {
        const input = document.getElementById(inputId);
        const grid = document.getElementById(gridId);
        const emptyState = document.getElementById(emptyId);

        function render(query = input.value) {
            const matches = languageTools.filterLanguages(query, catalog);
            const selectedLanguage = getSelection();
            grid.replaceChildren();
            emptyState.hidden = matches.length !== 0;

            matches.forEach((language) => {
                const option = document.createElement("button");
                const isSelected = selectedLanguage?.code === language.code;
                option.type = "button";
                option.className = "language-option";
                option.dataset.lang = language.code;
                option.dataset.name = language.name;
                option.setAttribute("role", "option");
                option.setAttribute("aria-selected", String(isSelected));
                option.classList.toggle("selected", isSelected);

                const flag = document.createElement("span");
                flag.className = "flag";
                flag.setAttribute("aria-hidden", "true");
                flag.textContent = languageTools.countryCodeToFlag(language.countryCode);

                const label = document.createElement("span");
                label.className = "language-label";

                const nativeName = document.createElement("span");
                nativeName.className = "lang-name";
                nativeName.textContent = language.nativeName;

                const secondaryName = document.createElement("span");
                secondaryName.className = "lang-secondary";
                secondaryName.textContent = `${language.name} · ${language.code}`;

                label.append(nativeName, secondaryName);
                option.append(flag, label);
                option.addEventListener("click", async () => {
                    setSelection({
                        code: language.code,
                        name: language.name,
                        nativeName: language.nativeName,
                        countryCode: language.countryCode
                    });
                    render();
                    await persistDraft();
                    updateNextButton();
                });
                grid.appendChild(option);
            });
        }

        input.addEventListener("input", () => render());
        grid.addEventListener("keydown", (event) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                return;
            }

            const options = Array.from(grid.querySelectorAll(".language-option"));
            if (options.length === 0) {
                return;
            }

            event.preventDefault();
            const currentIndex = options.indexOf(document.activeElement);
            let nextIndex = 0;
            if (event.key === "End") {
                nextIndex = options.length - 1;
            } else if (event.key === "ArrowDown") {
                nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % options.length;
            } else if (event.key === "ArrowUp") {
                nextIndex = currentIndex <= 0 ? options.length - 1 : currentIndex - 1;
            }
            options[nextIndex].focus();
        });

        render();
        return { input, render };
    }

    const nativeSelector = createLanguageSelector({
        inputId: "nativeLanguageSearch",
        gridId: "nativeLanguageGrid",
        emptyId: "nativeLanguageEmpty",
        getSelection: () => selectedNativeLanguage,
        setSelection: (language) => {
            selectedNativeLanguage = language;
        }
    });

    const learningSelector = createLanguageSelector({
        inputId: "learningLanguageSearch",
        gridId: "learningLanguageGrid",
        emptyId: "learningLanguageEmpty",
        getSelection: () => selectedLearningLanguage,
        setSelection: (language) => {
            selectedLearningLanguage = language;
        }
    });

    goalOptions.forEach((option) => {
        option.addEventListener("click", async function selectGoal() {
            selectedGoal = {
                type: option.dataset.goal,
                name: option.querySelector(".goal-title").textContent
            };
            goalOptions.forEach((goalOption) => {
                const isSelected = goalOption === option;
                goalOption.classList.toggle("selected", isSelected);
                goalOption.setAttribute("aria-pressed", String(isSelected));
            });
            await persistDraft();
            updateNextButton();
        });
    });

    async function persistDraft() {
        await chrome.storage.local.set({
            onboardingDraft: {
                currentStep,
                nativeLanguage: selectedNativeLanguage,
                learningLanguage: selectedLearningLanguage,
                goal: selectedGoal,
                updatedAt: Date.now()
            }
        });
    }

    function updateNextButton() {
        const requirements = {
            1: Boolean(selectedNativeLanguage),
            2: Boolean(selectedLearningLanguage),
            3: Boolean(selectedGoal),
            4: demoState.isCompleted
        };

        if (currentStep === totalSteps) {
            nextBtn.hidden = true;
            return;
        }

        nextBtn.hidden = false;
        nextBtn.disabled = !requirements[currentStep];
    }

    function updateSummary() {
        selectedNativeLanguageSpan.textContent = selectedNativeLanguage?.name || "Not selected";
        selectedLearningLanguageSpan.textContent = selectedLearningLanguage?.name || "Not selected";
        selectedGoalSpan.textContent = selectedGoal?.name || "Not selected";
    }

    function updateUI({ focusHeading = false } = {}) {
        progressFill.style.width = `${(currentStep / totalSteps) * 100}%`;
        currentStepSpan.textContent = String(currentStep);

        steps.forEach((step, index) => {
            const isActive = index + 1 === currentStep;
            step.classList.toggle("active", isActive);
            step.setAttribute("aria-hidden", String(!isActive));
        });

        backBtn.disabled = currentStep === 1;
        updateNextButton();
        updateSummary();

        goalOptions.forEach((goalOption) => {
            const isSelected = selectedGoal?.type === goalOption.dataset.goal;
            goalOption.classList.toggle("selected", isSelected);
            goalOption.setAttribute("aria-pressed", String(isSelected));
        });

        nativeSelector.render();
        learningSelector.render();

        if (focusHeading) {
            const heading = document.querySelector(`#step${currentStep} h2`);
            if (heading) {
                heading.tabIndex = -1;
                heading.focus();
            }
        }
    }

    async function goToStep(newStep) {
        if (currentStep === 4) {
            resetHowItWorksDemo();
        }
        currentStep = newStep;
        await persistDraft();
        updateUI({ focusHeading: true });
        if (currentStep === 4) {
            resetHowItWorksDemo();
        }
    }

    backBtn.addEventListener("click", async () => {
        if (currentStep <= 1) {
            return;
        }
        await goToStep(currentStep - 1);
    });

    nextBtn.addEventListener("click", async () => {
        if (currentStep >= totalSteps || nextBtn.disabled) {
            return;
        }
        await goToStep(currentStep + 1);
    });

    finishOnboardingBtn.addEventListener("click", async () => {
        const preferences = {
            onboardingCompleted: true,
            onboardingDraft: null,
            language: selectedNativeLanguage,
            nativeLanguage: selectedNativeLanguage,
            learningLanguage: selectedLearningLanguage,
            goal: selectedGoal,
            translateTo: selectedNativeLanguage?.code || "uk",
            animationToggle: "true",
            sentenceCounter: 1,
            completedAt: Date.now()
        };

        await chrome.storage.local.set(preferences);
        chrome.runtime.sendMessage({ action: "onboardingCompleted" });
        chrome.runtime.sendMessage({ action: "closeSelf" });
        window.close();
    });

    openSettingsBtn.addEventListener("click", async () => {
        currentStep = totalSteps;
        await persistDraft();
        const settingsUrl = chrome.runtime.getURL("options.html?from=onboarding");
        window.location.assign(settingsUrl);
    });

    // Interactive "How LazyLex Works" demo (step 4): a simulated browser
    // window where selecting a word and clicking the orange "+" button
    // flies the word to the toolbar extension icon and marks it saved.
    const howItWorksDemo = document.getElementById("howItWorksDemo");
    const addPopover = document.getElementById("addPopover");
    const addWordBtn = document.getElementById("addWordBtn");
    const extIcon = document.getElementById("extIcon");
    const animationOverlay = document.getElementById("animationOverlay");
    const demoCompletion = document.getElementById("demoCompletion");
    const demoInstructionText = howItWorksDemo?.querySelector(".instruction-text") || null;
    const demoSelectableWords = howItWorksDemo
        ? Array.from(howItWorksDemo.querySelectorAll(".selectable-word"))
        : [];

    function selectDemoWord(wordElement) {
        demoSelectableWords.forEach((word) => word.classList.remove("selected"));
        wordElement.classList.add("selected");
        demoState.selectedWord = wordElement.dataset.word;
        demoState.selectedWordElement = wordElement;

        showAddPopover(wordElement);

        if (demoInstructionText) {
            demoInstructionText.innerHTML = '<i class="fas fa-plus-circle" aria-hidden="true"></i> Now click the + button to save it!';
        }
    }

    function showAddPopover(wordElement) {
        if (!addPopover || !howItWorksDemo) {
            return;
        }
        const rect = wordElement.getBoundingClientRect();
        const demoRect = howItWorksDemo.getBoundingClientRect();

        addPopover.classList.add("visible");

        const popWidth = addPopover.offsetWidth || 24;
        const popHeight = addPopover.offsetHeight || 24;

        const left = rect.left - demoRect.left + (rect.width - popWidth) / 2;
        const top = rect.top - demoRect.top - popHeight - 8;

        addPopover.style.left = `${left}px`;
        addPopover.style.top = `${top}px`;
    }

    function hideAddPopover() {
        if (addPopover) {
            addPopover.classList.remove("visible");
        }
        demoSelectableWords.forEach((word) => word.classList.remove("selected"));
        demoState.selectedWord = null;
        demoState.selectedWordElement = null;
    }

    function animateWordToExtension() {
        if (!demoState.selectedWordElement || demoState.isAnimating || !extIcon || !animationOverlay) {
            return;
        }

        demoState.isAnimating = true;
        const wordElement = demoState.selectedWordElement;
        const wordText = demoState.selectedWord;
        hideAddPopover();

        const wordRect = wordElement.getBoundingClientRect();
        const iconRect = extIcon.getBoundingClientRect();
        const overlayRect = animationOverlay.getBoundingClientRect();

        const flyingClone = document.createElement("div");
        flyingClone.className = "flying-clone";
        flyingClone.textContent = wordText;

        const startX = wordRect.left - overlayRect.left;
        const startY = wordRect.top - overlayRect.top;
        const endX = iconRect.left - overlayRect.left + iconRect.width / 2;
        const endY = iconRect.top - overlayRect.top + iconRect.height / 2;

        flyingClone.style.left = `${startX}px`;
        flyingClone.style.top = `${startY}px`;
        flyingClone.style.transform = "translate(0, 0)";

        animationOverlay.appendChild(flyingClone);

        window.setTimeout(() => {
            flyingClone.style.transform = `translate(${endX - startX}px, ${endY - startY}px) scale(0.3)`;
            flyingClone.style.opacity = "0";
        }, 50);

        window.setTimeout(() => {
            flyingClone.remove();

            extIcon.classList.add("pulse");
            window.setTimeout(() => extIcon.classList.remove("pulse"), 600);

            wordElement.classList.remove("selected");
            wordElement.classList.add("saved");

            completeHowItWorksDemo();
            demoState.isAnimating = false;
        }, 1000);
    }

    function completeHowItWorksDemo() {
        if (demoState.isCompleted) {
            return;
        }
        demoState.isCompleted = true;

        if (demoCompletion) {
            demoCompletion.hidden = false;
        }
        if (demoInstructionText) {
            demoInstructionText.style.display = "none";
        }

        updateNextButton();
    }

    function resetHowItWorksDemo() {
        if (!howItWorksDemo) {
            return;
        }

        demoState = {
            selectedWord: null,
            selectedWordElement: null,
            isAnimating: false,
            isCompleted: false
        };

        demoSelectableWords.forEach((word) => word.classList.remove("selected", "saved"));
        hideAddPopover();
        if (animationOverlay) {
            animationOverlay.replaceChildren();
        }
        if (extIcon) {
            extIcon.classList.remove("pulse");
        }
        if (demoCompletion) {
            demoCompletion.hidden = true;
        }
        if (demoInstructionText) {
            demoInstructionText.style.display = "";
            demoInstructionText.innerHTML = '<i class="fas fa-hand-pointer" aria-hidden="true"></i> Click on any highlighted word above to try it!';
        }

        updateNextButton();
    }

    demoSelectableWords.forEach((word) => {
        word.addEventListener("click", () => {
            if (demoState.isAnimating || word.classList.contains("saved")) {
                return;
            }
            selectDemoWord(word);
        });
    });

    if (addWordBtn) {
        addWordBtn.addEventListener("click", () => {
            if (demoState.selectedWordElement && !demoState.isAnimating) {
                animateWordToExtension();
            }
        });
    }

    document.addEventListener("click", (event) => {
        if (!event.target.closest(".selectable-word") && !event.target.closest(".add-popover")) {
            hideAddPopover();
        }
    });

    document.addEventListener("keydown", (event) => {
        const isTyping = event.target instanceof HTMLInputElement
            || event.target instanceof HTMLTextAreaElement;
        if (isTyping) {
            return;
        }

        if (event.key === "ArrowRight" && !nextBtn.disabled && !nextBtn.hidden) {
            nextBtn.click();
        } else if (event.key === "ArrowLeft" && !backBtn.disabled) {
            backBtn.click();
        }
    });

    updateUI();
});
