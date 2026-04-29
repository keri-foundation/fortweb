import { escapeHtml } from "../../shared/dom.js";
export function buttonHtml(props) {
    const { label, tone = "primary", type = "button", disabled = false, icon = "", dataAction = "", className = "", } = props;
    const classes = [
        "button",
        `button--${tone}`,
        className,
    ].filter(Boolean).join(" ");
    const attrs = [
        `type="${type}"`,
        `class="${classes}"`,
        disabled ? "disabled" : "",
        dataAction ? `data-action="${escapeHtml(dataAction)}"` : "",
    ].filter(Boolean).join(" ");
    return `<button ${attrs}>${icon}<span>${escapeHtml(label)}</span></button>`;
}
