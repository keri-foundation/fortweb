import {
    floatingInputHtml,
    renderPaginatedTable,
    setupFloatingInputs,
} from "../../shared/components.js";
import { escapeHtml, toneClass } from "../../shared/dom.js";
import { announce } from "../../ui/core/a11y.js";
import { showToast } from "../../ui/composites/toast.js";
import { stepperHtml } from "../../ui/composites/stepper.js";
import { badgeHtml as uiBadgeHtml } from "../../ui/primitives/badge.js";

function badgeHtml(label, tone = "neutral") {
    return `<span class="${toneClass(tone)}">${escapeHtml(label)}</span>`;
}

function profileLabel(option) {
    const witnessLabel = option.witnessCount === 1 ? "1 witness" : `${option.witnessCount} witnesses`;
    return `${option.code} \u00B7 ${witnessLabel} \u00B7 toad ${option.toad}`;
}

function detailItem(label, value) {
    const wrapper = document.createElement("div");
    wrapper.className = "detail-item";

    const term = document.createElement("dt");
    term.textContent = label;

    const description = document.createElement("dd");
    if (value instanceof HTMLElement) {
        description.append(value);
    } else {
        description.textContent = value;
    }

    wrapper.append(term, description);
    return wrapper;
}

function accountSummary(account, bootstrapState) {
    const summary = document.createElement("dl");
    summary.className = "detail-grid summary-grid";
    summary.append(
        detailItem("Account Alias", account.accountAlias || "\u2014"),
        detailItem("Account AID", account.accountAid || "\u2014"),
        detailItem("Profile", account.witnessProfileCode || "\u2014"),
        detailItem("Region", account.regionName || account.regionId || "\u2014"),
        detailItem("Witness Count", String(account.witnessCount || 0)),
        detailItem("Witness Threshold", String(account.toad || 0)),
        detailItem("Boot Service", bootstrapState.bootUrl || account.bootUrl || "\u2014"),
        detailItem("Boot Server AID", account.bootServerAid || "Pending verification"),
    );
    return summary;
}

function renderWitnessTable(witnesses) {
    const rows = witnesses.map((witness) => ({
        name: witness.name || `KF Witness ${witness.eid.slice(0, 12)}`,
        witnessAid: witness.eid,
        region: witness.regionName || witness.regionId || "\u2014",
        hostedStatus: badgeHtml(witness.hostedStatus || "allocated", "info"),
        localStatus: badgeHtml(witness.localStatus || "Pending local connect", witness.localStatusTone || "warning"),
        endpoint: witness.url || "\u2014",
        _raw: witness,
    }));

    const table = renderPaginatedTable({
        icon: "./assets/icons/witness1.svg",
        title: "Hosted Witnesses",
        titleTag: "h2",
        searchPlaceholder: "Search hosted witnesses...",
        columns: [
            { key: "name", label: "Name", width: "210px" },
            { key: "witnessAid", label: "Witness AID", width: "320px" },
            { key: "region", label: "Region", width: "160px" },
            { key: "hostedStatus", label: "Hosted Status", width: "150px", html: true },
            { key: "localStatus", label: "Local Status", width: "160px", html: true },
            { key: "endpoint", label: "Endpoint", width: "280px" },
        ],
        rows,
        itemsPerPage: 10,
        emptyTitle: "No Hosted Witness Rows",
        emptyText:
            "This KF account is onboarded locally, but the boot service did not return any witness rows yet.",
    });

    return {
        render(container) {
            const root = document.createElement("div");
            root.dataset.kfWitnessTable = "true";
            root.innerHTML = table.html;
            container.append(root);
        },
        setup(root) {
            table.setup(root.querySelector("[data-kf-witness-table]"));
        },
    };
}

/** @type {Array<{id: string, label: string}>} */
const ONBOARDING_STEPS = [
    { id: "connect", label: "Connect" },
    { id: "configure", label: "Configure" },
    { id: "onboard", label: "Onboard" },
    { id: "review", label: "Review" },
];

function deriveCurrentStep(bootstrapState) {
    if (!bootstrapState.connection.ok) return "connect";
    const options = bootstrapState.bootstrap?.accountOptions ?? [];
    if (options.length === 0) return "connect";
    return "configure";
}

function renderOnboardingPage({ bootstrapState, onLoadBootstrap, onStartOnboarding }) {
    const account = bootstrapState.account;
    const initialOptions = bootstrapState.bootstrap?.accountOptions ?? [];
    const initialAlias = account?.accountAlias || "";
    const initialBootUrl = bootstrapState.bootUrl || account?.bootUrl || "";
    const initialProfile = account?.witnessProfileCode || initialOptions[0]?.code || "";

    return {
        title: "KERI Foundation Witnesses",
        render(container) {
            container.replaceChildren();

            const currentStep = deriveCurrentStep(bootstrapState);

            const page = document.createElement("section");
            page.className = "page-grid";
            page.innerHTML = `
                <header class="page-header">
                    <div>
                        <h1>Witnesses</h1>
                        <p>
                            Fortweb now treats the witness route as the first real KERI Foundation entrypoint:
                            boot connectivity, hosted onboarding, and the hosted witness list all live here.
                        </p>
                    </div>
                </header>
                <div class="section-card section-card--summary" style="padding-block: var(--space-4);">
                    ${stepperHtml({ steps: ONBOARDING_STEPS, currentStepId: currentStep })}
                </div>
            `;

            const columns = document.createElement("section");
            columns.className = "page-columns";

            const summaryCard = document.createElement("section");
            summaryCard.className = "section-card section-card--summary";
            summaryCard.setAttribute("role", "status");
            summaryCard.innerHTML = `
                <div class="panel__title">
                    <h2>Boot Connection</h2>
                    <p class="muted">
                        Fortweb talks to the boot service, hosted witnesses, and hosted watchers through the local same-origin dev proxy.
                    </p>
                </div>
                <dl class="detail-grid">
                    <div class="detail-item">
                        <dt>Boot URL</dt>
                        <dd class="mono" data-kf-boot-url-label>${escapeHtml(initialBootUrl || "http://127.0.0.1:9723")}</dd>
                    </div>
                    <div class="detail-item">
                        <dt>Connection</dt>
                        <dd data-kf-connection-badge>${badgeHtml(bootstrapState.connection.ok ? "Connected" : "Disconnected", bootstrapState.connection.ok ? "success" : "warning")}</dd>
                    </div>
                    <div class="detail-item">
                        <dt>Region</dt>
                        <dd data-kf-region-label>${escapeHtml(bootstrapState.bootstrap?.regionName || bootstrapState.bootstrap?.regionId || "Unavailable")}</dd>
                    </div>
                    <div class="detail-item">
                        <dt>Watcher Policy</dt>
                        <dd data-kf-watcher-policy>${escapeHtml(bootstrapState.bootstrap ? (bootstrapState.bootstrap.watcherRequired ? "One hosted watcher required" : "Watcher optional") : "Unavailable")}</dd>
                    </div>
                    <div class="detail-item detail-item--span">
                        <dt>Available Profiles</dt>
                        <dd data-kf-profile-pills class="meta-pill-row"></dd>
                    </div>
                </dl>
                <p class="status-line" data-kf-connection-status>${escapeHtml(account?.failureReason || bootstrapState.connection.error || "")}</p>
            `;

            const formCard = document.createElement("section");
            formCard.className = "section-card section-card--form";
            formCard.innerHTML = `
                <div class="panel__title">
                    <h2>Hosted Onboarding</h2>
                    <p class="muted">
                        Fortweb keeps the hidden ephemeral onboarding identifier inside the worker and only persists the permanent account AID after the hosted run completes.
                    </p>
                </div>
                <form class="lk-form-stack" data-kf-onboarding-form>
                    ${floatingInputHtml({ label: "Boot Service URL", name: "bootUrl" })}
                    ${floatingInputHtml({ label: "Account Alias", name: "alias" })}
                    <div class="kf-field-stack">
                        <label class="kf-field-label" for="kf-witness-profile">Witness Profile</label>
                        <select class="kf-select" id="kf-witness-profile" name="witnessProfileCode" data-kf-profile-select></select>
                    </div>
                    <p class="muted">
                        Fortweb v1 creates or reuses one permanent local KF account AID for this vault. It does not expose raw witness boot servers or the hidden ephemeral onboarding AID in the shell.
                    </p>
                    <div class="panel__actions">
                        <button class="button button--secondary" type="button" data-kf-refresh-bootstrap>Check Boot Connection</button>
                        <button class="button button--primary" type="submit" data-kf-start-onboarding>Start Hosted Onboarding</button>
                    </div>
                    <p class="status-line" data-kf-onboarding-status role="status" aria-live="polite"></p>
                </form>
            `;

            columns.append(summaryCard, formCard);
            page.append(columns);
            container.append(page);
        },
        setup(root) {
            setupFloatingInputs(root);

            const summaryStatus = root.querySelector("[data-kf-connection-status]");
            const bootUrlLabel = root.querySelector("[data-kf-boot-url-label]");
            const connectionBadge = root.querySelector("[data-kf-connection-badge]");
            const regionLabel = root.querySelector("[data-kf-region-label]");
            const watcherPolicy = root.querySelector("[data-kf-watcher-policy]");
            const profilePills = root.querySelector("[data-kf-profile-pills]");
            const form = root.querySelector("[data-kf-onboarding-form]");
            const bootUrlInput = form.querySelector("input[name='bootUrl']");
            const aliasInput = form.querySelector("input[name='alias']");
            const profileSelect = form.querySelector("[data-kf-profile-select]");
            const refreshButton = form.querySelector("[data-kf-refresh-bootstrap]");
            const submitButton = form.querySelector("[data-kf-start-onboarding]");
            const statusLine = form.querySelector("[data-kf-onboarding-status]");

            let currentSnapshot = bootstrapState;

            function renderProfiles(options, preferredCode = "") {
                const selectedCode = preferredCode || profileSelect.value || options[0]?.code || "";
                profileSelect.innerHTML = options.length
                    ? options
                        .map(
                            (option) => `
                                <option value="${escapeHtml(option.code)}" ${selectedCode === option.code ? "selected" : ""}>
                                    ${escapeHtml(profileLabel(option))}
                                </option>
                            `,
                        )
                        .join("")
                    : '<option value="">No hosted profiles available</option>';
                profileSelect.disabled = options.length === 0;
                submitButton.disabled = options.length === 0 || !currentSnapshot.connection.ok;
            }

            function applySnapshot(nextSnapshot) {
                currentSnapshot = nextSnapshot;
                const options = nextSnapshot.bootstrap?.accountOptions ?? [];
                const region = nextSnapshot.bootstrap?.regionName || nextSnapshot.bootstrap?.regionId || "Unavailable";
                const watcherText = nextSnapshot.bootstrap
                    ? nextSnapshot.bootstrap.watcherRequired
                        ? "One hosted watcher required"
                        : "Watcher optional"
                    : "Unavailable";
                const connectionLabel = nextSnapshot.connection.ok ? "Connected" : "Disconnected";
                const connectionTone = nextSnapshot.connection.ok ? "success" : "warning";

                bootUrlLabel.textContent = nextSnapshot.bootUrl || bootUrlInput.value || initialBootUrl || "\u2014";
                connectionBadge.innerHTML = badgeHtml(connectionLabel, connectionTone);
                regionLabel.textContent = region;
                watcherPolicy.textContent = watcherText;
                profilePills.innerHTML = options.length
                    ? options.map((option) => badgeHtml(profileLabel(option), "neutral")).join("")
                    : '<span class="badge badge--warning">No hosted profiles returned</span>';
                summaryStatus.textContent = nextSnapshot.account?.failureReason || nextSnapshot.connection.error || "";
                renderProfiles(options, nextSnapshot.account?.witnessProfileCode || profileSelect.value || initialProfile);

                announce(nextSnapshot.connection.ok ? "Boot service connected." : "Boot service disconnected.");
            }

            async function refreshBootstrap() {
                statusLine.textContent = "";
                refreshButton.disabled = true;
                submitButton.disabled = true;

                try {
                    const nextSnapshot = await onLoadBootstrap(bootUrlInput.value);
                    applySnapshot(nextSnapshot);
                    if (!nextSnapshot.connection.ok) {
                        statusLine.textContent = nextSnapshot.connection.error || "Boot connection failed.";
                    } else {
                        showToast({ message: "Boot connection verified.", tone: "success" });
                    }
                } catch (error) {
                    statusLine.textContent = error.message || "Boot connection failed.";
                    announce("Boot connection failed.", "assertive");
                } finally {
                    refreshButton.disabled = false;
                    submitButton.disabled = profileSelect.disabled || !currentSnapshot.connection.ok;
                }
            }

            refreshButton.addEventListener("click", () => {
                void refreshBootstrap();
            });

            form.addEventListener("submit", (event) => {
                event.preventDefault();
                void (async () => {
                    statusLine.textContent = "";
                    refreshButton.disabled = true;
                    submitButton.disabled = true;

                    try {
                        if (!currentSnapshot.connection.ok) {
                            const nextSnapshot = await onLoadBootstrap(bootUrlInput.value);
                            applySnapshot(nextSnapshot);
                            if (!nextSnapshot.connection.ok) {
                                throw new Error(nextSnapshot.connection.error || "Boot connection failed.");
                            }
                        }

                        statusLine.textContent = "Hosted onboarding in progress. Fortweb is allocating hosted resources and resolving the required OOBIs.";
                        announce("Hosted onboarding in progress.");
                        await onStartOnboarding({
                            bootUrl: bootUrlInput.value,
                            alias: aliasInput.value,
                            witnessProfileCode: profileSelect.value,
                        });
                        showToast({ message: "Hosted onboarding complete.", tone: "success" });
                    } catch (error) {
                        statusLine.textContent = error.message || "Hosted onboarding failed.";
                        announce(error.message || "Hosted onboarding failed.", "assertive");
                        refreshButton.disabled = false;
                        submitButton.disabled = profileSelect.disabled || !currentSnapshot.connection.ok;
                    }
                })();
            });

            bootUrlInput.value = initialBootUrl || "http://127.0.0.1:9723";
            aliasInput.value = initialAlias;
            applySnapshot(currentSnapshot);
        },
    };
}

function renderAccountWitnessesPage({ bootstrapState, witnesses, witnessError }) {
    const table = renderWitnessTable(witnesses);

    return {
        title: "KERI Foundation Witnesses",
        render(container) {
            container.replaceChildren();

            const page = document.createElement("section");
            page.className = "page-grid page-grid--table";

            const header = document.createElement("header");
            header.className = "page-header";
            header.innerHTML = `
                <div>
                    <h1>Witnesses</h1>
                    <p>
                        Hosted witness rows come from the boot-backed KF account, not from Fortweb's local identifier summaries.
                    </p>
                </div>
            `;

            const summaryCard = document.createElement("section");
            summaryCard.className = "section-card section-card--summary";
            summaryCard.append(accountSummary(bootstrapState.account, bootstrapState));

            page.append(header, summaryCard);

            if (witnessError) {
                const warning = document.createElement("p");
                warning.className = "notice notice--warning";
                warning.textContent = witnessError;
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

export function renderWitnessOverviewPage(props) {
    if (props.bootstrapState.account?.status === "onboarded") {
        return renderAccountWitnessesPage(props);
    }
    return renderOnboardingPage(props);
}
