import { escapeHtml } from "../../shared/dom.js";

/**
 * @typedef {Object} ButtonProps
 * @property {string} label
 * @property {"primary"|"secondary"|"ghost"|"danger"} [tone="primary"]
 * @property {"button"|"submit"|"reset"} [type="button"]
 * @property {boolean} [disabled=false]
 * @property {string} [icon] - HTML string for a leading icon
 * @property {string} [dataAction] - value for data-action attribute
 * @property {string} [className] - additional CSS classes
 */

/**
 * Render a button element as an HTML string.
 *
 * @param {ButtonProps} props
 * @returns {string}
 */
export function buttonHtml(props) {
    const {
        label,
        tone = "primary",
        type = "button",
        disabled = false,
        icon = "",
        dataAction = "",
        className = "",
    } = props;

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
