/**
 * Shared UI components mirroring locksmith's Qt toolkit.
 *
 * Each component returns a { html, setup(root) } object or a controller API,
 * following the same pattern as fortweb page modules.
 */

import { escapeHtml } from "./dom.js";

let floatingInputCounter = 0;

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

/**
 * Creates a modal dialog matching LocksmithDialog.
 *
 * @param {object} opts
 * @param {string}  [opts.title]
 * @param {string}  [opts.titleIcon]       - icon src path
 * @param {boolean} [opts.showClose=true]
 * @param {boolean} [opts.showDivider=true]
 * @param {string}  opts.content           - inner HTML
 * @param {string}  [opts.buttons]         - button row HTML
 * @param {boolean} [opts.showOverlay=false]
 * @returns {{ el: HTMLElement, show(): void, close(): void }}
 */
export function createDialog(opts) {
    const {
        title = "",
        titleIcon = "",
        showClose = true,
        showDivider = true,
        content = "",
        buttons = "",
        showOverlay = false,
        rootClassName = "",
        surfaceClassName = "",
    } = opts;

    const el = document.createElement("div");
    el.className = [
        "lk-dialog-root",
        showOverlay ? "lk-dialog-root--modal" : "lk-dialog-root--floating",
        rootClassName,
    ].filter(Boolean).join(" ");
    el.innerHTML = `
        ${showOverlay ? '<div class="lk-dialog-overlay"></div>' : ""}
        <div class="lk-dialog ${surfaceClassName}" role="dialog" aria-modal="${showOverlay ? "true" : "false"}">
            <div class="lk-dialog__container">
                ${title || titleIcon || showClose
            ? `<div class="lk-dialog__header">
                            ${titleIcon ? `<img class="lk-dialog__icon" src="${titleIcon}" alt="">` : ""}
                            <span class="lk-dialog__title" data-dialog-title></span>
                            <span class="lk-dialog__spacer"></span>
                            ${showClose ? `<button class="lk-dialog__close" aria-label="Close"><img src="./assets/icons/close.svg" alt=""></button>` : ""}
                        </div>`
            : ""
        }
                ${showDivider ? '<div class="lk-dialog__divider"></div>' : ""}
                <div class="lk-dialog__content">${content}</div>
                ${buttons ? `<div class="lk-dialog__buttons">${buttons}</div>` : ""}
            </div>
        </div>
    `;

    const titleEl = el.querySelector("[data-dialog-title]");
    if (titleEl) {
        titleEl.textContent = title;
    }

    function show() {
        document.body.appendChild(el);
        // Trigger reflow for animation
        el.offsetHeight;
        el.classList.add("is-visible");
    }

    function close() {
        el.remove();
    }

    // Wire close button & overlay click
    el.querySelector(".lk-dialog__close")?.addEventListener("click", close);
    el.querySelector(".lk-dialog-overlay")?.addEventListener("click", close);

    return { el, show, close };
}

// ---------------------------------------------------------------------------
// Vault Drawer
// ---------------------------------------------------------------------------

/**
 * Creates the right-side vault drawer matching VaultDrawer.
 *
 * @param {object} opts
 * @param {Array}  opts.vaults             - [{ id, alias }]
 * @param {Function} opts.onVaultClick     - (vault) => void
 * @param {Function} [opts.onNewVault]     - () => void
 * @returns {{ el: HTMLElement, open(): void, close(): void, refresh(vaults): void }}
 */
export function createVaultDrawer(opts) {
    const { onVaultClick, onNewVault } = opts;
    let vaults = [...opts.vaults];

    const el = document.createElement("div");
    el.className = "lk-drawer-root";
    el.innerHTML = `
        <div class="lk-drawer-overlay"></div>
        <aside class="lk-drawer" aria-label="Vault switcher" role="dialog" aria-modal="true">
            <div class="lk-drawer__header">
                <div class="lk-drawer__heading">
                    <img src="./assets/brand/SymbolLogo.svg" alt="" width="36" height="36">
                    <div>
                        <span class="lk-drawer__title">Vaults</span>
                        <p class="lk-drawer__subtitle">Switch vaults or start a new one.</p>
                    </div>
                </div>
                <button class="lk-drawer__close" type="button" aria-label="Close vault switcher">
                    <img src="./assets/icons/close.svg" alt="" width="18" height="18">
                </button>
            </div>
            <div class="lk-drawer__divider"></div>
            <button class="lk-drawer__new-vault" type="button">
                <img src="./assets/icons/add.svg" alt="" width="30" height="30">
                <span>Initialize New Vault</span>
            </button>
            <ul class="lk-drawer__list" role="list"></ul>
        </aside>
    `;

    const list = el.querySelector(".lk-drawer__list");
    let isOpen = false;

    function renderList(vaults) {
        list.replaceChildren(
            ...vaults.map((vault) => {
                const isCurrent = vault.locked === false;
                const item = document.createElement("li");
                item.className = `lk-drawer__item ${isCurrent ? "is-active" : ""}`.trim();
                item.dataset.vaultId = vault.id;
                item.setAttribute("aria-current", isCurrent ? "page" : "false");
                item.setAttribute("role", "button");
                item.tabIndex = 0;

                const icon = document.createElement("img");
                icon.src = "./assets/icons/vault.png";
                icon.alt = "";
                icon.width = 36;
                icon.height = 36;

                const copy = document.createElement("span");
                copy.className = "lk-drawer__item-copy";

                const heading = document.createElement("span");
                heading.className = "lk-drawer__item-heading";

                const label = document.createElement("span");
                label.className = "lk-drawer__item-title";
                label.textContent = vault.alias;

                heading.append(label);

                if (isCurrent) {
                    const status = document.createElement("span");
                    status.className = "lk-drawer__item-status";
                    status.textContent = "Current";
                    heading.append(status);
                }

                const meta = document.createElement("span");
                meta.className = "lk-drawer__item-meta";
                meta.textContent = `${vault.identifierCount ?? 0} identifiers · ${vault.remoteCount ?? 0} remotes`;

                copy.append(heading, meta);
                item.append(icon, copy);
                return item;
            }),
        );
    }

    function open() {
        if (isOpen) return;
        isOpen = true;
        document.body.appendChild(el);
        el.offsetHeight;
        el.classList.add("is-open");
    }

    function close() {
        if (!isOpen) return;
        isOpen = false;
        el.classList.remove("is-open");
        setTimeout(() => el.remove(), 300);
    }

    function refresh(nextVaults) {
        vaults = [...nextVaults];
        renderList(vaults);
    }

    // Overlay click closes
    el.querySelector(".lk-drawer-overlay").addEventListener("click", close);
    el.querySelector(".lk-drawer__close").addEventListener("click", close);

    // New vault button
    el.querySelector(".lk-drawer__new-vault").addEventListener("click", () => {
        close();
        onNewVault?.();
    });

    // Vault item clicks (delegate)
    list.addEventListener("click", (e) => {
        const item = e.target.closest(".lk-drawer__item");
        if (!item) return;
        const id = item.dataset.vaultId;
        const vault = vaults.find((v) => v.id === id);
        if (vault) onVaultClick(vault);
    });
    list.addEventListener("keydown", (event) => {
        const item = event.target.closest(".lk-drawer__item");
        if (!item || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        const vault = vaults.find((entry) => entry.id === item.dataset.vaultId);
        if (vault) onVaultClick(vault);
    });

    renderList(vaults);

    return { el, open, close, refresh };
}

// ---------------------------------------------------------------------------
// Floating Label Input
// ---------------------------------------------------------------------------

/**
 * Returns HTML for a floating-label input matching FloatingLabelLineEdit.
 *
 * @param {object} opts
 * @param {string} opts.label
 * @param {string} opts.name
 * @param {string} [opts.type="text"]
 * @param {boolean} [opts.password=false]
 * @returns {string} HTML
 */
export function floatingInputHtml({ label, name, type = "text", password = false }) {
    const inputType = password ? "password" : type;
    const inputId = `lk-field-${name}-${floatingInputCounter++}`;
    return `
        <div class="lk-float-field">
            <input class="lk-float-field__input" type="${inputType}" name="${escapeHtml(name)}" id="${escapeHtml(inputId)}" placeholder=" " autocomplete="off">
            <label class="lk-float-field__label" for="${escapeHtml(inputId)}">${escapeHtml(label)}</label>
            ${password ? `<button type="button" class="lk-float-field__toggle" data-toggle-password="${escapeHtml(name)}" aria-label="Toggle password visibility"><img src="./assets/icons/browse.svg" alt="" width="20" height="20"></button>` : ""}
        </div>
    `;
}

/**
 * Wire up floating-label password toggles within a root element.
 */
export function setupFloatingInputs(root) {
    root.querySelectorAll("[data-toggle-password]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const name = btn.dataset.togglePassword;
            const input = root.querySelector(`input[name="${name}"]`);
            if (!input) return;
            const isPassword = input.type === "password";
            input.type = isPassword ? "text" : "password";
        });
    });
}

// ---------------------------------------------------------------------------
// Paginated Table
// ---------------------------------------------------------------------------

/**
 * Renders a paginated table matching PaginatedTableWidget.
 *
 * @param {object} opts
 * @param {string} [opts.icon]              - header icon src
 * @param {string} opts.title               - header title
 * @param {string} [opts.searchPlaceholder] - search input placeholder
 * @param {string} [opts.addButtonText]     - text for add button
 * @param {Array<{key:string, label:string, width?:string, searchKey?:string}>} opts.columns
 * @param {Array<object>} opts.rows         - row data objects
 * @param {Array<{key:string, label:string, icon?:string}>} [opts.rowActions]
 * @param {number} [opts.itemsPerPage=10]
 * @returns {{ html: string, setup(root): void }}
 */
export function renderPaginatedTable(opts) {
    const {
        icon = "",
        title = "",
        titleTag = "h2",
        titleMetaHtml = "",
        collapseHeadingOnMobile = false,
        searchPlaceholder = "Search...",
        addButtonText = "",
        columns = [],
        rows = [],
        rowActions = [],
        itemsPerPage = 10,
        emptyTitle = "No Records Yet",
        emptyText = "Nothing has been stored for this view yet.",
    } = opts;

    const hasActions = rowActions.length > 0;
    const allColumns = hasActions ? [...columns, { key: "_actions", label: "Actions", width: "100px" }] : columns;
    const safeTitleTag = titleTag === "h1" ? "h1" : "h2";
    const sectionClassName = collapseHeadingOnMobile ? "lk-table-section lk-table-section--collapse-heading-mobile" : "lk-table-section";

    const html = `
        <section class="${sectionClassName}">
            <div class="lk-table-shell">
                <div class="lk-table-header">
                    <div class="lk-table-header__left">
                        ${icon ? `<img class="lk-table-header__icon" src="${icon}" alt="" width="32" height="32">` : ""}
                        <div class="lk-table-header__heading">
                            <${safeTitleTag} class="lk-table-header__title">${escapeHtml(title)}</${safeTitleTag}>
                            ${titleMetaHtml ? `<div class="lk-table-header__meta">${titleMetaHtml}</div>` : ""}
                        </div>
                    </div>
                    <div class="lk-table-header__right">
                        <div class="lk-search-bar">
                            <img class="lk-search-bar__icon" src="./assets/icons/search.svg" alt="" width="18" height="18">
                            <input type="text" class="lk-search-bar__input" placeholder="${escapeHtml(searchPlaceholder)}" data-table-search>
                            <button type="button" class="lk-search-bar__clear" data-table-search-clear aria-label="Clear search" hidden><img src="./assets/icons/close.svg" alt="" width="14" height="14"></button>
                        </div>
                        ${addButtonText
            ? `<button class="button button--primary lk-table-header__action" type="button" data-table-add><img src="./assets/icons/add.svg" alt="" width="18" height="18" style="filter:brightness(0) invert(1);"> ${escapeHtml(addButtonText)}</button>`
            : ""
        }
                    </div>
                </div>
                <div class="lk-table-wrap">
                    <table class="lk-table">
                        <thead>
                            <tr>
                                ${allColumns.map((col) => `<th${col.width ? ` style="width:${col.width}"` : ""} data-sort-col="${col.key}">${escapeHtml(col.label)}</th>`).join("")}
                            </tr>
                        </thead>
                        <tbody data-table-body></tbody>
                    </table>
                </div>
                <div class="lk-table-stack" data-table-stack></div>
                <div class="lk-table-footer">
                    <span class="lk-table-footer__count" data-table-count></span>
                    <div class="lk-table-footer__pagination" data-table-pagination></div>
                </div>
            </div>
        </section>
    `;

    function setup(root) {
        const searchInput = root.querySelector("[data-table-search]");
        const searchClear = root.querySelector("[data-table-search-clear]");
        const tbody = root.querySelector("[data-table-body]");
        const stack = root.querySelector("[data-table-stack]");
        const countEl = root.querySelector("[data-table-count]");
        const paginationEl = root.querySelector("[data-table-pagination]");
        const titleColumn = columns[0] || null;

        function displayValue(row, col) {
            const value = row[col.key] ?? "";
            if (col.html) {
                return escapeHtml(String(row[col.searchKey || col.key] ?? ""));
            }
            return escapeHtml(String(value));
        }

        function renderCard(row, rowIdx) {
            const titleValue = titleColumn
                ? escapeHtml(String(row[titleColumn.searchKey || titleColumn.key] ?? ""))
                : "Record";
            const detailFields = columns.slice(1).map((col) => `
                <div class="detail-item ${col.key === "lastEventDigest" ? "detail-item--span" : ""}">
                    <dt>${escapeHtml(col.label)}</dt>
                    <dd class="${col.key === "prefix" || col.key === "lastEventDigest" ? "mono" : ""}">${displayValue(row, col)}</dd>
                </div>
            `).join("");
            const actionsHtml = rowActions.length
                ? `<div class="stack-card__actions">
                    ${rowActions.map((action) => `
                        <button class="button button--ghost stack-card__action-button" type="button" data-action-key="${action.key}" data-row-idx="${rowIdx}">
                            ${action.icon ? `<img src="${action.icon}" alt="" width="16" height="16">` : ""}
                            <span>${escapeHtml(action.label)}</span>
                        </button>
                    `).join("")}
                </div>`
                : "";

            return `
                <article class="stack-card">
                    <div class="stack-card__header">
                        <div class="stack-card__title-block">
                            <span class="stack-card__eyebrow">${escapeHtml(titleColumn?.label || "Record")}</span>
                            <h3 class="stack-card__title">${titleValue}</h3>
                        </div>
                    </div>
                    <dl class="detail-grid stack-card__details">
                        ${detailFields}
                    </dl>
                    ${actionsHtml}
                </article>
            `;
        }

        let filteredRows = [...rows];
        let currentPage = 1;

        function filterRows(query) {
            const q = query.trim().toLowerCase();
            if (!q) {
                filteredRows = [...rows];
            } else {
                filteredRows = rows.filter((row) => {
                    return columns.some((col) => {
                        const val = row[col.searchKey || col.key];
                        return val != null && String(val).toLowerCase().includes(q);
                    });
                });
            }
            currentPage = 1;
            render();
        }

        function render() {
            const totalPages = Math.max(1, Math.ceil(filteredRows.length / itemsPerPage));
            if (currentPage > totalPages) currentPage = totalPages;

            const start = (currentPage - 1) * itemsPerPage;
            const pageRows = filteredRows.slice(start, start + itemsPerPage);

            if (!pageRows.length) {
                tbody.innerHTML = `
                    <tr class="lk-table__empty-row">
                        <td class="lk-table__empty-cell" colspan="${allColumns.length}">
                            <div class="empty-state empty-state--table">
                                <h2>${escapeHtml(emptyTitle)}</h2>
                                <p>${escapeHtml(emptyText)}</p>
                            </div>
                        </td>
                    </tr>
                `;
                stack.innerHTML = `
                    <div class="empty-state empty-state--table empty-state--stack">
                        <h2>${escapeHtml(emptyTitle)}</h2>
                        <p>${escapeHtml(emptyText)}</p>
                    </div>
                `;
                countEl.textContent = `${filteredRows.length} item${filteredRows.length === 1 ? "" : "s"}`;
                paginationEl.innerHTML = `
                    <span class="lk-page-label">Page 1 of 1</span>
                `;
                return;
            }

            tbody.innerHTML = pageRows
                .map((row, idx) => {
                    const cells = columns
                        .map((col) => {
                            const val = row[col.key] ?? "";
                            const mono = col.key === "prefix" ? ' class="mono"' : "";
                            const content = col.html ? val : (typeof val === "string" ? escapeHtml(val) : val);
                            return `<td${mono}>${content}</td>`;
                        })
                        .join("");

                    const actionCell = hasActions
                        ? `<td class="lk-table__actions-cell">
                            <button class="lk-skewer-btn" data-skewer-idx="${start + idx}" aria-label="Actions" aria-haspopup="menu" aria-expanded="false">
                                <img src="./assets/icons/more_vert.svg" alt="" width="20" height="20">
                            </button>
                            <div class="lk-skewer-menu" data-skewer-menu="${start + idx}">
                                ${rowActions.map((a) => `<button class="lk-skewer-menu__item" data-action-key="${a.key}" data-row-idx="${start + idx}">${a.icon ? `<img src="${a.icon}" alt="" width="18" height="18">` : ""} ${escapeHtml(a.label)}</button>`).join("")}
                            </div>
                        </td>`
                        : "";

                    return `<tr class="lk-table__row">${cells}${actionCell}</tr>`;
                })
                .join("");

            stack.innerHTML = pageRows
                .map((row, idx) => renderCard(row, start + idx))
                .join("");

            countEl.textContent = `${filteredRows.length} item${filteredRows.length === 1 ? "" : "s"}`;

            // Pagination controls
            paginationEl.innerHTML = `
                <button class="lk-page-btn" data-page-action="first" ${currentPage <= 1 ? "disabled" : ""}><img src="./assets/icons/first_page.svg" alt="First" width="18" height="18"></button>
                <button class="lk-page-btn" data-page-action="prev" ${currentPage <= 1 ? "disabled" : ""}><img src="./assets/icons/chevron_left.svg" alt="Previous" width="18" height="18"></button>
                <span class="lk-page-label">Page ${currentPage} of ${totalPages}</span>
                <button class="lk-page-btn" data-page-action="next" ${currentPage >= totalPages ? "disabled" : ""}><img src="./assets/icons/chevron_right.svg" alt="Next" width="18" height="18"></button>
                <button class="lk-page-btn" data-page-action="last" ${currentPage >= totalPages ? "disabled" : ""}><img src="./assets/icons/last_page.svg" alt="Last" width="18" height="18"></button>
            `;
        }

        // Search
        const syncSearchChrome = () => {
            const hasValue = Boolean(searchInput.value.trim());
            searchClear.hidden = !hasValue;
        };
        searchInput.addEventListener("input", () => {
            syncSearchChrome();
            filterRows(searchInput.value);
        });
        searchClear.addEventListener("click", () => {
            searchInput.value = "";
            syncSearchChrome();
            filterRows("");
        });

        // Pagination (delegate)
        paginationEl.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-page-action]");
            if (!btn || btn.disabled) return;
            const totalPages = Math.max(1, Math.ceil(filteredRows.length / itemsPerPage));
            switch (btn.dataset.pageAction) {
                case "first": currentPage = 1; break;
                case "prev": currentPage = Math.max(1, currentPage - 1); break;
                case "next": currentPage = Math.min(totalPages, currentPage + 1); break;
                case "last": currentPage = totalPages; break;
            }
            render();
        });

        // Skewer menu toggle (delegate)
        root.addEventListener("click", (e) => {
            const skewerBtn = e.target.closest(".lk-skewer-btn");
            if (skewerBtn) {
                const idx = skewerBtn.dataset.skewerIdx;
                const menu = root.querySelector(`[data-skewer-menu="${idx}"]`);
                // Close all other menus
                root.querySelectorAll(".lk-skewer-menu.is-open").forEach((m) => {
                    if (m !== menu) m.classList.remove("is-open");
                });
                root.querySelectorAll(".lk-skewer-btn[aria-expanded='true']").forEach((button) => {
                    if (button !== skewerBtn) {
                        button.setAttribute("aria-expanded", "false");
                    }
                });
                menu?.classList.toggle("is-open");
                skewerBtn.setAttribute("aria-expanded", menu?.classList.contains("is-open") ? "true" : "false");
                return;
            }

            // Action item click
            const actionBtn = e.target.closest(".lk-skewer-menu__item");
            if (actionBtn) {
                const rowIdx = parseInt(actionBtn.dataset.rowIdx, 10);
                const actionKey = actionBtn.dataset.actionKey;
                const menu = actionBtn.closest(".lk-skewer-menu");
                menu?.classList.remove("is-open");
                const trigger = menu?.previousElementSibling;
                if (trigger?.classList.contains("lk-skewer-btn")) {
                    trigger.setAttribute("aria-expanded", "false");
                }
                opts.onAction?.(filteredRows[rowIdx], actionKey);
                return;
            }

            const cardActionBtn = e.target.closest(".stack-card__action-button");
            if (cardActionBtn) {
                const rowIdx = parseInt(cardActionBtn.dataset.rowIdx, 10);
                const actionKey = cardActionBtn.dataset.actionKey;
                opts.onAction?.(filteredRows[rowIdx], actionKey);
                return;
            }

            // Close any open menus when clicking elsewhere
            root.querySelectorAll(".lk-skewer-menu.is-open").forEach((m) => m.classList.remove("is-open"));
            root.querySelectorAll(".lk-skewer-btn[aria-expanded='true']").forEach((button) => {
                button.setAttribute("aria-expanded", "false");
            });
        });

        // Add button
        root.querySelector("[data-table-add]")?.addEventListener("click", () => opts.onAdd?.());

        syncSearchChrome();
        render();
    }

    return { html, setup };
}

// ---------------------------------------------------------------------------
// Sidebar Menu Button (HTML helper)
// ---------------------------------------------------------------------------

/**
 * Returns HTML for a sidebar menu button matching MenuButton.
 *
 * @param {object} opts
 * @param {string} opts.icon  - icon src
 * @param {string} opts.label
 * @param {string} opts.href
 * @param {boolean} [opts.active=false]
 * @param {boolean} [opts.disabled=false]
 * @returns {string} HTML
 */
export function menuButtonHtml({ icon, label, href, active = false, disabled = false }) {
    if (disabled) {
        return `
            <span class="lk-menu-btn" aria-disabled="true">
                <img src="${icon}" alt="" width="32" height="32">
                <span class="lk-menu-btn__label">${escapeHtml(label)}</span>
            </span>
        `;
    }
    return `
        <a class="lk-menu-btn ${active ? "is-active" : ""}" href="${href}" aria-current="${active ? "page" : "false"}">
            <img src="${icon}" alt="" width="32" height="32">
            <span class="lk-menu-btn__label">${escapeHtml(label)}</span>
        </a>
    `;
}
