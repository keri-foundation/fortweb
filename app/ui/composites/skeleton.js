/**
 * @typedef {Object} SkeletonProps
 * @property {"list"|"detail"|"form"|"card"} [preset="list"]
 * @property {number} [count=3] - number of skeleton rows for list preset
 * @property {string} [className]
 */

/**
 * Render a skeleton loading placeholder.
 *
 * @param {SkeletonProps} props
 * @returns {string}
 */
export function skeletonHtml(props) {
    const { preset = "list", count = 3, className = "" } = props;
    const classes = ["ui-skeleton", `ui-skeleton--${preset}`, className].filter(Boolean).join(" ");

    switch (preset) {
        case "detail":
            return `
                <div class="${classes}" aria-busy="true" aria-label="Loading content">
                    <div class="ui-skeleton__line ui-skeleton__line--title"></div>
                    <div class="ui-skeleton__line ui-skeleton__line--body"></div>
                    <div class="ui-skeleton__line ui-skeleton__line--body ui-skeleton__line--short"></div>
                    <div class="ui-skeleton__block"></div>
                </div>
            `;
        case "form":
            return `
                <div class="${classes}" aria-busy="true" aria-label="Loading form">
                    <div class="ui-skeleton__line ui-skeleton__line--label"></div>
                    <div class="ui-skeleton__block ui-skeleton__block--field"></div>
                    <div class="ui-skeleton__line ui-skeleton__line--label"></div>
                    <div class="ui-skeleton__block ui-skeleton__block--field"></div>
                    <div class="ui-skeleton__block ui-skeleton__block--button"></div>
                </div>
            `;
        case "card":
            return `
                <div class="${classes}" aria-busy="true" aria-label="Loading card">
                    <div class="ui-skeleton__line ui-skeleton__line--title"></div>
                    <div class="ui-skeleton__line ui-skeleton__line--body"></div>
                    <div class="ui-skeleton__line ui-skeleton__line--body ui-skeleton__line--short"></div>
                </div>
            `;
        default: {
            const rows = Array.from({ length: count }, () =>
                `<div class="ui-skeleton__row">
                    <div class="ui-skeleton__line ui-skeleton__line--body"></div>
                    <div class="ui-skeleton__line ui-skeleton__line--body ui-skeleton__line--short"></div>
                </div>`,
            ).join("");
            return `
                <div class="${classes}" aria-busy="true" aria-label="Loading list">
                    ${rows}
                </div>
            `;
        }
    }
}
