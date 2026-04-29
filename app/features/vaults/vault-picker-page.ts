import { formatDateLabel } from "../../shared/dom.js";
import { emptyStateHtml } from "../../ui/composites/empty-state.js";
import { buttonHtml } from "../../ui/primitives/button.js";
import { badgeHtml } from "../../ui/primitives/badge.js";

interface VaultRecord {
    id: string;
    alias: string;
    storageName?: string;
    createdAt: string;
    identifierCount?: number;
    remoteCount?: number;
    locked?: boolean;
}

interface VaultPickerProps {
    vaults: VaultRecord[];
    onCreateVault(): void;
    onSelectVault(vault: VaultRecord): void;
}

function vaultCardHtml(vault: VaultRecord): string {
    const statusTone = vault.locked === false ? "success" : "neutral";
    const statusLabel = vault.locked === false ? "Open" : "Locked";
    const actionLabel = vault.locked === false ? "Return to Vault" : "Open Vault";

    return `
        <article class="vault-card vault-card--mobile-home" data-vault-id="${vault.id}">
            <div class="vault-card__header">
                <div class="vault-card__title">
                    <h2>${vault.alias}</h2>
                    <p class="muted">${vault.storageName || "Browser-safe vault"}</p>
                </div>
                ${badgeHtml({ label: statusLabel, tone: statusTone })}
            </div>
            <div class="summary-grid vault-card__meta vault-card__meta--mobile">
                <div class="summary-item">
                    <span>Created</span>
                    <span>${formatDateLabel(vault.createdAt)}</span>
                </div>
                <div class="summary-item">
                    <span>Identifiers</span>
                    <span>${vault.identifierCount ?? 0}</span>
                </div>
                <div class="summary-item">
                    <span>Remotes</span>
                    <span>${vault.remoteCount ?? 0}</span>
                </div>
            </div>
            <div class="vault-card__actions">
                ${buttonHtml({ label: actionLabel, tone: "primary", dataAction: "open-vault", className: "vault-card__primary-action" })}
            </div>
        </article>
    `;
}

export function renderVaultPickerPage({ vaults = [], onCreateVault, onSelectVault }: VaultPickerProps) {
    return {
        title: "Vaults",
        render(container: HTMLElement): void {
            container.replaceChildren();

            const page = document.createElement("section");
            page.className = "page-grid vault-home";

            const vaultListHtml = vaults.length
                ? `<div class="vault-list vault-home__list">${vaults.map((vault) => vaultCardHtml(vault)).join("")}</div>`
                : emptyStateHtml({
                      title: "No Vaults Yet",
                      message: "This wallet has not created a local vault on this device yet.",
                      iconSrc: "./assets/brand/SymbolLogo.svg",
                      primaryActionHtml: buttonHtml({
                          label: "Create Your First Vault",
                          tone: "primary",
                          dataAction: "create-vault",
                      }),
                  });

            page.innerHTML = `
                <section class="hero-card vault-home__hero">
                    <div class="hero-card__brand vault-home__brand">
                        <img src="./assets/brand/SymbolLogo.svg" alt="" aria-hidden="true">
                        <p class="hero-card__eyebrow">On-Device Wallet</p>
                        <h1>Your Vaults</h1>
                        <p>Create a vault or reopen one you have already stored on this device.</p>
                    </div>
                    <div class="hero-card__actions">
                        ${buttonHtml({ label: "Create Vault", tone: "primary", dataAction: "create-vault" })}
                    </div>
                </section>
                <section class="panel vault-home__list-panel">
                    <div class="panel__header vault-home__list-header">
                        <div class="panel__title">
                            <h2>Available Vaults</h2>
                            <p class="muted">${
                                vaults.length
                                    ? "Choose a vault to continue your local wallet session."
                                    : "Create your first vault to begin using the mobile wallet."
                            }</p>
                        </div>
                    </div>
                    ${vaultListHtml}
                </section>
            `;

            page.querySelectorAll("[data-action='create-vault']").forEach((button) => {
                if (!(button instanceof HTMLElement)) {
                    return;
                }
                button.addEventListener("click", () => onCreateVault());
            });

            page.querySelectorAll("[data-action='open-vault']").forEach((button) => {
                if (!(button instanceof HTMLElement)) {
                    return;
                }

                const card = button.closest("[data-vault-id]");
                if (!(card instanceof HTMLElement)) {
                    return;
                }

                const vault = vaults.find((entry) => entry.id === card.dataset.vaultId);
                if (vault) {
                    button.addEventListener("click", () => onSelectVault(vault));
                }
            });

            container.append(page);
        },
    };
}