import { identifiersHref } from "../../app/router.js";
import { escapeHtml, toneClass } from "../../shared/dom.js";
import { showToast } from "../../ui/composites/toast.js";
import { badgeHtml } from "../../ui/primitives/badge.js";

/**
 * @typedef {Object} IdentifierDetailProps
 * @property {Object} vault
 * @property {Object} identifier
 */

/**
 * @param {IdentifierDetailProps} props
 */
export function renderIdentifierDetailPage({ vault, identifier }) {
    const witnessPills = identifier.witnesses.length
        ? identifier.witnesses
              .map(
                  (witness) => badgeHtml({ label: `${witness.alias} \u00B7 ${witness.status}`, tone: "neutral" }),
              )
              .join("")
        : badgeHtml({ label: "No witnesses provisioned", tone: "neutral" });

    return {
        title: identifier.alias,
        html: `
            <section class="page-grid page-grid--detail">
                <header class="page-header">
                    <div>
                        <p class="page-header__eyebrow">${escapeHtml(vault.alias)}</p>
                        <h1>${escapeHtml(identifier.alias)}</h1>
                        <p>
                            Local identifier state stays scoped to this vault route while witness and event facts remain read-only here.
                        </p>
                    </div>
                    <div class="page-header__actions">
                        <a class="button button--secondary" href="${identifiersHref(vault.id)}">Back to Identifiers</a>
                    </div>
                </header>
                <section class="detail-card detail-card--identifier">
                    <div class="detail-card__header">
                        <div class="detail-card__title">
                            <h2>Identifier Summary</h2>
                            <p class="muted mono">${escapeHtml(identifier.prefix)}</p>
                        </div>
                        <span class="${toneClass(identifier.statusTone)}">${escapeHtml(identifier.status)}</span>
                    </div>
                    <div class="summary-grid">
                        <div class="summary-item">
                            <span>Sequence Number</span>
                            <span>${identifier.sequenceNumber}</span>
                        </div>
                        <div class="summary-item">
                            <span>KEL Events</span>
                            <span>${identifier.kelEvents}</span>
                        </div>
                        <div class="summary-item">
                            <span>Witnesses</span>
                            <span>${identifier.witnessCount}</span>
                        </div>
                    </div>
                </section>
                <section class="page-columns">
                    <section class="section-card">
                        <h2>Event State</h2>
                        <dl class="detail-grid">
                            <div class="detail-item">
                                <dt>Prefix</dt>
                                <dd class="mono">
                                    <span>${escapeHtml(identifier.prefix)}</span>
                                    <button class="icon-button icon-button--inline" type="button"
                                            data-copy="${escapeHtml(identifier.prefix)}"
                                            aria-label="Copy prefix">
                                        <img src="./assets/icons/copy.svg" alt="" width="16" height="16">
                                    </button>
                                </dd>
                            </div>
                            <div class="detail-item">
                                <dt>Last Event Digest</dt>
                                <dd class="mono">${escapeHtml(identifier.lastEventDigest)}</dd>
                            </div>
                            <div class="detail-item">
                                <dt>OOBI</dt>
                                <dd class="mono">
                                    <span>${escapeHtml(identifier.oobi)}</span>
                                    <button class="icon-button icon-button--inline" type="button"
                                            data-copy="${escapeHtml(identifier.oobi)}"
                                            aria-label="Copy OOBI">
                                        <img src="./assets/icons/copy.svg" alt="" width="16" height="16">
                                    </button>
                                </dd>
                            </div>
                            <div class="detail-item">
                                <dt>Vault</dt>
                                <dd>${escapeHtml(vault.alias)}</dd>
                            </div>
                        </dl>
                    </section>
                    <section class="section-card">
                        <h2>Witness Status</h2>
                        <div class="meta-pill-row">
                            ${witnessPills}
                        </div>
                    </section>
                </section>
            </section>
        `,
        setup(root) {
            root.querySelectorAll("[data-copy]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    const text = btn.dataset.copy;
                    try {
                        await navigator.clipboard.writeText(text);
                        showToast({ message: "Copied to clipboard.", tone: "success", durationMs: 2000 });
                    } catch {
                        showToast({ message: "Copy failed. Select and copy manually.", tone: "error", durationMs: 3000 });
                    }
                });
            });
        },
    };
}
