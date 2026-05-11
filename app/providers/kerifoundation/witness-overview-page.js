import {
    floatingInputHtml,
    renderPaginatedTable,
    setupFloatingInputs,
} from "../../shared/components.js";
import { escapeHtml, toneClass } from "../../shared/dom.js";

function badgeHtml(label, tone = "neutral") {
    return `<span class="${toneClass(tone)}">${escapeHtml(label)}</span>`;
}

function shortAid(aid = "") {
    if (!aid || aid.length <= 18) {
        return aid || "—";
    }
    return `${aid.slice(0, 8)}...${aid.slice(-6)}`;
}

function securityLevelTitle(option) {
    if ((option.witnessCount || 0) === 1 && (option.toad || 0) === 1) {
        return "Standard (recommended)";
    }
    if ((option.witnessCount || 0) >= 4 && (option.toad || 0) >= 3) {
        return "Resilient";
    }
    return option.code || "Hosted protection";
}

function securityLevelDescription(option) {
    if ((option.witnessCount || 0) === 1 && (option.toad || 0) === 1) {
        return "1-of-1 hosted witness. Simple setup for most accounts.";
    }
    if ((option.witnessCount || 0) >= 4 && (option.toad || 0) >= 3) {
        return "3-of-4 hosted witnesses for stronger resilience and recovery tolerance.";
    }
    const witnessCount = option.witnessCount || 0;
    const witnessLabel = witnessCount === 1 ? "hosted witness" : "hosted witnesses";
    return `${witnessCount}-of-${witnessCount} ${witnessLabel} with threshold ${option.toad || 0}.`;
}

function securityLevelMeta(option) {
    const witnessCount = option.witnessCount || 0;
    const witnessLabel = witnessCount === 1 ? "1 witness" : `${witnessCount} witnesses`;
    return `${witnessLabel} · toad ${option.toad || 0}`;
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

function renderWitnessTable(witnesses) {
    const rows = witnesses.map((witness) => ({
        name: witness.name || `KF Witness ${witness.eid.slice(0, 12)}`,
        witnessAid: witness.eid,
        region: witness.regionName || witness.regionId || "—",
        hostedStatus: badgeHtml(witness.hostedStatus || "allocated", "info"),
        localStatus: badgeHtml(witness.localStatus || "Connected", witness.localStatusTone || "success"),
        endpoint: witness.url || "—",
        _raw: witness,
    }));

    const table = renderPaginatedTable({
        icon: "./assets/icons/witness1.svg",
        title: "Witnesses",
        titleTag: "h2",
        searchPlaceholder: "Search witnesses...",
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
        emptyTitle: "No witnesses yet",
        emptyText: "Witness details will appear here once account protection is connected.",
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

function createAuthSection(authPanels, { onDone = null } = {}) {
    return {
        render(container) {
            const section = document.createElement("section");
            section.className = "section-card";
            section.dataset.kfAuthSection = "true";
            section.innerHTML = `
                <div class="panel__title">
                    <h2>Witness authenticator QR codes</h2>
                    <p class="muted">
                        Scan these with your authenticator app and keep them safe. You may need them later when a hosted witness asks for authenticated receipting.
                    </p>
                </div>
            `;

            const grid = document.createElement("div");
            grid.className = "kf-auth-grid";

            authPanels.forEach((panel) => {
                const card = document.createElement("article");
                card.className = "kf-auth-card";

                const header = document.createElement("div");
                header.className = "kf-auth-card__header";
                header.innerHTML = `
                    <div>
                        <p class="page-header__eyebrow">Authenticator ${escapeHtml(panel.number || "")}</p>
                        <h3>${escapeHtml(panel.title || "Witness TOTP")}</h3>
                        <p class="muted">${escapeHtml(panel.description || "")}</p>
                    </div>
                `;

                const details = document.createElement("dl");
                details.className = "detail-grid";
                details.append(
                    detailItem(
                        "Controller",
                        panel.controllerAlias
                            ? `${panel.controllerAlias} (${shortAid(panel.controllerAid)})`
                            : shortAid(panel.controllerAid),
                    ),
                    detailItem(
                        "Witnesses",
                        panel.witnessNames?.length
                            ? panel.witnessNames.join(", ")
                            : (panel.witnessEids || []).map((eid) => shortAid(eid)).join(", "),
                    ),
                );

                const qrWrap = document.createElement("div");
                qrWrap.className = "kf-auth-card__qr";
                const qrImage = document.createElement("img");
                qrImage.src = panel.qrSvgDataUri;
                qrImage.alt = `${panel.title || "Witness"} authenticator QR code`;
                qrImage.width = 240;
                qrImage.height = 240;
                qrWrap.append(qrImage);

                const actions = document.createElement("div");
                actions.className = "kf-auth-card__actions";
                const copyBtn = document.createElement("button");
                copyBtn.type = "button";
                copyBtn.className = "button button--secondary button--small";
                copyBtn.dataset.copyAuthUri = panel.uri;
                copyBtn.textContent = "Copy setup link";
                actions.append(copyBtn);

                card.append(header, details, qrWrap, actions);
                grid.append(card);
            });

            section.append(grid);
            if (onDone) {
                const footer = document.createElement("div");
                footer.className = "panel__actions";
                const doneButton = document.createElement("button");
                doneButton.type = "button";
                doneButton.className = "button button--primary";
                doneButton.dataset.kfAuthDone = "true";
                doneButton.textContent = "Done";
                footer.append(doneButton);
                section.append(footer);
            }
            container.append(section);
        },
        setup(root) {
            root.querySelectorAll("[data-copy-auth-uri]").forEach((button) => {
                button.addEventListener("click", () => {
                    const value = button.dataset.copyAuthUri || "";
                    if (!value) {
                        return;
                    }

                    void (async () => {
                        const original = button.textContent;
                        try {
                            await navigator.clipboard.writeText(value);
                            button.textContent = "Copied";
                        } catch (_error) {
                            button.textContent = "Copy failed";
                        }
                        window.setTimeout(() => {
                            button.textContent = original;
                        }, 1600);
                    })();
                });
            });

            root.querySelector("[data-kf-auth-done]")?.addEventListener("click", () => {
                root.querySelector("[data-kf-auth-section]")?.remove();
                onDone?.();
            });
        },
    };
}

function renderOnboardingPage({ bootstrapState, identifiers, onLoadBootstrap, onStartOnboarding, onCompleteOnboarding }) {
    const account = bootstrapState.account;
    const initialAlias = account?.accountAlias || "";
    const initialProfile = account?.witnessProfileCode || bootstrapState.bootstrap?.accountOptions?.[0]?.code || "";
    const initialSelectedAid = identifiers.some((identifier) => identifier.aid === account?.accountAid)
        ? account.accountAid
        : "";

    return {
        title: "KERI Foundation Setup",
        render(container) {
            container.replaceChildren();

            const page = document.createElement("section");
            page.className = "page-grid";
            page.innerHTML = `
                <header class="page-header">
                    <div>
                        <p class="page-header__eyebrow">KERI Foundation</p>
                        <h1>Set up your KERI Foundation account</h1>
                        <p>Choose or create the wallet identity for this account.</p>
                    </div>
                </header>
                <form class="lk-form-stack" data-kf-onboarding-form>
                    <section class="section-card">
                        <div class="panel__title">
                            <h2>Setup service</h2>
                            <p class="muted">Setup can continue once the wallet can reach the KERI Foundation setup service.</p>
                        </div>
                        <dl class="detail-grid">
                            <div class="detail-item">
                                <dt>Status</dt>
                                <dd data-kf-connection-badge></dd>
                            </div>
                            <div class="detail-item detail-item--span">
                                <dt>Details</dt>
                                <dd data-kf-connection-detail></dd>
                            </div>
                        </dl>
                        <div class="panel__actions">
                            <button class="button button--secondary" type="button" data-kf-refresh-bootstrap>Retry</button>
                        </div>
                    </section>

                    <section class="section-card">
                        <div class="panel__title">
                            <h2>Choose your wallet identity</h2>
                            <p class="muted">
                                Choose the wallet identity for this account. You can use an existing wallet identity or create a new one during setup.
                            </p>
                        </div>
                        <div class="kf-field-stack">
                            <label class="kf-field-label" for="kf-wallet-identity">Wallet identity</label>
                            <select class="kf-select" id="kf-wallet-identity" data-kf-account-select></select>
                        </div>
                        <p class="muted" data-kf-identity-hint></p>
                        <div data-kf-alias-field>
                            ${floatingInputHtml({ label: "Name this account", name: "alias" })}
                        </div>
                    </section>

                    <section class="section-card">
                        <div class="panel__title">
                            <h2>Security level</h2>
                            <p class="muted">Choose how much hosted protection to use for this account.</p>
                        </div>
                        <div class="summary-grid" data-kf-profile-grid></div>
                        <p class="muted" data-kf-monitoring-copy></p>
                    </section>

                    <section class="section-card">
                        <div class="panel__title">
                            <h2>Review and start</h2>
                            <p class="muted">Review the choices for this account, then start setup.</p>
                        </div>
                        <dl class="detail-grid">
                            <div class="detail-item">
                                <dt>Setup service</dt>
                                <dd data-kf-review-connection></dd>
                            </div>
                            <div class="detail-item">
                                <dt>Identity</dt>
                                <dd data-kf-review-identity></dd>
                            </div>
                            <div class="detail-item">
                                <dt>Account name</dt>
                                <dd data-kf-review-account></dd>
                            </div>
                            <div class="detail-item">
                                <dt>Security level</dt>
                                <dd data-kf-review-security></dd>
                            </div>
                            <div class="detail-item detail-item--span">
                                <dt>Included setup</dt>
                                <dd data-kf-review-monitoring></dd>
                            </div>
                        </dl>
                        <div class="panel__actions">
                            <button class="button button--primary" type="submit" data-kf-start-onboarding>Start setup</button>
                        </div>
                        <p class="status-line" data-kf-onboarding-status></p>
                    </section>
                </form>
                <div data-kf-onboarding-completion></div>
            `;

            container.append(page);
        },
        setup(root) {
            setupFloatingInputs(root);

            const form = root.querySelector("[data-kf-onboarding-form]");
            const aliasField = root.querySelector("[data-kf-alias-field]");
            const aliasInput = form.querySelector("input[name='alias']");
            const accountSelect = root.querySelector("[data-kf-account-select]");
            const identityHint = root.querySelector("[data-kf-identity-hint]");
            const connectionBadge = root.querySelector("[data-kf-connection-badge]");
            const connectionDetail = root.querySelector("[data-kf-connection-detail]");
            const refreshButton = root.querySelector("[data-kf-refresh-bootstrap]");
            const profileGrid = root.querySelector("[data-kf-profile-grid]");
            const monitoringCopy = root.querySelector("[data-kf-monitoring-copy]");
            const reviewConnection = root.querySelector("[data-kf-review-connection]");
            const reviewIdentity = root.querySelector("[data-kf-review-identity]");
            const reviewAccount = root.querySelector("[data-kf-review-account]");
            const reviewSecurity = root.querySelector("[data-kf-review-security]");
            const reviewMonitoring = root.querySelector("[data-kf-review-monitoring]");
            const submitButton = root.querySelector("[data-kf-start-onboarding]");
            const statusLine = root.querySelector("[data-kf-onboarding-status]");
            const completionHost = root.querySelector("[data-kf-onboarding-completion]");

            let currentSnapshot = bootstrapState;

            function selectedIdentifier() {
                return identifiers.find((identifier) => identifier.aid === accountSelect.value) || null;
            }

            function selectedProfileCode() {
                return profileGrid.querySelector("input[name='kf-security-level']:checked")?.value || "";
            }

            function selectedProfile() {
                const code = selectedProfileCode();
                return (currentSnapshot.bootstrap?.accountOptions ?? []).find((option) => option.code === code) || null;
            }

            function renderIdentityOptions() {
                const options = [
                    '<option value="">Create a new wallet identity during setup</option>',
                    ...identifiers.map(
                        (identifier) =>
                            `<option value="${escapeHtml(identifier.aid)}">${escapeHtml(identifier.alias)} (${escapeHtml(shortAid(identifier.aid))})</option>`,
                    ),
                ];
                accountSelect.innerHTML = options.join("");
                accountSelect.value = initialSelectedAid;
            }

            function renderProfiles(options, preferredCode = "") {
                if (!options.length) {
                    profileGrid.innerHTML = `
                        <div class="notice notice--warning">
                            No hosted security levels are available right now.
                        </div>
                    `;
                    return;
                }

                const selectedCode = options.some((option) => option.code === preferredCode)
                    ? preferredCode
                    : options[0].code;

                profileGrid.innerHTML = options
                    .map(
                        (option) => `
                            <label class="kf-radio-card ${selectedCode === option.code ? "is-selected" : ""}">
                                <input
                                    class="kf-radio-card__input"
                                    type="radio"
                                    name="kf-security-level"
                                    value="${escapeHtml(option.code)}"
                                    ${selectedCode === option.code ? "checked" : ""}
                                >
                                <span class="kf-radio-card__copy">
                                    <strong>${escapeHtml(securityLevelTitle(option))}</strong>
                                    <span>${escapeHtml(securityLevelDescription(option))}</span>
                                </span>
                                <span class="badge badge--neutral">${escapeHtml(securityLevelMeta(option))}</span>
                            </label>
                        `,
                    )
                    .join("");
            }

            function resolvedAlias() {
                if (!accountSelect.value) {
                    return aliasInput.value.trim();
                }
                return selectedIdentifier()?.alias || "";
            }

            function renderFormState() {
                const profile = selectedProfile();
                const identifier = selectedIdentifier();
                const createNew = !accountSelect.value;
                const connectionOk = currentSnapshot.connection.ok;

                connectionBadge.innerHTML = badgeHtml(connectionOk ? "Ready" : "Unavailable", connectionOk ? "success" : "warning");
                connectionDetail.textContent = connectionOk
                    ? "The setup service is reachable. You can continue."
                    : currentSnapshot.connection.error || "Retry after the setup service becomes reachable.";

                identityHint.textContent = createNew
                    ? "A new wallet identity will be created during setup for this account."
                    : identifier
                        ? `Use the existing wallet identity ${identifier.alias} (${shortAid(identifier.aid)}) for this account.`
                        : "Choose an existing wallet identity or create a new one.";
                aliasField.hidden = !createNew;

                monitoringCopy.textContent = !currentSnapshot.bootstrap
                    ? "Monitoring details appear after the setup service responds."
                    : currentSnapshot.bootstrap.watcherRequired
                        ? "A hosted watcher is included automatically. The wallet connects it before setup finishes."
                        : "Hosted monitoring is available for this account when the service offers it.";

                reviewConnection.textContent = connectionOk ? "Ready" : "Connection required";
                reviewIdentity.textContent = createNew
                    ? "Create a new wallet identity"
                    : "Use an existing wallet identity";
                reviewAccount.textContent = resolvedAlias() || "(account name required)";
                reviewSecurity.textContent = profile ? securityLevelTitle(profile) : "(not selected)";
                reviewMonitoring.textContent = !currentSnapshot.bootstrap
                    ? "Hosted setup details appear after the setup service responds."
                    : currentSnapshot.bootstrap.watcherRequired
                        ? "Hosted witnesses and monitoring included automatically"
                        : "Hosted witnesses included";

                submitButton.disabled = !connectionOk || !resolvedAlias() || !profile;
            }

            function applySnapshot(nextSnapshot) {
                currentSnapshot = nextSnapshot;
                renderProfiles(
                    nextSnapshot.bootstrap?.accountOptions ?? [],
                    nextSnapshot.account?.witnessProfileCode || selectedProfileCode() || initialProfile,
                );
                renderFormState();
            }

            async function refreshBootstrap() {
                statusLine.textContent = "";
                statusLine.classList.remove("is-neutral", "is-success");
                refreshButton.disabled = true;
                submitButton.disabled = true;

                try {
                    const nextSnapshot = await onLoadBootstrap();
                    applySnapshot(nextSnapshot);
                } catch (error) {
                    statusLine.textContent = error.message || "Setup service check failed.";
                } finally {
                    refreshButton.disabled = false;
                    renderFormState();
                }
            }

            function showAuthenticatorCodes(account) {
                const authPanels = account?.witnessAuthPanels || [];
                if (!authPanels.length) {
                    onCompleteOnboarding?.();
                    return;
                }

                form.hidden = true;
                completionHost.replaceChildren();
                const authSection = createAuthSection(authPanels, {
                    onDone: () => onCompleteOnboarding?.(),
                });
                authSection.render(completionHost);
                authSection.setup(completionHost);
            }

            accountSelect.addEventListener("change", () => {
                renderFormState();
            });

            aliasInput.addEventListener("input", () => {
                renderFormState();
            });

            profileGrid.addEventListener("change", () => {
                renderProfiles(currentSnapshot.bootstrap?.accountOptions ?? [], selectedProfileCode());
                renderFormState();
            });

            refreshButton.addEventListener("click", () => {
                void refreshBootstrap();
            });

            form.addEventListener("submit", (event) => {
                event.preventDefault();
                void (async () => {
                    statusLine.textContent = "";
                    statusLine.classList.remove("is-success");
                    refreshButton.disabled = true;
                    submitButton.disabled = true;

                    try {
                        if (!currentSnapshot.connection.ok) {
                            const nextSnapshot = await onLoadBootstrap();
                            applySnapshot(nextSnapshot);
                            if (!nextSnapshot.connection.ok) {
                                throw new Error(nextSnapshot.connection.error || "Setup service unavailable.");
                            }
                        }

                        const alias = resolvedAlias();
                        const witnessProfileCode = selectedProfileCode();
                        if (!alias) {
                            throw new Error("Choose or create the wallet identity for this account.");
                        }
                        if (!witnessProfileCode) {
                            throw new Error("Choose a security level before starting setup.");
                        }

                        statusLine.textContent = "Setting up your account. This can take a minute.";
                        statusLine.classList.add("is-neutral");
                        const response = await onStartOnboarding({
                            alias,
                            witnessProfileCode,
                            accountAid: accountSelect.value,
                        });
                        showAuthenticatorCodes(response.account);
                    } catch (error) {
                        statusLine.classList.remove("is-neutral");
                        statusLine.textContent = error.message || "Account setup failed.";
                        refreshButton.disabled = false;
                        renderFormState();
                    }
                })();
            });

            renderIdentityOptions();
            aliasInput.value = initialAlias;
            applySnapshot(currentSnapshot);
        },
    };
}

function renderAccountWitnessesPage({ witnesses, witnessError }) {
    const table = renderWitnessTable(witnesses);

    return {
        title: "KERI Foundation Witnesses",
        render(container) {
            container.replaceChildren();

            const page = document.createElement("section");
            page.className = "page-grid page-grid--table";
            page.innerHTML = `
                <header class="page-header">
                    <div>
                        <p class="page-header__eyebrow">KERI Foundation</p>
                        <h1>Witnesses</h1>
                        <p>Hosted witnesses connected for your KERI Foundation account.</p>
                    </div>
                </header>
            `;

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

export function renderKfSetupPage(props) {
    return renderOnboardingPage(props);
}

export function renderKfWitnessesPage(props) {
    return renderAccountWitnessesPage(props);
}

export function renderWitnessOverviewPage(props) {
    if (props.bootstrapState.account?.status === "onboarded") {
        return renderKfWitnessesPage(props);
    }
    return renderKfSetupPage(props);
}
