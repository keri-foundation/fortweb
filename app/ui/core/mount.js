/**
 * DOM mount/unmount utilities for the Fortweb view system.
 */

/**
 * Create an element from an HTML string and append it to a parent.
 *
 * @param {HTMLElement} parent
 * @param {string} html
 * @param {string} [position="beforeend"]
 * @returns {HTMLElement} the inserted element
 */
export function insertHTML(parent, html, position = "beforeend") {
    parent.insertAdjacentHTML(position, html);
    return /** @type {HTMLElement} */ (parent.lastElementChild);
}

/**
 * Replace all children of a container with new HTML.
 *
 * @param {HTMLElement} container
 * @param {string} html
 */
export function replaceContent(container, html) {
    container.innerHTML = html;
}

/**
 * Remove an element from the DOM if it exists.
 *
 * @param {HTMLElement|null} element
 */
export function removeElement(element) {
    element?.remove();
}
