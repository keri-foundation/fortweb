/**
 * Accessibility utilities for the Fortweb view system.
 *
 * Provides reusable patterns for:
 *   - Live region announcements (status, error)
 *   - Focus return after overlay close
 *   - Roving tabindex for manual tab/segment interactions
 */

/** @type {HTMLElement|null} */
let liveRegion = null;

/**
 * Ensure a shared live region exists in the DOM.
 * Creates one if it doesn't exist yet.
 *
 * @returns {HTMLElement}
 */
function ensureLiveRegion() {
    if (liveRegion && document.body.contains(liveRegion)) {
        return liveRegion;
    }
    liveRegion = document.createElement("div");
    liveRegion.setAttribute("role", "status");
    liveRegion.setAttribute("aria-live", "polite");
    liveRegion.setAttribute("aria-atomic", "true");
    liveRegion.className = "visually-hidden";
    liveRegion.id = "fw-live-region";
    document.body.appendChild(liveRegion);
    return liveRegion;
}

/**
 * Announce a message to assistive technologies via the shared live region.
 *
 * @param {string} message
 * @param {"polite"|"assertive"} [priority="polite"]
 */
export function announce(message, priority = "polite") {
    const region = ensureLiveRegion();
    region.setAttribute("aria-live", priority);
    region.textContent = "";
    requestAnimationFrame(() => {
        region.textContent = message;
    });
}

/**
 * Store the currently focused element and return a function
 * that restores focus to it.
 *
 * @returns {function} restoreFocus
 */
export function captureFocusReturn() {
    const previousFocus = /** @type {HTMLElement|null} */ (document.activeElement);
    return () => {
        if (previousFocus && typeof previousFocus.focus === "function") {
            previousFocus.focus({ preventScroll: true });
        }
    };
}

/**
 * Set up roving tabindex on a set of focusable elements within a container.
 * Arrow keys move focus between items; Home/End jump to first/last.
 * Returns a cleanup function.
 *
 * @param {HTMLElement} container
 * @param {string} itemSelector
 * @param {Object} [options]
 * @param {"horizontal"|"vertical"|"both"} [options.orientation="horizontal"]
 * @returns {function} cleanup
 */
export function rovingTabindex(container, itemSelector, options = {}) {
    const { orientation = "horizontal" } = options;

    function getItems() {
        return /** @type {HTMLElement[]} */ (
            Array.from(container.querySelectorAll(itemSelector))
        );
    }

    function initTabindex() {
        const items = getItems();
        items.forEach((item, i) => {
            item.setAttribute("tabindex", i === 0 ? "0" : "-1");
        });
    }

    function moveFocus(items, currentIndex, delta) {
        const nextIndex = (currentIndex + delta + items.length) % items.length;
        items.forEach((item, i) => {
            item.setAttribute("tabindex", i === nextIndex ? "0" : "-1");
        });
        items[nextIndex].focus();
    }

    function handleKeydown(event) {
        const items = getItems();
        const current = items.indexOf(/** @type {HTMLElement} */ (event.target));
        if (current === -1) return;

        const isHorizontal = orientation === "horizontal" || orientation === "both";
        const isVertical = orientation === "vertical" || orientation === "both";

        switch (event.key) {
            case "ArrowRight":
                if (isHorizontal) { event.preventDefault(); moveFocus(items, current, 1); }
                break;
            case "ArrowLeft":
                if (isHorizontal) { event.preventDefault(); moveFocus(items, current, -1); }
                break;
            case "ArrowDown":
                if (isVertical) { event.preventDefault(); moveFocus(items, current, 1); }
                break;
            case "ArrowUp":
                if (isVertical) { event.preventDefault(); moveFocus(items, current, -1); }
                break;
            case "Home":
                event.preventDefault();
                moveFocus(items, current, -current);
                break;
            case "End":
                event.preventDefault();
                moveFocus(items, current, items.length - 1 - current);
                break;
        }
    }

    initTabindex();
    container.addEventListener("keydown", handleKeydown);
    return () => container.removeEventListener("keydown", handleKeydown);
}
