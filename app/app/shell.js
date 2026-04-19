import {
    identifiersHref,
    remotesHref,
    kfWitnessesHref,
    kfWatchersHref,
    settingsHref,
} from "./router.js";

/**
 * Centralized tab configuration.
 * The "Foundation" label is approval-gated; rename to "Network" here
 * when confirmed rather than searching across multiple files.
 *
 * @typedef {Object} TabConfig
 * @property {string} id
 * @property {string} label
 * @property {string} icon - inline SVG path data (24px viewBox)
 * @property {function(string): string} href
 * @property {function(string): boolean} isActive
 */

/** @type {ReadonlyArray<TabConfig>} */
const TAB_CONFIG = Object.freeze([
    {
        id: "identifiers",
        label: "Identifiers",
        icon: '<path d="M160-80q-33 0-56.5-23.5T80-160v-440q0-33 23.5-56.5T160-680h200v-120q0-33 23.5-56.5T440-880h80q33 0 56.5 23.5T600-800v120h200q33 0 56.5 23.5T880-600v440q0 33-23.5 56.5T800-80H160Zm0-80h640v-440H600q0 33-23.5 56.5T520-520h-80q-33 0-56.5-23.5T360-600H160v440Zm80-80h240v-18q0-17-9.5-31.5T444-312q-20-9-40.5-13.5T360-330q-23 0-43.5 4.5T276-312q-17 8-26.5 22.5T240-258v18Zm320-60h160v-60H560v60Zm-200-60q25 0 42.5-17.5T420-420q0-25-17.5-42.5T360-480q-25 0-42.5 17.5T300-420q0 25 17.5 42.5T360-360Zm200-60h160v-60H560v60ZM440-600h80v-200h-80v200Zm40 220Z"/>',
        href: identifiersHref,
        isActive: (name) => name === "identifiers" || name === "identifier-detail",
    },
    {
        id: "remotes",
        label: "Remotes",
        icon: '<path d="M15 8c0-2.21-1.79-4-4-4S7 5.79 7 8s1.79 4 4 4 4-1.79 4-4zm-2 0c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zM1 18v2h8v-2c0-2.66-5.33-4-8-4v2c2.03 0 5.13.86 6 1.92V18H1zm14 0v2h8v-2c0-2.66-5.33-4-8-4v2c2.03 0 5.13.86 6 1.92V18h-6zM1 8c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4S1 10.21 1 8zm2 0c0 1.1.9 2 2 2s2-.9 2-2-.9-2-2-2-2 .9-2 2zm16-4c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>',
        href: remotesHref,
        isActive: (name) => name === "remotes" || name === "remote-detail",
    },
    {
        id: "foundation",
        label: "Foundation",
        icon: '<path d="M557-518 387-688l57-56 113 113 227-226 56 56-283 283ZM320-220l278 76 238-74q-5-9-14.5-15.5T800-240H598q-27 0-43-2t-33-8l-93-31 22-78 81 27q17 5 40 8t68 4q0-11-6.5-21T618-354l-234-86h-64v220ZM80-80v-440h304q7 0 14 1.5t13 3.5l235 87q33 12 53.5 42t20.5 66h80q50 0 85 33t35 87v40L600-60l-280-78v58H80Zm80-80h80v-280h-80v280Z"/>',
        href: kfWitnessesHref,
        isActive: (name) => name === "kf-witnesses" || name === "kf-watchers",
    },
    {
        id: "settings",
        label: "Settings",
        icon: '<path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/>',
        href: settingsHref,
        isActive: (name) => name === "settings",
    },
]);

/**
 * Foundation sub-tab configuration for witnesses/watchers section tabs.
 * @type {ReadonlyArray<{id: string, label: string, href: function, isActive: function}>}
 */
const SECTION_TAB_CONFIG = Object.freeze([
    {
        id: "witnesses",
        label: "Witnesses",
        href: kfWitnessesHref,
        isActive: (name) => name === "kf-witnesses",
    },
    {
        id: "watchers",
        label: "Watchers",
        href: kfWatchersHref,
        isActive: (name) => name === "kf-watchers",
    },
]);

function tabIcon(pathData, viewBox) {
    return `<svg class="shell-tabbar__icon" xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="20" height="20" fill="currentColor" aria-hidden="true">${pathData}</svg>`;
}

function shellTabs(route, vaultId) {
    return `
        <nav class="shell-tabbar" aria-label="Vault navigation">
            ${TAB_CONFIG.map((tab) => {
                const active = tab.isActive(route.name);
                const viewBox = tab.id === "identifiers" || tab.id === "foundation"
                    ? "0 -960 960 960"
                    : "0 0 24 24";
                return `
                <a class="shell-tabbar__link ${active ? "is-active" : ""}"
                   href="${tab.href(vaultId)}"
                   aria-current="${active ? "page" : "false"}">
                    ${tabIcon(tab.icon, viewBox)}
                    <span>${tab.label}</span>
                </a>
            `;
            }).join("")}
        </nav>
    `;
}

function sectionTabs(route, vaultId) {
    const isFoundationRoute = route.name === "kf-witnesses" || route.name === "kf-watchers";
    if (!isFoundationRoute) {
        return "";
    }

    return `
        <nav class="shell-section-tabs" aria-label="Foundation navigation">
            ${SECTION_TAB_CONFIG.map((tab) => {
                const active = tab.isActive(route.name);
                return `
                <a class="shell-section-tabs__link ${active ? "is-active" : ""}"
                   href="${tab.href(vaultId)}"
                   aria-current="${active ? "page" : "false"}">
                    ${tab.label}
                </a>
            `;
            }).join("")}
        </nav>
    `;
}

/**
 * @typedef {Object} ShellProps
 * @property {Object} route
 * @property {Object} page
 * @property {Object} state
 * @property {Object|null} vault
 * @property {Object} actions
 */

/**
 * @param {HTMLElement} root
 * @param {ShellProps} props
 */
export function renderShell(root, { route, page, state, vault, actions }) {
    const isVaultShell = route.shellMode === "vault" && vault;

    root.innerHTML = `
        <div class="shell ${isVaultShell ? "shell--vault" : "shell--home"}">
            ${isVaultShell ? `
                <header class="shell-header">
                    <div class="shell-header__leading">
                        <button class="shell-header__eyebrow" type="button" data-action="toggle-drawer" aria-label="Switch vault">
                            <span>${vault.alias}</span>
                            <svg class="shell-header__chevron" width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 1l4 4 4-4"/></svg>
                        </button>
                        <h1 class="shell-header__title">${page.title}</h1>
                    </div>
                    <button class="icon-button shell-header__lock" data-action="lock-vault" aria-label="Lock vault">
                        <img src="./assets/icons/lock.svg" alt="">
                    </button>
                </header>
            ` : ""}
            <div class="shell__body ${isVaultShell ? "shell__body--vault" : "shell__body--home"}">
                <main class="shell__content ${isVaultShell ? "shell__content--vault" : "shell__content--home"}">
                    <div class="shell__content-inner">
                        ${isVaultShell ? sectionTabs(route, vault.id) : ""}
                        <div data-page-content></div>
                    </div>
                </main>
            </div>
            ${isVaultShell ? shellTabs(route, vault.id) : ""}
        </div>
    `;

    const pageRoot = root.querySelector("[data-page-content]");
    pageRoot.replaceChildren();
    if (typeof page.render === "function") {
        page.render(pageRoot);
    } else {
        pageRoot.innerHTML = page.html;
    }
    document.title = `${page.title} | Fort`;

    root.querySelectorAll("[data-action='toggle-drawer']").forEach((button) => {
        button.addEventListener("click", () => actions.toggleDrawer?.());
    });

    root.querySelectorAll("[data-action='lock-vault']").forEach((button) => {
        button.addEventListener("click", async () => {
            if (!vault) return;
            await actions.lockVault(vault.id);
        });
    });

    page.setup?.(pageRoot);
}
