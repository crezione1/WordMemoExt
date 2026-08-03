// Hostile-fixture probe (#52)
//
// Loaded by every fixture page. It drives each LazyLex control the way a user
// actually does -- across a full mousedown -> mouseup -> click gesture, which
// is the sequence #55 proved matters -- reads the *computed* style of each
// control out of the shadow root, and POSTs the result back to the harness
// (run-chrome-style-check.mjs), which asserts that every fixture produced
// identical numbers.
//
// Computed style is the only honest measure here: it is what the browser
// actually resolved after the fixture's hostile CSS had its say.

const FIXTURES = [
    "baseline.html",
    "unset.html",
    "reshape.html",
    "big-root.html",
    "reset.html"
];

// Read for every control. Between them these cover each symptom named in the
// issue: shape (border-radius), size (width/height/padding/box-sizing),
// glyph colour and centring (color/display/align-items/justify-content),
// affordance (cursor), and the inherited typography the old stylesheet never
// declared at all (font-*, line-height, letter-spacing, text-transform).
const PROBED_PROPERTIES = [
    "width",
    "height",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "border-top-width",
    "border-top-style",
    "border-top-color",
    "border-radius",
    "box-sizing",
    "background-color",
    "background-image",
    "color",
    "display",
    "align-items",
    "justify-content",
    "cursor",
    "box-shadow",
    "opacity",
    "visibility",
    "position",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "line-height",
    "letter-spacing",
    "word-spacing",
    "text-transform",
    "text-align",
    "text-indent",
    "white-space",
    "direction"
];

// Anything of ours that would still be in light DOM if the migration were
// only partial.
const LIGHT_DOM_LEAK_SELECTOR =
    "#add-new-word, #add-new-sentence, #deleteWordBtn, .edit-translation-container, .action-button, .edit-translation-input";

const errors = [];
window.addEventListener("error", (event) => errors.push(String(event.message)));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function shadowRoot() {
    return document.getElementById("lazylex-controls")?.shadowRoot || null;
}

function openControls() {
    return [...(shadowRoot()?.querySelectorAll(".lazylex-control") || [])];
}

function measure(element) {
    const computed = getComputedStyle(element);
    const style = {};
    PROBED_PROPERTIES.forEach((property) => {
        style[property] = computed.getPropertyValue(property);
    });
    const rect = element.getBoundingClientRect();
    return {
        style,
        // Rounded box only. The anchor legitimately differs per fixture (the
        // hostile CSS moves the text the control is anchored to); what must be
        // identical is the control's own size, and what must be true
        // everywhere is that it was placed on screen at all.
        box: {
            width: Math.round(rect.width),
            height: Math.round(rect.height)
        },
        onScreen: rect.width > 0 && rect.height > 0
            && rect.top >= 0 && rect.left >= 0
            && rect.bottom <= window.innerHeight + 1
            && rect.right <= window.innerWidth + 1
    };
}

// A real pointer gesture, including the trailing click the browser always
// sends after mouseup. Measuring at mouseup alone is what hid #55.
function gesture(target, { select = null } = {}) {
    const rect = target.getBoundingClientRect();
    const coordinates = {
        bubbles: true,
        composed: true,
        cancelable: true,
        clientX: Math.round(rect.left + 2),
        clientY: Math.round(rect.top + 2)
    };

    target.dispatchEvent(new MouseEvent("mousedown", coordinates));

    const selection = window.getSelection();
    selection.removeAllRanges();
    if (select) {
        const range = document.createRange();
        range.selectNodeContents(select);
        selection.addRange(range);
    }

    target.dispatchEvent(new MouseEvent("mouseup", coordinates));
    // The browser fires this on the common ancestor of mousedown/mouseup
    // immediately afterwards. It is part of the same gesture.
    target.dispatchEvent(new MouseEvent("click", coordinates));
}

// Runs one scenario and records both the control's computed style and the
// invariants that must hold after a whole gesture: exactly one control open,
// still open a moment later, and nothing of ours left in light DOM.
async function scenario(name, selector, drive) {
    const result = { name };
    try {
        drive();
        await sleep(60);

        const openedImmediately = openControls().length;
        const element = shadowRoot()?.querySelector(selector);
        result.found = !!element;
        if (element) {
            Object.assign(result, measure(element));
        }

        // "Stays open": #55's failure mode was a control that existed for a
        // moment and was then destroyed by its own gesture's trailing click.
        await sleep(300);
        result.stillOpen = !!shadowRoot()?.querySelector(selector);
        result.openControlCount = openedImmediately;
        result.openControlCountAfterSettle = openControls().length;
        result.lightDomLeaks = document.querySelectorAll(LIGHT_DOM_LEAK_SELECTOR).length;
    } catch (error) {
        result.error = String(error?.message || error);
    }
    return result;
}

// Builds the "already saved word" markup the delete and edit controls hang
// off. It has to be created here rather than authored into the fixture HTML:
// the content script runs clearHighlighting() during bootstrap, which replaces
// every .highlight-wrapper it finds with its data-original-text. A wrapper
// present at document_end is therefore gone by the time the probe runs --
// correct extension behaviour, and a trap worth recording.
function buildSavedWord() {
    const slot = document.getElementById("saved-slot");
    slot.textContent = "";

    const wrapper = document.createElement("span");
    wrapper.className = "highlight-wrapper";
    wrapper.dataset.wordId = "1";
    wrapper.dataset.originalText = "word";

    const highlighted = document.createElement("span");
    highlighted.className = "highlighted-word";
    highlighted.textContent = "word";

    const translation = document.createElement("span");
    translation.className = "translation";
    translation.textContent = "[слово]";

    wrapper.appendChild(highlighted);
    wrapper.appendChild(translation);
    slot.appendChild(wrapper);
    return wrapper;
}

async function run() {
    const scenarios = [];

    // 1. Select a plain word. mouseup raises "+", and the trailing click of
    //    the same gesture must not take it away again (#55).
    scenarios.push(await scenario("select-plain-word", "#add-new-word", () => {
        const word = document.getElementById("word");
        gesture(word, { select: word });
    }));

    // 2. A sentence-shaped selection raises the distinct "S+" control. This is
    //    the one that used to land in normal body flow, because styles.css
    //    never gave #add-new-sentence a `position` rule at all.
    scenarios.push(await scenario("select-sentence", "#add-new-sentence", () => {
        const sentence = document.getElementById("sentence");
        gesture(sentence, { select: sentence });
    }));

    buildSavedWord();

    // 3. Select a word that is ALREADY highlighted. mouseup opens "+" and the
    //    trailing click lands on a .highlight-wrapper, so without #55's guard
    //    the delete path would open a second control in the same gesture.
    scenarios.push(await scenario("select-highlighted-word", "#add-new-word", () => {
        const highlighted = document.querySelector(".highlight-wrapper .highlighted-word");
        gesture(highlighted, { select: highlighted });
    }));

    // 4. Click (no selection) on a saved word raises the delete control --
    //    #11's dark red, white-bordered, drop-shadowed button.
    scenarios.push(await scenario("click-saved-word", "#deleteWordBtn", () => {
        gesture(document.querySelector(".highlight-wrapper .highlighted-word"));
    }));

    // 5. Clicking the translation opens the editor. In light DOM this input
    //    had no !important at all, so any host `input {}` rule reshaped it.
    scenarios.push(await scenario("click-translation", ".edit-translation-input", () => {
        gesture(document.querySelector(".highlight-wrapper .translation"));
    }));

    // The editor's save button is an .action-button and is still open here.
    const saveButton = shadowRoot()?.querySelector(".edit-translation-container .action-button");
    scenarios.push(
        saveButton
            ? { name: "editor-save-button", found: true, ...measure(saveButton) }
            : { name: "editor-save-button", found: false }
    );

    // --- #51's dismissal contract, re-checked under shadow retargeting ------
    //
    // This is the part a shadow-root migration is most likely to break, so it
    // is exercised rather than argued.
    const dismissal = {};

    // 1. A click INSIDE the control must not dismiss it. Events from a shadow
    //    root are retargeted to the host on the way out, so a handler reading
    //    event.target instead of composedPath() would treat this as an outside
    //    click and close the editor the moment the user clicked into it.
    const input = shadowRoot()?.querySelector(".edit-translation-input");
    if (input) {
        gesture(input);
        await sleep(120);
        dismissal.clickInsideKeepsItOpen = !!shadowRoot()?.querySelector(".edit-translation-input");
    } else {
        dismissal.clickInsideKeepsItOpen = null;
    }

    // 2. Escape closes whatever is open.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(120);
    dismissal.escapeClosesIt = openControls().length === 0;
    // ...and the editor's teardown put the translation back rather than
    // leaving the word without one (#51, criterion 7).
    dismissal.translationRestored =
        document.querySelector(".highlight-wrapper .translation")?.style.display !== "none";

    // 3. A genuine outside click closes whatever is open.
    const word = document.getElementById("word");
    gesture(word, { select: word });
    await sleep(120);
    dismissal.reopenedForOutsideClick = openControls().length === 1;
    gesture(document.querySelector("h1"));
    await sleep(120);
    dismissal.outsideClickClosesIt = openControls().length === 0;

    scenarios.push({ name: "dismissal", found: true, dismissal });

    const host = document.getElementById("lazylex-controls");
    const hostStyle = {};
    if (host) {
        ["position", "pointer-events", "z-index", "width", "height", "display"].forEach((property) => {
            hostStyle[property] = getComputedStyle(host).getPropertyValue(property);
        });
    }

    // Diagnostic that separates "the extension never loaded" from "the content
    // script loaded but failed": styles.css is injected by the same
    // content_scripts entry as content.js, and it is the only part of LazyLex
    // observable from the page's own world.
    const wrapper = document.querySelector(".highlight-wrapper");
    const extensionCssApplied = wrapper
        ? getComputedStyle(wrapper).display === "inline-block"
        : false;

    await fetch("/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            fixture: document.documentElement.dataset.fixture,
            extensionCssApplied,
            shadowRootFound: !!shadowRoot(),
            hostAttachedTo: host?.parentElement?.tagName || null,
            hostStyle,
            scenarios,
            errors
        })
    });

    const next = FIXTURES[FIXTURES.indexOf(document.documentElement.dataset.fixture) + 1];
    window.location.href = next ? `/${next}` : "/done";
}

// The content script is injected at document_end; give it a beat to install
// its listeners before driving them.
window.addEventListener("load", () => setTimeout(run, 500));
