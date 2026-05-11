import { kfWitnessesHref } from "../../app/router.js";
import { renderPaginatedTable } from "../../shared/components.js";
import { escapeHtml, toneClass } from "../../shared/dom.js";

function badgeHtml(label, tone = "neutral") {
    return `<span class="${toneClass(tone)}">${escapeHtml(label)}</span>`;
}

function renderWatcherTable(watchers) {
    const rows = watchers.map((watcher) => ({
        name: watcher.name || `KF Watcher ${watcher.eid.slice(0, 12)}`,
        watcherAid: watcher.eid,
        region: watcher.regionName || watcher.regionId || "—",
        hostedStatus: badgeHtml(watcher.hostedStatus || "created", "info"),
        localStatus: badgeHtml(watcher.localStatus || "Pending local connect", watcher.localStatusTone || "warning"),
        endpoint: watcher.url || "—",
    }));

    const table = renderPaginatedTable({
        icon: "./assets/icons/watcher.svg",
        title: "Watchers",
        titleTag: "h2",
        searchPlaceholder: "Search watchers...",
        columns: [
            { key: "name", label: "Name", width: "210px" },
            { key: "watcherAid", label: "Watcher AID", width: "320px" },
            { key: "region", label: "Region", width: "160px" },
            { key: "hostedStatus", label: "Hosted Status", width: "150px", html: true },
            { key: "localStatus", label: "Local Status", width: "160px", html: true },
            { key: "endpoint", label: "Endpoint", width: "280px" },
        ],
        rows,
        itemsPerPage: 10,
        emptyTitle: "No watchers yet",
        emptyText: "Monitoring details will appear here once the account has watcher data to show.",
    });

    return {
        render(container) {
            const root = document.createElement("div");
            root.dataset.kfWatcherTable = "true";
            root.innerHTML = table.html;
            container.append(root);
        },
        setup(root) {
            table.setup(root.querySelector("[data-kf-watcher-table]"));
        },
    };
}

function renderPlaceholder({ vault, bootstrapState }) {
    return {
        title: "KERI Foundation Watchers",
        html: `
            <section class="page-grid">
                <header class="page-header">
                    <div>
                        <h1>Watchers</h1>
                        <p>Set up your KERI Foundation account first, then come back here for hosted monitoring details.</p>
                    </div>
                </header>
                <section class="section-card">
                    <div class="empty-state">
                        <h2>No monitoring account yet</h2>
                        <p>Finish account setup from the Witnesses page before returning here.</p>
                        <div class="panel__actions">
                            <a class="button button--primary" href="${kfWitnessesHref(vault.id)}">Open Witnesses</a>
                        </div>
                    </div>
                </section>
            </section>
        `,
    };
}

export function renderWatcherOverviewPage({ vault, bootstrapState, watchers, watcherError }) {
    if (bootstrapState.account?.status !== "onboarded") {
        return renderPlaceholder({ vault, bootstrapState });
    }

    const table = renderWatcherTable(watchers);

    return {
        title: "KERI Foundation Watchers",
        render(container) {
            container.replaceChildren();

            const page = document.createElement("section");
            page.className = "page-grid page-grid--table";
            page.innerHTML = `
                <header class="page-header">
                    <div>
                        <p class="page-header__eyebrow">KERI Foundation</p>
                        <h1>Watchers</h1>
                        <p>Hosted monitoring connected for your KERI Foundation account.</p>
                    </div>
                </header>
            `;

            if (watcherError) {
                const warning = document.createElement("p");
                warning.className = "notice notice--warning";
                warning.textContent = watcherError;
                page.append(warning);
            }

            const tableSection = document.createElement("section");
            tableSection.className = "section-card section-card--tight page-table-stage";
            table.render(tableSection);
            page.append(tableSection);

            container.append(page);
        },
        setup(root) {
            table.setup(root);
        },
    };
}
