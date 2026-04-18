import { escapeHtml } from "../../shared/dom.js";
import { announce } from "../../ui/core/a11y.js";
import { createModal } from "../../ui/composites/modal.js";
import { showToast } from "../../ui/composites/toast.js";
import { fieldTextHtml } from "../../ui/primitives/field-text.js";

/**
 * @typedef {Object} SettingsPageProps
 * @property {Object} vault
 * @property {Object} settings
 * @property {function(string): Promise<void>} [onDeleteVault]
 */

function enabledLabel(value) {
    return value ? "Enabled" : "Disabled";
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

function openDeleteConfirmation(vault, onDeleteVault) {
    const modal = createModal({
        title: "Delete Vault",
        tone: "danger",
        body: `
            <p>This will permanently delete <strong>${escapeHtml(vault.alias)}</strong> and all its local data. This action cannot be undone.</p>
            <p>Type the vault name to confirm:</p>
            ${fieldTextHtml({
                id: "delete-confirm-alias",
                label: "Vault name",
                placeholder: vault.alias,
                autocomplete: "off",
            })}
            <p class="status-line" data-delete-status></p>
        `,
        actions: [
            { label: "Cancel", tone: "ghost", dataAction: "cancel" },
            { label: "Delete Vault", tone: "danger", dataAction: "confirm-delete" },
        ],
    });

    modal.open();

    const root = document.querySelector("[role='dialog'][aria-label='Delete Vault']");
    if (!root) return;

    const confirmInput = root.querySelector("#delete-confirm-alias");
    const deleteBtn = root.querySelector("[data-action='confirm-delete']");
    const cancelBtn = root.querySelector("[data-action='cancel']");
    const statusLine = root.querySelector("[data-delete-status]");

    deleteBtn.disabled = true;

    confirmInput?.addEventListener("input", () => {
        deleteBtn.disabled = confirmInput.value.trim() !== vault.alias;
    });

    cancelBtn?.addEventListener("click", () => modal.close());

    deleteBtn?.addEventListener("click", async () => {
        if (confirmInput.value.trim() !== vault.alias) return;

        deleteBtn.disabled = true;
        statusLine.textContent = "Deleting vault\u2026";
        announce("Deleting vault, please wait.");

        try {
            await onDeleteVault(vault.id);
            modal.close();
            showToast({ message: `Vault "${vault.alias}" deleted.`, tone: "success" });
        } catch (error) {
            deleteBtn.disabled = false;
            statusLine.textContent = error.message || "Vault deletion failed.";
            announce(error.message || "Vault deletion failed.", "assertive");
        }
    });
}

/**
 * @param {SettingsPageProps} props
 */
export function renderSettingsPage({ vault, settings, onDeleteVault }) {
    return {
        title: "Settings",
        render(container) {
            container.replaceChildren();

            const page = document.createElement("section");
            page.className = "page-grid page-grid--settings";

            const header = document.createElement("header");
            header.className = "page-header";

            const headingBlock = document.createElement("div");

            const eyebrow = document.createElement("p");
            eyebrow.className = "page-header__eyebrow";
            eyebrow.textContent = vault.alias;

            const title = document.createElement("h1");
            title.textContent = "Settings";

            const copy = document.createElement("p");
            copy.textContent =
                "This page stays limited to persisted browser-vault defaults and runtime facts. Desktop browser-plugin settings are intentionally not carried into Fortweb.";

            headingBlock.append(eyebrow, title, copy);
            header.append(headingBlock);

            const columns = document.createElement("section");
            columns.className = "page-columns";

            const defaultsCard = document.createElement("section");
            defaultsCard.className = "section-card settings-panel";

            const defaultsTitle = document.createElement("h2");
            defaultsTitle.textContent = "Vault Defaults";

            const defaultsGrid = document.createElement("dl");
            defaultsGrid.className = "detail-grid";
            defaultsGrid.append(
                detailItem("Vault", vault.alias),
                detailItem("Temporary Datastore", enabledLabel(settings.tempDatastore)),
                detailItem("Key Algorithm", settings.keyAlgorithm),
                detailItem("Key Tier", settings.keyTier),
                detailItem("Witness Profile", settings.witnessProfile),
            );

            defaultsCard.append(defaultsTitle, defaultsGrid);

            const runtimeCard = document.createElement("section");
            runtimeCard.className = "section-card settings-panel";

            const runtimeTitle = document.createElement("h2");
            runtimeTitle.textContent = "Storage and Runtime";

            const runtimeGrid = document.createElement("dl");
            runtimeGrid.className = "detail-grid";
            runtimeGrid.append(
                detailItem("Storage Backend", settings.storageBackend),
                detailItem("Runtime Status", settings.runtimeStatus),
            );

            runtimeCard.append(runtimeTitle, runtimeGrid);
            columns.append(defaultsCard, runtimeCard);

            const dangerZone = document.createElement("section");
            dangerZone.className = "section-card danger-zone settings-panel settings-panel--danger";

            const dangerTitle = document.createElement("h2");
            dangerTitle.textContent = "Danger Zone";

            const dangerCopy = document.createElement("p");
            dangerCopy.className = "muted";
            dangerCopy.textContent = "Deleting a vault permanently removes all local keys, identifiers, and remote state stored in this vault.";

            const actions = document.createElement("div");
            actions.className = "panel__actions";

            const deleteButton = document.createElement("button");
            deleteButton.className = "button button--danger";
            deleteButton.type = "button";
            deleteButton.textContent = "Delete Vault";

            if (typeof onDeleteVault === "function") {
                deleteButton.addEventListener("click", () => {
                    openDeleteConfirmation(vault, onDeleteVault);
                });
            } else {
                deleteButton.disabled = true;
            }

            actions.append(deleteButton);
            dangerZone.append(dangerTitle, dangerCopy, actions);

            page.append(header, columns, dangerZone);
            container.append(page);
        },
    };
}
