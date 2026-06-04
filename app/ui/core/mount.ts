/**
 * DOM mount/unmount utilities for the Fortweb view system.
 */

/**
 * Create an element from an HTML string and append it to a parent.
 * Returns the first element child of the inserted HTML, or the parent's last element child as a fallback.
 */
export function insertHTML(
    parent: HTMLElement,
    html: string,
    position: InsertPosition = "beforeend",
): HTMLElement {
    const template = document.createElement("template");
    template.innerHTML = html;
    const firstChild = template.content.firstElementChild as HTMLElement | null;

    if (position === "beforeend") {
        parent.append(template.content);
    } else if (position === "afterbegin") {
        parent.prepend(template.content);
    } else {
        parent.insertAdjacentHTML(position, html);
    }

    return firstChild || (parent.lastElementChild as HTMLElement);
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
