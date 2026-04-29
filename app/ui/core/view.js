/**
 * View contract for Fortweb UI components.
 *
 * Every component follows the render/bind/destroy pattern:
 *   - render(props) returns an HTML string
 *   - bind(root, props) attaches event listeners and returns a cleanup function
 *   - destroy() is called implicitly by the cleanup function
 *
 * @typedef {Object} ViewSpec
 * @property {function(Object): string} render
 * @property {function(HTMLElement, Object): (function|null)} [bind]
 *
 * @typedef {Object} ViewInstance
 * @property {function(HTMLElement, Object): function} mount
 */

/**
 * Define a reusable view from a render/bind spec.
 *
 * @param {ViewSpec} spec
 * @returns {ViewInstance}
 *
 * @example
 * const MyCard = defineView({
 *     render({ title, body }) {
 *         return `<div class="card"><h2>${title}</h2><p>${body}</p></div>`;
 *     },
 *     bind(root, { onAction }) {
 *         const btn = root.querySelector("[data-action]");
 *         const handler = () => onAction?.();
 *         btn?.addEventListener("click", handler);
 *         return () => btn?.removeEventListener("click", handler);
 *     },
 * });
 *
 * const cleanup = MyCard.mount(container, { title: "Hi", body: "..." });
 * // later: cleanup();
 */
export function defineView({ render, bind }) {
    return {
        mount(root, props) {
            root.innerHTML = render(props);
            const cleanup = bind?.(root, props) ?? null;
            return () => {
                cleanup?.();
            };
        },
    };
}

/**
 * Mount a view into a container, replacing any existing content.
 * Returns a cleanup function.
 *
 * @param {HTMLElement} container
 * @param {ViewInstance} view
 * @param {Object} props
 * @returns {function} cleanup
 */
export function mountView(container, view, props) {
    return view.mount(container, props);
}
