import { escapeHtml } from "../../shared/dom.js";

interface EmptyStateProps {
    title: string;
    message?: string;
    iconSrc?: string;
    primaryActionHtml?: string;
    secondaryActionHtml?: string;
    className?: string;
}

export function emptyStateHtml(props: EmptyStateProps): string {
    const {
        title,
        message = "",
        iconSrc = "",
        primaryActionHtml = "",
        secondaryActionHtml = "",
        className = "",
    } = props;

    const classes = ["ui-empty-state", className].filter(Boolean).join(" ");

    return `
        <div class="${classes}">
            ${iconSrc ? `<img class="ui-empty-state__icon" src="${escapeHtml(iconSrc)}" alt="" width="48" height="48">` : ""}
            <h3 class="ui-empty-state__title">${escapeHtml(title)}</h3>
            ${message ? `<p class="ui-empty-state__message">${escapeHtml(message)}</p>` : ""}
            ${(primaryActionHtml || secondaryActionHtml) ? `
                <div class="ui-empty-state__actions">
                    ${primaryActionHtml}
                    ${secondaryActionHtml}
                </div>
            ` : ""}
        </div>
    `;
}