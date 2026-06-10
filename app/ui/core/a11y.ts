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

interface RovingTabindexOptions {
    orientation?: "horizontal" | "vertical" | "both";
}

export function rovingTabindex(
    container: HTMLElement,
    itemSelector: string,
    options: RovingTabindexOptions = {},
): () => void {
    const { orientation = "horizontal" } = options;

    function getItems(): HTMLElement[] {
        return Array.from(container.querySelectorAll(itemSelector)).filter(
            (item): item is HTMLElement => item instanceof HTMLElement,
        );
    }

    function initTabindex(): void {
        const items = getItems();
        items.forEach((item, index) => {
            item.setAttribute("tabindex", index === 0 ? "0" : "-1");
        });
    }

    function moveFocus(items: HTMLElement[], currentIndex: number, delta: number): void {
        const nextIndex = (currentIndex + delta + items.length) % items.length;
        items.forEach((item, index) => {
            item.setAttribute("tabindex", index === nextIndex ? "0" : "-1");
        });
        items[nextIndex]?.focus();
    }

    function handleKeydown(event: KeyboardEvent): void {
        const items = getItems();
        const currentTarget = event.target;
        const current = currentTarget instanceof HTMLElement ? items.indexOf(currentTarget) : -1;
        if (current === -1) {
            return;
        }

        const isHorizontal = orientation === "horizontal" || orientation === "both";
        const isVertical = orientation === "vertical" || orientation === "both";

        switch (event.key) {
            case "ArrowRight":
                if (isHorizontal) {
                    event.preventDefault();
                    moveFocus(items, current, 1);
                }
                break;
            case "ArrowLeft":
                if (isHorizontal) {
                    event.preventDefault();
                    moveFocus(items, current, -1);
                }
                break;
            case "ArrowDown":
                if (isVertical) {
                    event.preventDefault();
                    moveFocus(items, current, 1);
                }
                break;
            case "ArrowUp":
                if (isVertical) {
                    event.preventDefault();
                    moveFocus(items, current, -1);
                }
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