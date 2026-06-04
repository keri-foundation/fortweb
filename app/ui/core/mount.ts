/**
 * DOM mount/unmount utilities for the Fortweb view system.
 */

/**
 * Create an element from an HTML string and append it to a parent.
 */
export function insertHTML(
    parent: HTMLElement,
    html: string,
    position: InsertPosition = "beforeend",
): HTMLElement {
    parent.insertAdjacentHTML(position, html);
    return parent.lastElementChild as HTMLElement;
}

/**
 * Replace all children of a container with new HTML.
 */
export function replaceContent(container: HTMLElement, html: string): void {
    container.innerHTML = html;
}

/**
 * Remove an element from the DOM if it exists.
 */
export function removeElement(element: HTMLElement | null): void {
    element?.remove();
}
