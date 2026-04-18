import { kfWitnessesHref } from "../../app/router.js";
import { renderPaginatedTable } from "../../shared/components.js";
import { escapeHtml, toneClass } from "../../shared/dom.js";
import { announce } from "../../ui/core/a11y.js";
import { emptyStateHtml } from "../../ui/composites/empty-state.js";
import { showToast } from "../../ui/composites/toast.js";
import { buttonHtml } from "../../ui/primitives/button.js";

function badgeHtml(label, tone = "neutral") {
    return `<span class="${toneClass(tone)}">${escapeHtml(label)}</span>`;
}

function detailItem(label, value) {
    const wrapper = document.createElement("div");
    wrapper.className = "detail-item";

    const term = document.createElement("dt");
    term.textContent = label;

    const description = document.createElement("dd");
    description.textContent = value;

    wrapper.append(term, description);
    return wrapper;
}

function renderWatcherTable(watchers) {
    const rows = watchers.map((watcher) => ({
        name: watcher.name || `KF Watcher ${watcher.eid.slice(0, 12)}`,
        watcherAid: watcher.eid,
        region: watcher.regionName || watcher.regionId || "\u2014",
        hostedStatus: badgeHtml(watcher.hostedStatus || "created", "info"),
        localStatus: badgeHtml(watcher.localStatus || "Pending local connect", watcher.localStatusTone || "warning"),
        endpoint: watcher.url || "\u2014",
    }));

    const table = renderPaginatedTable({
        icon: "./assets/icons/watcher.svg",
        title: "Hosted Watchers",
        titleTag: "h2",
        searchPlaceholder: "Search hosted watchers...",
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
        emptyTitle: "No Hosted Watcher Rows",
        emptyText:
            "This KF account is onboarded locally, but the boot service did not return any watcher rows yet.",
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
    const bootUrl = bootstrapState.bootUrl || "http://127.0.0.1:9723";

    return {
        title: "KERI Foundation Watchers",
        html: `
            <section class="page-grid">
                <header class="page-header">
                    <div>
                        <h1>Watchers</h1>
                        <p>
                            Hosted watcher rows only become truthful after this vault completes the KF witness onboarding flow.
                        </p>
                    </div>
                </header>
                <section class="section-card">
                    ${emptyStateHtml({
                        title: "No Hosted Watcher Account Yet",
                        message: `Start from the Witnesses route, connect Fortweb to ${bootUrl}, and complete one hosted onboarding run before returning here.`,
                        iconSrc: "./assets/icons/watcher.svg",
                        primaryActionHtml: `<a class="button button--primary" href="${kfWitnessesHref(vault.id)}">Open Witnesses</a>`,
                    })}
                </section>
            </section>
        `,
    };
}

/**
 * @typedef {Object} WatcherOverviewProps
 * @property {Object} vault
 * @property {Object} bootstrapState
 * @property {Array<Object>} watchers
 * @property {string} [watcherError]
 * @property {function(): Promise<void>} onRefreshStatuses
 */

/**
 * @param {WatcherOverviewProps} props
 */
export function renderWatcherOverviewPage({ vault, bootstrapState, watchers, watcherError, onRefreshStatuses }) {
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
                        <h1>Watchers</h1>
                        <p>
                            Hosted watcher rows are boot-backed account data. Manual status refresh stays explicit in this first Fortweb slice.
                        </p>
                    </div>
                    <div class="page-header__actions page-header__actions--stacked">
                        ${buttonHtml({ label: "Refresh Status", tone: "secondary", dataAction: "refresh-watchers" })}
                        <p class="page-header__note">Refresh calls the approved-account watcher status route for each hosted watcher.</p>
                    </div>
                </header>
            `;

            const summaryCard = document.createElement("section");
            summaryCard.className = "section-card section-card--summary";
            const summary = document.createElement("dl");
            summary.className = "detail-grid summary-grid";
            summary.append(
                detailItem("Account Alias", bootstrapState.account.accountAlias || "\u2014"),
                detailItem("Account AID", bootstrapState.account.accountAid || "\u2014"),
                detailItem("Region", bootstrapState.account.regionName || bootstrapState.account.regionId || "\u2014"),
                detailItem("Watcher Policy", bootstrapState.account.watcherRequired ? "Required" : "Optional"),
                detailItem("Boot Service", bootstrapState.bootUrl || bootstrapState.account.bootUrl || "\u2014"),
                detailItem("Boot Server AID", bootstrapState.account.bootServerAid || "Pending verification"),
            );
            summaryCard.append(summary);
            page.append(summaryCard);

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

            const statusLine = document.createElement("p");
            statusLine.className = "status-line";
            statusLine.dataset.kfWatcherStatusLine = "true";
            statusLine.setAttribute("role", "status");
            statusLine.setAttribute("aria-live", "polite");
            page.append(statusLine);

            container.append(page);
        },
        setup(root) {
            table.setup(root);

            const refreshButton = root.querySelector("[data-action='refresh-watchers']");
            const statusLine = root.querySelector("[data-kf-watcher-status-line]");
            refreshButton?.addEventListener("click", () => {
                void (async () => {
                    refreshButton.disabled = true;
                    statusLine.textContent = "Refreshing hosted watcher status\u2026";
                    announce("Refreshing watcher status.");
                    try {
                        await onRefreshStatuses();
                        showToast({ message: "Watcher status refreshed.", tone: "success" });
                        announce("Watcher status refreshed.");
                    } catch (error) {
                        statusLine.textContent = error.message || "Watcher status refresh failed.";
                        announce(error.message || "Watcher status refresh failed.", "assertive");
                        refreshButton.disabled = false;
                    }
                })();
            });
        },
    };
}
