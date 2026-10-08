import { escapeHtml } from "../../shared/dom.js";
import { captureFocusReturn, containTabKey, findFocusableElements } from "../core/a11y.js";

interface ModalAction {
    label: string;
    tone?: string;
    dataAction?: string;
}

export interface ModalProps {
    title: string;
    body: string;
    tone?: "default" | "danger";
    actions?: ModalAction[];
    onClose?: () => void;
}

export interface ModalController {
    open: () => void;
    close: () => void;
    destroy: () => void;
}

/**
 * Create a modal dialog with focus management.
 */
export function createModal(props: ModalProps): ModalController {
    const { title, body, tone = "default", actions = [], onClose } = props;

    let restoreFocus: (() => void) | null = null;
    let isOpen = false;
    let openingFrame = 0;
    let removalTimer: ReturnType<typeof setTimeout> | null = null;
    const backgroundInert = new Map<HTMLElement, boolean>();

    const root = document.createElement("div");
    root.className = "lk-dialog-root";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", title);
    root.tabIndex = -1;

    const toneClass = tone === "danger" ? "ui-modal--danger" : "";

    root.innerHTML = `
        <div class="lk-dialog-overlay" data-dismiss></div>
        <div class="lk-dialog ${toneClass}">
            <div class="lk-dialog__container">
                <div class="lk-dialog__header">
                    <span class="lk-dialog__title">${escapeHtml(title)}</span>
                    <span class="lk-dialog__spacer"></span>
                    <button class="lk-dialog__close" data-dismiss aria-label="Close">
                        <img src="./assets/icons/close.svg" alt="" width="18" height="18">
                    </button>
                </div>
                <div class="lk-dialog__divider"></div>
                <div class="lk-dialog__content">${body}</div>
                ${actions.length ? `
                    <div class="lk-dialog__buttons">
                        ${actions.map((a) => `
                            <button class="button button--${a.tone || "ghost"}"
                                    type="button"
                                    ${a.dataAction ? `data-action="${escapeHtml(a.dataAction)}"` : ""}>
                                ${escapeHtml(a.label)}
                            </button>
                        `).join("")}
                    </div>
                ` : ""}
            </div>
        </div>
    `;

    function focusableElements(): HTMLElement[] {
        return findFocusableElements(root, "button, [href], input, select, textarea, [tabindex]");
    }

    function focusFirst(): void {
        (focusableElements()[0] ?? root).focus({ preventScroll: true });
    }

    function isActive(): boolean {
        // A later modal makes this root inert until it closes.
        return isOpen && !root.inert;
    }

    function isolateBackground(): void {
        if (!isActive()) return;
        for (const child of Array.from(document.body.children)) {
            if (!(child instanceof HTMLElement) || child === root) continue;
            // The shared announcer contains only text. Keep it available for
            // modal feedback; background toast actions remain isolated.
            if (child.id === "fw-live-region") continue;
            if (!backgroundInert.has(child)) {
                backgroundInert.set(child, child.inert);
                child.inert = true;
            }
        }
    }

    const backgroundObserver = new MutationObserver(isolateBackground);

    function onFocusIn(event: FocusEvent): void {
        if (isActive() && event.target instanceof Node && !root.contains(event.target)) {
            focusFirst();
        }
    }

    function onKeyDown(event: KeyboardEvent): void {
        if (!isActive()) return;
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
        }
        if (event.key !== "Tab") return;
        containTabKey(event, root, focusableElements());
    }

    function releaseBackground(): void {
        isOpen = false;
        cancelAnimationFrame(openingFrame);
        document.removeEventListener("keydown", onKeyDown, true);
        document.removeEventListener("focusin", onFocusIn, true);
        backgroundObserver.disconnect();
        for (const [element, wasInert] of backgroundInert) {
            element.inert = wasInert;
        }
        backgroundInert.clear();
        // The fading dialog must no longer participate in keyboard navigation.
        root.inert = true;
        restoreFocus?.();
        restoreFocus = null;
    }

    function removeRoot(): void {
        root.removeEventListener("transitionend", removeRoot);
        if (removalTimer !== null) clearTimeout(removalTimer);
        removalTimer = null;
        root.remove();
    }

    function close(): void {
        if (!isOpen) return;
        root.classList.remove("is-visible");
        root.addEventListener("transitionend", removeRoot);
        removalTimer = setTimeout(removeRoot, 350);
        releaseBackground();
        onClose?.();
    }

    root.querySelectorAll("[data-dismiss]").forEach((el) => {
        el.addEventListener("click", close);
    });

    function open(): void {
        if (isOpen) return;
        root.removeEventListener("transitionend", removeRoot);
        if (removalTimer !== null) clearTimeout(removalTimer);
        removalTimer = null;
        restoreFocus = captureFocusReturn();
        isOpen = true;
        root.inert = false;
        document.body.appendChild(root);
        isolateBackground();
        backgroundObserver.observe(document.body, { childList: true });
        document.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("focusin", onFocusIn, true);
        openingFrame = requestAnimationFrame(() => {
            if (!isOpen) return;
            root.classList.add("is-visible");
            if (isActive()) focusFirst();
        });
    }

    function destroy(): void {
        if (isOpen) releaseBackground();
        removeRoot();
    }

    return { open, close, destroy };
}
