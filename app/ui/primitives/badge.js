import { escapeHtml } from "../../shared/dom.js";

/**
 * @typedef {Object} BadgeProps
 * @property {string} label
 * @property {"neutral"|"success"|"warning"|"danger"|"info"} [tone="neutral"]
 * @property {string} [className]
 */

/**
 * Render a status badge / tag.
 *
 * @param {BadgeProps} props
 * @returns {string}
 */
export function badgeHtml(props) {
    const { label, tone = "neutral", className = "" } = props;
    const classes = ["badge", `badge--${tone}`, className].filter(Boolean).join(" ");
    return `<span class="${classes}">${escapeHtml(label)}</span>`;
}
