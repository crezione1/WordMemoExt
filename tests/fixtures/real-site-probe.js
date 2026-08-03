// Real-site probe (#52, acceptance criterion 2).
//
// Injected as an EXTRA content script into a throwaway copy of the build by
// run-real-site-check.mjs. It is never part of the shipped extension; the
// repository's manifest.json is not touched.
//
// It runs in the same isolated world as content.js, so it can read the shadow
// root directly, and reports computed styles back to the local harness.
//
// Deliberately conservative about the host page: it never clicks, selects or
// submits anything belonging to the site. It appends its own paragraph of text
// at the end of <body> and drives every gesture on that. The site's CSS -- its
// `button {}` / `input {}` rules and its root typography -- still applies to
// our controls exactly as it would anywhere else on the page, which is the
// only thing being measured.

(() => {
    const HARNESS = document.currentScript?.dataset?.harness || window.__LAZYLEX_HARNESS__;

    const PROBED_PROPERTIES = [
        "width", "height", "padding-top", "padding-left",
        "border-top-width", "border-top-style", "border-top-color", "border-radius",
        "box-sizing", "background-color", "background-image", "color",
        "display", "align-items", "justify-content", "cursor", "box-shadow",
        "opacity", "visibility", "position",
        "font-family", "font-size", "font-weight", "font-style",
        "line-height", "letter-spacing", "word-spacing",
        "text-transform", "text-align", "text-indent", "white-space", "direction"
    ];

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const shadowRoot = () => document.getElementById("lazylex-controls")?.shadowRoot || null;
    const openControls = () => [...(shadowRoot()?.querySelectorAll(".lazylex-control") || [])];

    function measure(element) {
        const computed = getComputedStyle(element);
        const style = {};
        PROBED_PROPERTIES.forEach((property) => {
            style[property] = computed.getPropertyValue(property);
        });
        const rect = element.getBoundingClientRect();
        return {
            style,
            box: { width: Math.round(rect.width), height: Math.round(rect.height) },
            onScreen: rect.width > 0 && rect.height > 0
                && rect.top >= 0 && rect.left >= 0
                && rect.bottom <= window.innerHeight + 1
                && rect.right <= window.innerWidth + 1
        };
    }

    // Our own sandbox, appended to the page. Nothing belonging to the site is
    // ever the target of a synthetic event.
    function buildSandbox() {
        const sandbox = document.createElement("div");
        sandbox.id = "lazylex-probe-sandbox";
        sandbox.style.setProperty("padding", "40px", "important");

        const word = document.createElement("p");
        word.id = "lazylex-probe-word";
        word.textContent = "Serendipity";

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

        const saved = document.createElement("p");
        saved.appendChild(wrapper);

        sandbox.appendChild(word);
        sandbox.appendChild(saved);
        document.body.appendChild(sandbox);
        return { word, wrapper, highlighted, translation };
    }

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
        target.dispatchEvent(new MouseEvent("click", coordinates));
    }

    async function scenario(name, selector, drive) {
        const result = { name };
        try {
            drive();
            await sleep(80);
            const element = shadowRoot()?.querySelector(selector);
            result.found = !!element;
            if (element) {
                Object.assign(result, measure(element));
            }
            await sleep(300);
            result.stillOpen = !!shadowRoot()?.querySelector(selector);
            result.openControlCountAfterSettle = openControls().length;
            result.lightDomLeaks = document.querySelectorAll(
                "#add-new-word, #add-new-sentence, #deleteWordBtn, .edit-translation-container"
            ).length;
        } catch (error) {
            result.error = String(error?.message || error);
        }
        return result;
    }

    async function run() {
        const nodes = buildSandbox();
        // Keep the sandbox in view so the controls are placed against it.
        nodes.word.scrollIntoView({ block: "center" });
        await sleep(250);

        const scenarios = [];
        scenarios.push(await scenario("select-plain-word", "#add-new-word", () => {
            gesture(nodes.word, { select: nodes.word });
        }));
        scenarios.push(await scenario("select-highlighted-word", "#add-new-word", () => {
            gesture(nodes.highlighted, { select: nodes.highlighted });
        }));
        scenarios.push(await scenario("click-saved-word", "#deleteWordBtn", () => {
            gesture(nodes.highlighted);
        }));
        scenarios.push(await scenario("click-translation", ".edit-translation-input", () => {
            gesture(nodes.translation);
        }));

        const host = document.getElementById("lazylex-controls");
        const hostStyle = {};
        if (host) {
            ["position", "pointer-events", "z-index"].forEach((property) => {
                hostStyle[property] = getComputedStyle(host).getPropertyValue(property);
            });
        }

        await fetch(`${HARNESS}/report`, {
            method: "POST",
            // text/plain keeps this a CORS "simple request", so there is no
            // preflight to negotiate from a content script.
            headers: { "content-type": "text/plain" },
            body: JSON.stringify({
                site: location.hostname,
                url: location.href,
                title: document.title,
                shadowRootFound: !!shadowRoot(),
                hostAttachedTo: host?.parentElement?.tagName || null,
                hostStyle,
                scenarios
            })
        });

        const response = await fetch(`${HARNESS}/next`);
        const next = (await response.text()).trim();
        if (next && next !== "done") {
            window.location.href = next;
        }
    }

    if (document.readyState === "complete") {
        setTimeout(run, 1200);
    } else {
        window.addEventListener("load", () => setTimeout(run, 1200));
    }
})();
