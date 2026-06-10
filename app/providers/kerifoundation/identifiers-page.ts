import { renderPaginatedTable } from "../../shared/components.js";

interface BootstrapState {
    account?: {
        accountAid?: string;
        accountAlias?: string;
    };
}

interface Identifier {
    aid: string;
    alias?: string;
    prefix?: string;
    sequenceNumber?: number | string;
    witnessSummary?: string;
}

interface AccountIdentifierRow {
    alias: string;
    prefix: string;
    sequenceNumber: number | string;
    witnessSummary: string;
}

interface KfIdentifiersPageProps {
    bootstrapState: BootstrapState;
    identifiers: Identifier[];
}

interface PageRecord {
    title: string;
    render: (container: HTMLElement) => void;
    setup: (root: HTMLElement | null) => void;
}

function accountIdentifierRows(bootstrapState: BootstrapState, identifiers: Identifier[]): AccountIdentifierRow[] {
    const account = bootstrapState.account || {};
    const matchedIdentifier = identifiers.find((identifier) => identifier.aid === account.accountAid) || null;

    if (!account.accountAid && !matchedIdentifier) {
        return [];
    }

    return [
        {
            alias: matchedIdentifier?.alias || account.accountAlias || "KERI Foundation Account",
            prefix: matchedIdentifier?.prefix || account.accountAid || "—",
            sequenceNumber: matchedIdentifier?.sequenceNumber ?? "—",
            witnessSummary: matchedIdentifier?.witnessSummary || "Managed account",
        },
    ];
}

export function renderKfIdentifiersPage({ bootstrapState, identifiers }: KfIdentifiersPageProps): PageRecord {
    const rows = accountIdentifierRows(bootstrapState, identifiers);

    const table = renderPaginatedTable({
        icon: "./assets/icons/identifiers.png",
        title: "KERI Foundation Identifiers",
        titleTag: "h2",
        searchPlaceholder: "Search...",
        columns: [
            { key: "alias", label: "Alias", width: "220px" },
            { key: "prefix", label: "Prefix", width: "320px" },
            { key: "sequenceNumber", label: "Seq No.", width: "110px" },
            { key: "witnessSummary", label: "Witnesses", width: "160px" },
        ],
        rows,
        itemsPerPage: 10,
        emptyTitle: "No KERI Foundation Identifier Yet",
        emptyText: "The wallet identity attached to this KERI Foundation account is not available in this vault.",
    });

    return {
        title: "KERI Foundation Identifiers",
        render(container: HTMLElement): void {
            container.replaceChildren();

            const page = document.createElement("section");
            page.className = "page-grid page-grid--table";
            page.innerHTML = `
                <header class="page-header">
                    <div>
                        <p class="page-header__eyebrow">KERI Foundation</p>
                        <h1>Identifiers</h1>
                        <p>The wallet identity currently attached to your KERI Foundation account.</p>
                    </div>
                </header>
            `;

            const tableSection = document.createElement("section");
            tableSection.className = "section-card section-card--tight page-table-stage";

            const tableRoot = document.createElement("div");
            tableRoot.dataset.kfIdentifiersTable = "true";
            tableRoot.innerHTML = table.html;

            tableSection.append(tableRoot);
            page.append(tableSection);
            container.append(page);
        },
        setup(root: HTMLElement | null): void {
            table.setup(root?.querySelector("[data-kf-identifiers-table]") ?? null);
        },
    };
}
