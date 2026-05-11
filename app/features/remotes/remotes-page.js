import { remoteDetailHref } from "../../app/router.js";
import {
    createDialog,
    floatingInputHtml,
    renderPaginatedTable,
    setupFloatingInputs,
} from "../../shared/components.js";
import { escapeHtml } from "../../shared/dom.js";

function createResolveRemoteDialog(onResolveRemote) {
    const dialog = createDialog({
        title: "Add Remote Identifier",
        showClose: true,
        showDivider: true,
        content: `
            <form class="lk-form-stack" data-resolve-remote-form>
                ${floatingInputHtml({ label: "Blind OOBI URL", name: "oobiUrl" })}
                ${floatingInputHtml({ label: "Alias", name: "alias" })}
                <p class="status-line" data-resolve-remote-status></p>
            </form>
        `,
        buttons: `
            <button class="button button--secondary" type="button" data-dialog-cancel>Cancel</button>
            <button class="button button--primary" type="button" data-dialog-submit>Resolve OOBI</button>
        `,
        showOverlay: false,
    });

    dialog.show();
    setupFloatingInputs(dialog.el);

    const form = dialog.el.querySelector("[data-resolve-remote-form]");
    const statusLine = dialog.el.querySelector("[data-resolve-remote-status]");
    const submitBtn = dialog.el.querySelector("[data-dialog-submit]");
    const cancelBtn = dialog.el.querySelector("[data-dialog-cancel]");

    cancelBtn.addEventListener("click", () => dialog.close());

    async function submit() {
        const formData = new FormData(form);
        submitBtn.disabled = true;
        statusLine.textContent = "";

        try {
            await onResolveRemote(
                String(formData.get("oobiUrl") || ""),
                String(formData.get("alias") || ""),
            );
            dialog.close();
        } catch (error) {
            submitBtn.disabled = false;
            statusLine.textContent = error.message || "OOBI resolution failed.";
        }
    }

    submitBtn.addEventListener("click", submit);
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        submit();
    });
}

function createRemoteEditDialog(remote, onUpdateRemote) {
    const dialog = createDialog({
        title: `Edit ${remote.alias}`,
        showClose: true,
        showDivider: true,
        content: `
            <form class="lk-form-stack" data-edit-remote-form>
                ${floatingInputHtml({ label: "Alias", name: "alias" })}
                ${floatingInputHtml({ label: "Organization", name: "org" })}
                ${floatingInputHtml({ label: "Note", name: "note" })}
                <p class="status-line" data-edit-remote-status></p>
            </form>
        `,
        buttons: `
            <button class="button button--secondary" type="button" data-dialog-cancel>Cancel</button>
            <button class="button button--primary" type="button" data-dialog-submit>Save</button>
        `,
        showOverlay: false,
    });

    dialog.show();
    setupFloatingInputs(dialog.el);

    const form = dialog.el.querySelector("[data-edit-remote-form]");
    const aliasInput = form.querySelector("input[name='alias']");
    const orgInput = form.querySelector("input[name='org']");
    const noteInput = form.querySelector("input[name='note']");
    const statusLine = dialog.el.querySelector("[data-edit-remote-status]");
    const submitBtn = dialog.el.querySelector("[data-dialog-submit]");
    const cancelBtn = dialog.el.querySelector("[data-dialog-cancel]");

    aliasInput.value = remote.alias ?? "";
    orgInput.value = remote.org ?? "";
    noteInput.value = remote.note ?? "";

    cancelBtn.addEventListener("click", () => dialog.close());

    async function submit() {
        const formData = new FormData(form);
        submitBtn.disabled = true;
        statusLine.textContent = "";

        try {
            await onUpdateRemote(remote.aid, {
                alias: String(formData.get("alias") || ""),
                org: String(formData.get("org") || ""),
                note: String(formData.get("note") || ""),
            });
            dialog.close();
        } catch (error) {
            submitBtn.disabled = false;
            statusLine.textContent = error.message || "Remote update failed.";
        }
    }

    submitBtn.addEventListener("click", submit);
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        submit();
    });
}

function applyRemoteFilter(remotes, filter) {
    if (filter === "transferable") {
        return remotes.filter((remote) => remote.transferable);
    }
    if (filter === "non-transferable") {
        return remotes.filter((remote) => !remote.transferable);
    }
    return remotes;
}

function filterButton(label, value, current) {
    return `
        <button
            class="lk-filter-chip ${current === value ? "is-active" : ""}"
            type="button"
            data-remote-filter="${value}"
            aria-pressed="${current === value ? "true" : "false"}"
        >
            ${label}
        </button>
    `;
}

export function renderRemotesPage({
    vault,
    remotes,
    filter,
    onResolveRemote,
    onUpdateRemote,
    onFilterChange,
}) {
    const filteredRemotes = applyRemoteFilter(remotes, filter);

    const remoteRows = filteredRemotes.map((remote) => ({
        alias: remote.alias,
        aliasLink: `<a href="${remoteDetailHref(vault.id, remote.aid)}">${escapeHtml(remote.alias)}</a>`,
        prefix: remote.prefix,
        sequenceNumber: remote.sequenceNumber == null ? "Not resolved" : String(remote.sequenceNumber),
        transferability: remote.transferability,
        rolesLabel: remote.rolesLabel,
        status: remote.status,
        _raw: remote,
    }));

    const remotesTable = renderPaginatedTable({
        icon: "./assets/icons/remoteIds.png",
        title: "Remote Identifiers",
        titleTag: "h1",
        titleMetaHtml: `
            <div class="lk-inline-filter" role="group" aria-label="Remote identifier filter">
                ${filterButton("All", "all", filter)}
                ${filterButton("Transferable", "transferable", filter)}
                ${filterButton("Non-transferable", "non-transferable", filter)}
            </div>
        `,
        searchPlaceholder: "Search...",
        addButtonText: "Add Remote Identifier",
        columns: [
            { key: "aliasLink", label: "Alias", width: "210px", searchKey: "alias", html: true },
            { key: "prefix", label: "Prefix", width: "320px" },
            { key: "sequenceNumber", label: "Seq No.", width: "110px" },
            { key: "transferability", label: "Type", width: "150px" },
            { key: "rolesLabel", label: "Roles", width: "180px" },
            { key: "status", label: "Status", width: "110px" },
        ],
        rows: remoteRows,
        rowActions: [
            { key: "view", label: "View", icon: "./assets/icons/browse.svg" },
            { key: "edit", label: "Edit", icon: "./assets/icons/edit.svg" },
        ],
        itemsPerPage: 10,
        emptyTitle: "No Remote Identifiers Yet",
        emptyText: "Add a remote identifier by resolving a blind OOBI from this route.",
        onAdd() {
            createResolveRemoteDialog(onResolveRemote);
        },
        onAction(row, actionKey) {
            if (actionKey === "view") {
                window.location.hash = remoteDetailHref(vault.id, row._raw.aid);
                return;
            }

            if (actionKey === "edit") {
                createRemoteEditDialog(row._raw, onUpdateRemote);
            }
        },
    });

    return {
        title: "Remote Identifiers",
        render(container) {
            container.replaceChildren();

            const page = document.createElement("section");
            page.className = "page-grid page-grid--table";

            const section = document.createElement("section");
            section.className = "section-card section-card--tight page-table-stage";

            const tableRoot = document.createElement("div");
            tableRoot.dataset.remotesTable = "true";
            tableRoot.innerHTML = remotesTable.html;

            section.append(tableRoot);
            page.append(section);
            container.append(page);
        },
        setup(root) {
            remotesTable.setup(root.querySelector("[data-remotes-table]"));
            root.querySelectorAll("[data-remote-filter]").forEach((button) => {
                button.addEventListener("click", () => {
                    const nextFilter = button.dataset.remoteFilter || "all";
                    if (nextFilter !== filter) {
                        onFilterChange(nextFilter);
                    }
                });
            });
        },
    };
}
