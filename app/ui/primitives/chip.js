import { escapeHtml } from "../../shared/dom.js";

/**
 * @typedef {Object} ChipProps
 * @property {string} label
 * @property {"neutral"|"success"|"warning"|"danger"|"info"} [tone="neutral"]
 * @property {boolean} [selected=false]
 * @property {string} [dataValue] - value for data-value attribute
 * @property {string} [className]
 */

/**
 * Render a chip / filter pill.
 *
 * @param {ChipProps} props
 * @returns {string}
 */
export function chipHtml(props) {
    const {
        label,
        tone = "neutral",
        selected = false,
        dataValue = "",
        className = "",
    } = props;

    const classes = [
        "ui-chip",
        `ui-chip--${tone}`,
        selected ? "is-active" : "",
        className,
    ].filter(Boolean).join(" ");

    const attrs = [
        `class="${classes}"`,
        `type="button"`,
        dataValue ? `data-value="${escapeHtml(dataValue)}"` : "",
        selected ? `aria-pressed="true"` : `aria-pressed="false"`,
    ].filter(Boolean).join(" ");

    return `<button ${attrs}>${escapeHtml(label)}</button>`;
}
