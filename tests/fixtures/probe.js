// Hostile-fixture probe (#52)
//
// Loaded by every fixture page. It drives each LazyLex control the way a user
// would, reads the *computed* style of each one out of the shadow root, and
// POSTs the result back to the harness (run-chrome-style-check.mjs), which
// then asserts that every fixture produced identical numbers.
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
// affordance (cursor) and the inherited typography the old stylesheet never
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

const errors = [];
window.addEventListener("error", (event) => errors.push(String(event.message)));

function shadowRoot() {
    return document.getElementById("lazylex-controls")?.shadowRoot || null;
}

function waitFor(produce, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        (function poll() {
            let value = null;
            try {
                value = produce();
            } catch (error) {
                errors.push(String(error?.message || error));
            }
            if (value) {
                resolve(value);
                return;
            }
            if (Date.now() - startedAt > timeoutMs) {
                reject(new Error("timed out waiting for a LazyLex control"));
                return;
            }
            setTimeout(poll, 50);
        })();
    });
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
        rect: {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            // Rounded, because the anchor differs per fixture (the hostile CSS
            // moves the text). What matters is that the control was placed at
            // all, not that it landed on the same pixel everywhere.
            onScreen: rect.top >= 0 && rect.left >= 0
                && rect.bottom <= window.innerHeight + 1
                && rect.right <= window.innerWidth + 1
        }
    };
}

function selectAndRelease(element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new MouseEvent("mouseup", {
        bubbles: true,
        composed: true,
        clientX: Math.round(rect.left + 4),
        clientY: Math.round(rect.top + 4)
    }));
}

function clearSelection() {
    window.getSelection().removeAllRanges();
}

function click(element) {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
}

async function probe(id, open) {
    open();
    const element = await waitFor(() => shadowRoot()?.querySelector(id));
    return measure(element);
}

async function run() {
    const controls = {};
    const failures = {};

    const attempts = [
        // A short word selection raises the "+" control.
        ["#add-new-word", () => selectAndRelease(document.getElementById("word"))],
        // A sentence-shaped selection raises the distinct "S+" control. This is
        // the one that used to land in normal body flow, because styles.css
        // never gave #add-new-sentence a `position` rule.
        ["#add-new-sentence", () => selectAndRelease(document.getElementById("sentence"))],
        // Clicking a saved word raises the delete control (#11's).
        ["#deleteWordBtn", () => {
            clearSelection();
            click(document.querySelector(".highlight-wrapper .highlighted-word"));
        }],
        // Clicking the translation opens the editor: the input, plus its save
        // button, which is an .action-button like the others.
        [".edit-translation-input", () => {
            clearSelection();
            click(document.querySelector(".highlight-wrapper .translation"));
        }]
    ];

    for (const [id, open] of attempts) {
        try {
            controls[id] = await probe(id, open);
        } catch (error) {
            failures[id] = String(error?.message || error);
        }
    }

    // The editor's save button is still open at this point.
    try {
        const saveButton = shadowRoot()?.querySelector(".edit-translation-container .action-button");
        if (saveButton) {
            controls["#save-translation"] = measure(saveButton);
        } else {
            failures["#save-translation"] = "not found";
        }
    } catch (error) {
        failures["#save-translation"] = String(error?.message || error);
    }

    const hostStyle = {};
    const host = document.getElementById("lazylex-controls");
    if (host) {
        ["position", "pointer-events", "z-index", "width", "height"].forEach((property) => {
            hostStyle[property] = getComputedStyle(host).getPropertyValue(property);
        });
    }

    await fetch("/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            fixture: document.documentElement.dataset.fixture,
            shadowRootFound: !!shadowRoot(),
            hostStyle,
            controls,
            failures,
            errors
        })
    });

    const next = FIXTURES[FIXTURES.indexOf(document.documentElement.dataset.fixture) + 1];
    window.location.href = next ? `/${next}` : "/done";
}

// The content script is injected at document_end; give it a beat to install
// its listeners before driving them.
window.addEventListener("load", () => setTimeout(run, 400));
