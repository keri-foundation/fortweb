import { escapeHtml } from "../../shared/dom.js";
import { captureFocusReturn } from "../core/a11y.js";

export interface ModalAction {
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

    const root = document.createElement("div");
    root.className = "lk-dialog-root";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", title);

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

    function close(): void {
        root.classList.remove("is-visible");
        root.addEventListener("transitionend", () => root.remove(), { once: true });
        setTimeout(() => root.remove(), 350);
        restoreFocus?.();
        onClose?.();
    }

    root.querySelectorAll("[data-dismiss]").forEach((el) => {
        el.addEventListener("click", close);
    });

    function open(): void {
        restoreFocus = captureFocusReturn();
        document.body.appendChild(root);
        requestAnimationFrame(() => {
            root.classList.add("is-visible");
            const firstFocusable = root.querySelector("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])") as HTMLElement | null;
            firstFocusable?.focus();
        });
    }

    function destroy(): void {
        root.remove();
        restoreFocus?.();
    }

    return { open, close, destroy };
}
