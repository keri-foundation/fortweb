import { escapeHtml } from "../../shared/dom.js";
import { captureFocusReturn } from "../core/a11y.js";

/**
 * @typedef {Object} SheetProps
 * @property {string} title
 * @property {string} [subtitle]
 * @property {string} content - HTML content for the sheet body
 * @property {Array<{label: string, tone?: string, dataAction?: string}>} [actions]
 * @property {function} [onDismiss]
 */

/**
 * @typedef {Object} SheetController
 * @property {function} open
 * @property {function} close
 * @property {function} destroy
 */

/**
 * Create a bottom sheet overlay with focus management.
 *
 * @param {SheetProps} props
 * @returns {SheetController}
 */
export function createSheet(props) {
    const { title, subtitle = "", content, actions = [], onDismiss } = props;

    let restoreFocus = null;

    const root = document.createElement("div");
    root.className = "lk-dialog-root lk-dialog-root--sheet";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", title);

    root.innerHTML = `
        <div class="lk-dialog-overlay" data-dismiss></div>
        <div class="lk-dialog lk-dialog--sheet">
            <div class="lk-dialog__container">
                <div class="lk-dialog__header">
                    <div>
                        <span class="lk-dialog__title">${escapeHtml(title)}</span>
                        ${subtitle ? `<p class="lk-dialog__subtitle">${escapeHtml(subtitle)}</p>` : ""}
                    </div>
                    <span class="lk-dialog__spacer"></span>
                    <button class="lk-dialog__close" data-dismiss aria-label="Close">
                        <img src="./assets/icons/close.svg" alt="" width="18" height="18">
                    </button>
                </div>
                <div class="lk-dialog__divider"></div>
                <div class="lk-dialog__content">${content}</div>
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

    function close() {
        root.classList.remove("is-visible");
        root.addEventListener("transitionend", () => root.remove(), { once: true });
        setTimeout(() => root.remove(), 350);
        restoreFocus?.();
        onDismiss?.();
    }

    root.querySelectorAll("[data-dismiss]").forEach((el) => {
        el.addEventListener("click", close);
    });

    function open() {
        restoreFocus = captureFocusReturn();
        document.body.appendChild(root);
        requestAnimationFrame(() => {
            root.classList.add("is-visible");
            const firstFocusable = root.querySelector("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
            /** @type {HTMLElement|null} */ (firstFocusable)?.focus();
        });
    }

    function destroy() {
        root.remove();
        restoreFocus?.();
    }

    return { open, close, destroy };
}
