import { identifierDetailHref } from "../../app/router.js";
import { renderPaginatedTable } from "../../shared/components.js";
import { escapeHtml } from "../../shared/dom.js";
import { createModal } from "../../ui/composites/modal.js";
import { showToast } from "../../ui/composites/toast.js";
import { fieldTextHtml } from "../../ui/primitives/field-text.js";

interface VaultRecord {
    id: string;
}

interface IdentifierRecord {
    aid: string;
    alias: string;
    prefix: string;
    sequenceNumber: number | string;
    witnessSummary: string;
    lastEventDigest: string;
}

interface IdentifierTableRow {
    alias: string;
    aliasLink: string;
    prefix: string;
    sequenceNumber: number | string;
    witnessSummary: string;
    lastEventDigest: string;
    _raw: IdentifierRecord;
}

interface IdentifiersPageProps {
    vault: VaultRecord;
    identifiers: IdentifierRecord[];
    onCreateIdentifier(alias: string): Promise<void>;
}

function queryButton(root: ParentNode, selector: string): HTMLButtonElement | null {
    return root.querySelector(selector) as HTMLButtonElement | null;
}

function queryElement(root: ParentNode, selector: string): HTMLElement | null {
    return root.querySelector(selector) as HTMLElement | null;
}

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

function createIdentifierDialog(onCreateIdentifier: IdentifiersPageProps["onCreateIdentifier"]): void {
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
    if (!(root instanceof HTMLElement)) {
        return;
    }

    const form = root.querySelector("[data-create-identifier-form]");
    const statusLine = queryElement(root, "[data-create-identifier-status]");
    const submitBtn = queryButton(root, "[data-action='submit']");
    const cancelBtn = queryButton(root, "[data-action='cancel']");

    if (!(form instanceof HTMLFormElement) || !statusLine || !submitBtn) {
        return;
    }

    cancelBtn?.addEventListener("click", () => modal.close());

    async function submit(): Promise<void> {
        const input = form.querySelector("input");
        const alias = input instanceof HTMLInputElement ? input.value.trim() : "";

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
            statusLine.textContent = errorMessage(error, "Identifier creation failed.");
        }
    }

    submitBtn.addEventListener("click", () => {
        void submit();
    });
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        void submit();
    });
}

export function renderIdentifiersPage({ vault, identifiers, onCreateIdentifier }: IdentifiersPageProps) {
    const identifierRows: IdentifierTableRow[] = identifiers.map((identifier) => ({
        alias: identifier.alias,
        aliasLink: `<a href="${identifierDetailHref(vault.id, identifier.aid)}">${escapeHtml(identifier.alias)}</a>`,
        prefix: identifier.prefix,
        sequenceNumber: identifier.sequenceNumber,
        witnessSummary: identifier.witnessSummary,
        lastEventDigest: identifier.lastEventDigest,
        _raw: identifier,
    }));

    const columns = [
        { key: "aliasLink", label: "Alias", width: "220px", searchKey: "alias", html: true },
        { key: "prefix", label: "Prefix", width: "310px" },
        { key: "sequenceNumber", label: "Seq No.", width: "110px" },
        { key: "witnessSummary", label: "Witnesses", width: "160px" },
        { key: "lastEventDigest", label: "Last Event SAID", width: "280px" },
    ];

    const identifierTable = renderPaginatedTable({
        icon: "./assets/icons/identifiers.png",
        title: "Local Identifiers",
        collapseHeadingOnMobile: true,
        searchPlaceholder: "Search...",
        addButtonText: "Add Identifier",
        columns,
        rows: identifierRows,
        rowActions: [{ key: "view", label: "View", icon: "./assets/icons/browse.svg" }],
        itemsPerPage: 10,
        emptyTitle: "No Local Identifiers Yet",
        emptyText: "Create a local identifier from this route to persist browser-safe AID state in the selected vault.",
        onAdd() {
            createIdentifierDialog(onCreateIdentifier);
        },
        onAction(row: IdentifierTableRow, actionKey: string) {
            if (actionKey === "view") {
                window.location.hash = identifierDetailHref(vault.id, row._raw.aid);
            }
        },
    });

    return {
        title: "Identifiers",
        render(container: HTMLElement): void {
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
        setup(root: HTMLElement): void {
            identifierTable.setup(queryElement(root, "[data-identifiers-table]"));
        },
    };
}