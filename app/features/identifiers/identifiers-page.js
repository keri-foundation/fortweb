import { identifierDetailHref } from "../../app/router.js";
import { renderPaginatedTable } from "../../shared/components.js";
import { escapeHtml } from "../../shared/dom.js";
import { createModal } from "../../ui/composites/modal.js";
import { showToast } from "../../ui/composites/toast.js";
import { fieldTextHtml } from "../../ui/primitives/field-text.js";

/**
 * @typedef {Object} IdentifiersPageProps
 * @property {Object} vault
 * @property {Array<Object>} identifiers
 * @property {function(string): Promise<void>} onCreateIdentifier
 */

function createIdentifierDialog(onCreateIdentifier) {
    const modal = createModal({
        title: "Create Identifier",
        body: `
            <form data-create-identifier-form>
                ${fieldTextHtml({ id: "create-id-alias", label: "Alias", placeholder: "e.g. my-first-aid", required: true })}
                <p class="status-line" data-create-identifier-status></p>
            </form>
        `,
        actions: [
            { label: "Cancel", tone: "ghost", dataAction: "cancel" },
            { label: "Create", tone: "primary", dataAction: "submit" },
        ],
    });

    modal.open();

    const root = document.querySelector("[role='dialog'][aria-label='Create Identifier']");
    if (!root) return;

    const form = root.querySelector("[data-create-identifier-form]");
    const statusLine = root.querySelector("[data-create-identifier-status]");
    const submitBtn = root.querySelector("[data-action='submit']");
    const cancelBtn = root.querySelector("[data-action='cancel']");

    cancelBtn?.addEventListener("click", () => modal.close());

    async function submit() {
        const input = form.querySelector("input");
        const alias = input?.value?.trim() || "";

        if (!alias) {
            statusLine.textContent = "Alias is required.";
            return;
        }

        submitBtn.disabled = true;
        statusLine.textContent = "";

        try {
            await onCreateIdentifier(alias);
            modal.close();
            showToast({ message: `Identifier "${alias}" created.`, tone: "success" });
        } catch (error) {
            submitBtn.disabled = false;
            statusLine.textContent = error.message || "Identifier creation failed.";
        }
    }

    submitBtn?.addEventListener("click", submit);
    form?.addEventListener("submit", (event) => {
        event.preventDefault();
        submit();
    });
}

/**
 * @param {IdentifiersPageProps} props
 */
export function renderIdentifiersPage({ vault, identifiers, onCreateIdentifier }) {
    const identifierRows = identifiers.map((identifier) => ({
        alias: identifier.alias,
        aliasLink: `<a href="${identifierDetailHref(vault.id, identifier.aid)}">${escapeHtml(identifier.alias)}</a>`,
        prefix: identifier.prefix,
        sequenceNumber: identifier.sequenceNumber,
        witnessSummary: identifier.witnessSummary,
        lastEventDigest: identifier.lastEventDigest,
        _raw: identifier,
    }));

    const identifierTable = renderPaginatedTable({
        icon: "./assets/icons/identifiers.png",
        title: "Local Identifiers",
        collapseHeadingOnMobile: true,
        searchPlaceholder: "Search...",
        addButtonText: "Add Identifier",
        columns: [
            { key: "aliasLink", label: "Alias", width: "220px", searchKey: "alias", html: true },
            { key: "prefix", label: "Prefix", width: "310px" },
            { key: "sequenceNumber", label: "Seq No.", width: "110px" },
            { key: "witnessSummary", label: "Witnesses", width: "160px" },
            { key: "lastEventDigest", label: "Last Event SAID", width: "280px" },
        ],
        rows: identifierRows,
        rowActions: [{ key: "view", label: "View", icon: "./assets/icons/browse.svg" }],
        itemsPerPage: 10,
        emptyTitle: "No Local Identifiers Yet",
        emptyText: "Create a local identifier from this route to persist browser-safe AID state in the selected vault.",
        onAdd() {
            createIdentifierDialog(onCreateIdentifier);
        },
        onAction(row, actionKey) {
            if (actionKey === "view") {
                window.location.hash = identifierDetailHref(vault.id, row._raw.aid);
            }
        },
    });

    return {
        title: "Identifiers",
        render(container) {
            container.replaceChildren();

            const page = document.createElement("section");
            page.className = "page-grid page-grid--table";

            const section = document.createElement("section");
            section.className = "section-card section-card--tight page-table-stage";

            const tableRoot = document.createElement("div");
            tableRoot.dataset.identifiersTable = "true";
            tableRoot.innerHTML = identifierTable.html;

            section.append(tableRoot);
            page.append(section);
            container.append(page);
        },
        setup(root) {
            identifierTable.setup(root.querySelector("[data-identifiers-table]"));
        },
    };
}
