import { escapeHtml } from "../../shared/dom.js";

/**
 * @typedef {Object} CardProps
 * @property {string} [title]
 * @property {string} [eyebrow] - small label above the title
 * @property {string} [body] - HTML content for the card body
 * @property {string} [actionsHtml] - HTML for the card action area
 * @property {"default"|"danger"} [tone="default"]
 * @property {string} [className] - additional CSS classes
 */

/**
 * Render a surface card with optional title, eyebrow, body, and actions.
 *
 * @param {CardProps} props
 * @returns {string}
 */
export function cardHtml(props) {
    const {
        title = "",
        eyebrow = "",
        body = "",
        actionsHtml = "",
        tone = "default",
        className = "",
    } = props;

    const classes = [
        "ui-card",
        tone === "danger" ? "ui-card--danger" : "",
        className,
    ].filter(Boolean).join(" ");

    const headerHtml = (eyebrow || title)
        ? `<div class="ui-card__header">
            ${eyebrow ? `<p class="ui-card__eyebrow">${escapeHtml(eyebrow)}</p>` : ""}
            ${title ? `<h2 class="ui-card__title">${escapeHtml(title)}</h2>` : ""}
        </div>`
        : "";

    const bodySection = body
        ? `<div class="ui-card__body">${body}</div>`
        : "";

    const actionsSection = actionsHtml
        ? `<div class="ui-card__actions">${actionsHtml}</div>`
        : "";

    return `<div class="${classes}">${headerHtml}${bodySection}${actionsSection}</div>`;
}
