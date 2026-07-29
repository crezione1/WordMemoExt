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
            4: true
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

    backBtn.addEventListener("click", async () => {
        if (currentStep <= 1) {
            return;
        }
        currentStep -= 1;
        await persistDraft();
        updateUI({ focusHeading: true });
    });

    nextBtn.addEventListener("click", async () => {
        if (currentStep >= totalSteps || nextBtn.disabled) {
            return;
        }
        currentStep += 1;
        await persistDraft();
        updateUI({ focusHeading: true });
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

    const selectableWord = document.querySelector(".selectable-word");
    if (selectableWord) {
        selectableWord.addEventListener("click", function runExistingDemo() {
            selectableWord.style.background = "rgba(255, 107, 53, 0.6)";
            selectableWord.style.transform = "scale(1.05)";

            const existingButton = selectableWord.querySelector(".demo-add-button");
            if (existingButton) {
                existingButton.remove();
            }

            const demoButton = document.createElement("span");
            demoButton.className = "demo-add-button";
            demoButton.textContent = "+";
            selectableWord.style.position = "relative";
            selectableWord.appendChild(demoButton);

            window.setTimeout(() => {
                demoButton.remove();
                selectableWord.style.background = "rgba(255, 157, 123, 0.3)";
                selectableWord.style.transform = "scale(1)";
            }, 3000);
        });
    }

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
