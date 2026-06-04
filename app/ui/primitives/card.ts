import { escapeHtml } from "../../shared/dom.js";

export interface CardProps {
    title?: string;
    eyebrow?: string;
    body?: string;
    actionsHtml?: string;
    tone?: "default" | "danger";
    className?: string;
}

/**
 * Render a surface card with optional title, eyebrow, body, and actions.
 */
export function cardHtml(props: CardProps): string {
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
