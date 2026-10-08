let liveRegion: HTMLElement | null = null;

function ensureLiveRegion(): HTMLElement {
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

export function announce(message: string, priority: "polite" | "assertive" = "polite"): void {
    const region = ensureLiveRegion();
    region.setAttribute("aria-live", priority);
    region.textContent = "";
    requestAnimationFrame(() => {
        region.textContent = message;
    });
}

export function findFocusableElements(container: HTMLElement, selector: string): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(selector))
        .filter((element) => element.tabIndex >= 0
            && !element.matches(":disabled, [hidden]")
            && !element.closest("[inert], [hidden], [aria-hidden='true']")
            && element.getClientRects().length > 0
            && !["hidden", "collapse"].includes(getComputedStyle(element).visibility))
        .sort((a, b) => (a.tabIndex > 0 ? a.tabIndex : Infinity)
            - (b.tabIndex > 0 ? b.tabIndex : Infinity));
}

export function containTabKey(event: KeyboardEvent, container: HTMLElement, focusable: HTMLElement[]): void {
    if (event.key !== "Tab") return;
    if (focusable.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
    }

    const index = focusable.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey ? index <= 0 : index === -1 || index === focusable.length - 1) {
        event.preventDefault();
        (event.shiftKey ? focusable.at(-1) : focusable[0])?.focus({ preventScroll: true });
    }
}

export function captureFocusReturn(): () => void {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    return () => {
        if (previousFocus?.isConnected
            && !previousFocus.matches(":disabled, [hidden]")
            && !previousFocus.closest("[inert], [hidden], [aria-hidden='true']")
            && previousFocus.getClientRects().length > 0) {
            previousFocus.focus({ preventScroll: true });
        }
    };
}
