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

export function captureFocusReturn(): () => void {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    return () => {
        if (previousFocus && typeof previousFocus.focus === "function") {
            previousFocus.focus({ preventScroll: true });
        }
    };
}