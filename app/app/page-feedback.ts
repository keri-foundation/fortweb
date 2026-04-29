import { homeHref } from "./router.js";
import { renderShell } from "./shell.js";

export interface PageRecord {
    title: string;
    html?: string;
    render?(container: HTMLElement): void;
    setup?(root: HTMLElement): void;
}

type ShellProps = Parameters<typeof renderShell>[1];

type NotFoundRouteRecord = ShellProps["route"] & {
    path: string;
    navMode?: string;
};

interface NotFoundRouteContext {
    actions: ShellProps["actions"];
    root: HTMLElement;
    route: NotFoundRouteRecord;
    state: ShellProps["state"];
    vault: ShellProps["vault"];
}

export function renderNotFoundPage(path: string): PageRecord {
    return {
        title: "Route Not Found",
        render(container: HTMLElement): void {
            container.replaceChildren();

            const section = document.createElement("section");
            section.className = "placeholder-card";

            const heading = document.createElement("h2");
            heading.textContent = "Route Not Found";

            const copy = document.createElement("p");
            copy.className = "muted";
            copy.append("No route matches ");
            const code = document.createElement("code");
            code.textContent = path;
            copy.append(code);
            copy.append(".");

            const actionsRow = document.createElement("div");
            actionsRow.className = "panel__actions";

            const link = document.createElement("a");
            link.className = "button button--primary";
            link.href = homeHref();
            link.textContent = "Back to Vaults";

            actionsRow.append(link);
            section.append(heading, copy, actionsRow);
            container.append(section);
        },
    };
}

export function renderErrorPage(error: { message?: string } | null | undefined): PageRecord {
    return {
        title: "Runtime Error",
        render(container: HTMLElement): void {
            container.replaceChildren();

            const section = document.createElement("section");
            section.className = "placeholder-card";

            const heading = document.createElement("h2");
            heading.textContent = "Runtime Error";

            const copy = document.createElement("p");
            copy.className = "muted";
            copy.textContent = error?.message || "An unexpected runtime error occurred.";

            const actionsRow = document.createElement("div");
            actionsRow.className = "panel__actions";

            const link = document.createElement("a");
            link.className = "button button--primary";
            link.href = homeHref();
            link.textContent = "Back to Vaults";

            actionsRow.append(link);
            section.append(heading, copy, actionsRow);
            container.append(section);
        },
    };
}

export function renderNotFoundRoute({ actions, root, route, state, vault }: NotFoundRouteContext): void {
    renderShell(root, {
        route: vault ? route : { ...route, shellMode: "home", navMode: "none" },
        page: renderNotFoundPage(route.path),
        state,
        vault,
        actions,
    });
}