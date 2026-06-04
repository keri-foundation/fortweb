/**
 * View contract for Fortweb UI components.
 *
 * Every component follows the render/bind/destroy pattern:
 *   - render(props) returns an HTML string
 *   - bind(root, props) attaches event listeners and returns a cleanup function
 *   - destroy() is called implicitly by the cleanup function
 */

export interface ViewSpec<TProps = Record<string, unknown>> {
    render: (props: TProps) => string;
    bind?: (root: HTMLElement, props: TProps) => (() => void) | null;
}

export interface ViewInstance<TProps = Record<string, unknown>> {
    mount: (root: HTMLElement, props: TProps) => () => void;
}

/**
 * Define a reusable view from a render/bind spec.
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
export function defineView<TProps = Record<string, unknown>>(
    spec: ViewSpec<TProps>,
): ViewInstance<TProps> {
    return {
        mount(root: HTMLElement, props: TProps): () => void {
            root.innerHTML = spec.render(props);
            const cleanup = spec.bind?.(root, props) ?? null;
            return () => {
                cleanup?.();
            };
        },
    };
}

/**
 * Mount a view into a container, replacing any existing content.
 * Returns a cleanup function.
 */
export function mountView<TProps = Record<string, unknown>>(
    container: HTMLElement,
    view: ViewInstance<TProps>,
    props: TProps,
): () => void {
    return view.mount(container, props);
}
