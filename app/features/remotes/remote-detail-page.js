import { remotesHref } from "../../app/router.js";
import { formatDateLabel, toneClass } from "../../shared/dom.js";
import { showToast } from "../../ui/composites/toast.js";
import { badgeHtml } from "../../ui/primitives/badge.js";

/**
 * @typedef {Object} RemoteDetailProps
 * @property {Object} vault
 * @property {Object} remote
 */

function detailItem(label, value, valueClassName = "") {
    const wrapper = document.createElement("div");
    wrapper.className = "detail-item";

    const term = document.createElement("dt");
    term.textContent = label;

    const description = document.createElement("dd");
    description.textContent = value || "Not recorded";
    if (valueClassName) {
        description.className = valueClassName;
    }

    wrapper.append(term, description);
    return wrapper;
}

function copyableDetailItem(label, value) {
    const wrapper = document.createElement("div");
    wrapper.className = "detail-item";

    const term = document.createElement("dt");
    term.textContent = label;

    const description = document.createElement("dd");
    description.className = "mono detail-item__copyable";

    const span = document.createElement("span");
    span.textContent = value || "Not recorded";

    if (value) {
        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "icon-button icon-button--inline";
        copyBtn.setAttribute("aria-label", `Copy ${label}`);
        copyBtn.innerHTML = '<img src="./assets/icons/copy.svg" alt="" width="16" height="16">';
        copyBtn.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(value);
                showToast({ message: "Copied to clipboard.", tone: "success", durationMs: 2000 });
            } catch {
                showToast({ message: "Copy failed.", tone: "error", durationMs: 3000 });
            }
        });
        description.append(span, copyBtn);
    } else {
        description.append(span);
    }

    wrapper.append(term, description);
    return wrapper;
}

function renderRolePills(remote) {
    if (!remote.roles.length) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "No roles are recorded for this remote identifier in the current browser-vault slice.";
        return empty;
    }

    const row = document.createElement("div");
    row.className = "meta-pill-row";
    remote.roles.forEach((role) => {
        row.insertAdjacentHTML("beforeend", badgeHtml({ label: role, tone: "neutral" }));
    });
    return row;
}

/**
 * @param {RemoteDetailProps} props
 */
export function renderRemoteDetailPage({ vault, remote }) {
    return {
        title: remote.alias,
        render(container) {
            container.replaceChildren();

            const page = document.createElement("section");
            page.className = "page-grid page-grid--detail";

            const header = document.createElement("header");
            header.className = "page-header";

            const headingBlock = document.createElement("div");

            const eyebrow = document.createElement("p");
            eyebrow.className = "page-header__eyebrow";
            eyebrow.textContent = vault.alias;

            const title = document.createElement("h1");
            title.textContent = remote.alias;

            const copy = document.createElement("p");
            copy.textContent =
                "This routed detail view keeps remote identity state separate from local identifiers while still showing the organizer-backed metadata that survives reload.";

            headingBlock.append(eyebrow, title, copy);

            const actions = document.createElement("div");
            actions.className = "page-header__actions";

            const backLink = document.createElement("a");
            backLink.className = "button button--secondary";
            backLink.href = remotesHref(vault.id);
            backLink.textContent = "Back to Remote Identifiers";

            actions.append(backLink);
            header.append(headingBlock, actions);

            const summary = document.createElement("section");
            summary.className = "detail-card detail-card--flat";

            const summaryHeader = document.createElement("div");
            summaryHeader.className = "detail-card__header";

            const summaryTitle = document.createElement("div");
            summaryTitle.className = "detail-card__title";

            const summaryHeading = document.createElement("h2");
            summaryHeading.textContent = "Remote Summary";

            const summaryAid = document.createElement("p");
            summaryAid.className = "muted mono";
            summaryAid.textContent = remote.prefix;

            summaryTitle.append(summaryHeading, summaryAid);

            const status = document.createElement("span");
            status.className = toneClass(remote.statusTone);
            status.textContent = remote.status;

            summaryHeader.append(summaryTitle, status);

            const summaryGrid = document.createElement("div");
            summaryGrid.className = "summary-grid";

            const summaryItems = [
                ["Sequence Number", remote.sequenceNumber == null ? "Not resolved" : String(remote.sequenceNumber)],
                ["Transferability", remote.transferability],
                ["Verifications", String(remote.verificationCount || 0)],
            ];

            summaryItems.forEach(([label, value]) => {
                const item = document.createElement("div");
                item.className = "summary-item";

                const itemLabel = document.createElement("span");
                itemLabel.textContent = label;

                const itemValue = document.createElement("span");
                itemValue.textContent = value;

                item.append(itemLabel, itemValue);
                summaryGrid.append(item);
            });

            summary.append(summaryHeader, summaryGrid);

            const columns = document.createElement("section");
            columns.className = "page-columns";

            const stateCard = document.createElement("section");
            stateCard.className = "section-card";

            const stateTitle = document.createElement("h2");
            stateTitle.textContent = "Key State";

            const stateGrid = document.createElement("dl");
            stateGrid.className = "detail-grid";
            stateGrid.append(
                copyableDetailItem("Prefix", remote.prefix),
                copyableDetailItem("Last Event SAID", remote.lastEventDigest),
                copyableDetailItem("OOBI", remote.oobi),
                detailItem(
                    "Key State Updated",
                    remote.keystateUpdatedAt ? formatDateLabel(remote.keystateUpdatedAt) : "Not recorded",
                ),
            );

            stateCard.append(stateTitle, stateGrid);

            const metadataCard = document.createElement("section");
            metadataCard.className = "section-card";

            const metadataTitle = document.createElement("h2");
            metadataTitle.textContent = "Metadata";

            const metadataGrid = document.createElement("dl");
            metadataGrid.className = "detail-grid";
            metadataGrid.append(
                detailItem("Alias", remote.alias),
                detailItem("Organization", remote.org),
                detailItem("Company", remote.company),
                detailItem("Note", remote.note),
            );

            metadataCard.append(metadataTitle, metadataGrid);
            columns.append(stateCard, metadataCard);

            const secondaryColumns = document.createElement("section");
            secondaryColumns.className = "page-columns";

            const rolesCard = document.createElement("section");
            rolesCard.className = "section-card";

            const rolesTitle = document.createElement("h2");
            rolesTitle.textContent = "Roles";
            rolesCard.append(rolesTitle, renderRolePills(remote));

            const connectivityCard = document.createElement("section");
            connectivityCard.className = "section-card";

            const connectivityTitle = document.createElement("h2");
            connectivityTitle.textContent = "Connectivity";

            const connectivityGrid = document.createElement("dl");
            connectivityGrid.className = "detail-grid";
            connectivityGrid.append(
                detailItem("Mailboxes", remote.mailboxes.length ? remote.mailboxes.join(", ") : "Not recorded"),
                detailItem("KEL Events", String(remote.kelEvents)),
                detailItem("Slice Status", "Roles and mailboxes are read-only in this remotes slice."),
            );

            connectivityCard.append(connectivityTitle, connectivityGrid);
            secondaryColumns.append(rolesCard, connectivityCard);

            page.append(header, summary, columns, secondaryColumns);
            container.append(page);
        },
    };
}
