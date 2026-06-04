/**
 * Event delegation utilities for the Fortweb view system.
 */

/**
 * Attach a delegated click handler for elements matching a selector.
 * Returns a cleanup function that removes the listener.
 */
export function delegateClick(
    root: HTMLElement,
    selector: string,
    handler: (event: Event, target: HTMLElement) => void,
): () => void {
    function listener(event: Event): void {
        const target = (event.target as HTMLElement).closest(selector) as HTMLElement | null;
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
 */
export function delegateAll(
    root: HTMLElement,
    selectorMap: Record<string, (event: Event, target: HTMLElement) => void>,
): () => void {
    const cleanups = Object.entries(selectorMap).map(
        ([selector, handler]) => delegateClick(root, selector, handler),
    );
    return () => cleanups.forEach((fn) => fn());
}
