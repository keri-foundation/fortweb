/**
 * Event delegation utilities for the Fortweb view system.
 */

/**
 * Attach a delegated click handler for elements matching a selector.
 * Returns a cleanup function that removes the listener.
 *
 * @param {HTMLElement} root
 * @param {string} selector
 * @param {function(Event, HTMLElement): void} handler
 * @returns {function} cleanup
 */
export function delegateClick(root, selector, handler) {
    function listener(event) {
        const target = /** @type {HTMLElement} */ (event.target).closest(selector);
        if (target && root.contains(target)) {
            handler(event, target);
        }
    }
    root.addEventListener("click", listener);
    return () => root.removeEventListener("click", listener);
}

/**
 * Attach multiple delegated handlers at once.
 * Returns a single cleanup function.
 *
 * @param {HTMLElement} root
 * @param {Object<string, function(Event, HTMLElement): void>} selectorMap
 * @returns {function} cleanup
 */
export function delegateAll(root, selectorMap) {
    const cleanups = Object.entries(selectorMap).map(
        ([selector, handler]) => delegateClick(root, selector, handler),
    );
    return () => cleanups.forEach((fn) => fn());
}
