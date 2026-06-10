import { homeHref } from "../../app/router.js";
import { formatDateLabel } from "../../shared/dom.js";
import { announce } from "../../ui/core/a11y.js";

interface VaultRecord {
    alias: string;
    storageName?: string;
    createdAt: string;
    otpConfigured?: boolean;
}

interface UnlockPageProps {
    vault: VaultRecord;
    onOpenVault(passcode: string): Promise<void>;
}

function errorMessage(error: unknown): string {
    if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "TIMEOUT"
    ) {
        return "The vault took too long to open. This can happen after the app has been in the background. Please try again.";
    }

    return error instanceof Error && error.message ? error.message : "Vault open failed.";
}

export function renderUnlockPage({ vault, onOpenVault }: UnlockPageProps) {
    return {
        title: `Unlock ${vault.alias}`,
        html: `
            <section class="unlock-stage">
                <div class="unlock-stage__splash" aria-hidden="true">
                    <img src="./assets/brand/SymbolLogo.svg" alt="">
                </div>
                <section class="unlock-dialog-card" aria-labelledby="unlock-title">
                    <header class="unlock-dialog-card__header">
                        <div class="unlock-dialog-card__title-block">
                            <h1 id="unlock-title" data-unlock-title></h1>
                            <p class="unlock-dialog-card__meta" data-unlock-meta></p>
                        </div>
                        <a class="unlock-dialog-card__close" href="${homeHref()}" aria-label="Back to Vaults">
                            <img src="./assets/icons/close.svg" alt="">
                        </a>
                    </header>
                    <div class="lk-dialog__divider"></div>
                    <div class="unlock-dialog-card__body">
                        <form class="field-stack" data-unlock-form>
                            <div class="unlock-passcode-field">
                                <label class="visually-hidden" for="unlock-passcode">Passcode</label>
                                <input
                                    class="unlock-passcode-field__input"
                                    type="password"
                                    name="passcode"
                                    id="unlock-passcode"
                                    placeholder="Passcode"
                                    autocomplete="off"
                                    aria-describedby="unlock-status"
                                >
                                <button type="button" class="unlock-passcode-field__toggle" data-unlock-toggle aria-label="Toggle password visibility">
                                    <img src="./assets/icons/browse.svg" alt="" width="22" height="22">
                                </button>
                            </div>
                            <p class="status-line" id="unlock-status" data-unlock-status role="status" aria-live="polite"></p>
                            <div class="lk-dialog__buttons unlock-dialog-card__buttons">
                                <a class="button button--secondary" href="${homeHref()}">Cancel</a>
                                <button class="button button--primary" type="submit">Open</button>
                            </div>
                        </form>
                    </div>
                </section>
            </section>
        `,
        setup(root: HTMLElement): void {
            const title = root.querySelector("[data-unlock-title]");
            const meta = root.querySelector("[data-unlock-meta]");
            const form = root.querySelector("[data-unlock-form]");
            const statusLine = root.querySelector("[data-unlock-status]");
            const toggleButton = root.querySelector("[data-unlock-toggle]");

            if (
                !(title instanceof HTMLElement) ||
                !(meta instanceof HTMLElement) ||
                !(form instanceof HTMLFormElement) ||
                !(statusLine instanceof HTMLElement)
            ) {
                return;
            }

            const submitButton = form.querySelector("button[type='submit']");
            const passcodeInput = form.querySelector("input[name='passcode']");

            if (!(submitButton instanceof HTMLButtonElement) || !(passcodeInput instanceof HTMLInputElement)) {
                return;
            }

            title.textContent = `Open ${vault.alias}`;
            meta.textContent = [
                vault.storageName || "Browser-safe vault",
                `Created ${formatDateLabel(vault.createdAt)}`,
                `2FA ${vault.otpConfigured ? "configured" : "deferred"}`,
            ].join(" · ");

            if (toggleButton instanceof HTMLElement) {
                toggleButton.addEventListener("click", () => {
                    passcodeInput.type = passcodeInput.type === "password" ? "text" : "password";
                });
            }

            form.addEventListener("submit", async (event) => {
                event.preventDefault();
                const formData = new FormData(form);

                submitButton.disabled = true;
                statusLine.textContent = "Opening vault...";
                statusLine.classList.remove("status-line--error");
                statusLine.classList.add("status-line--loading");
                announce("Opening vault, please wait.");

                try {
                    await onOpenVault(String(formData.get("passcode") || ""));
                } catch (error) {
                    const message = errorMessage(error);

                    submitButton.disabled = false;
                    statusLine.classList.remove("status-line--loading");
                    statusLine.classList.add("status-line--error");
                    statusLine.textContent = message;
                    announce(message, "assertive");
                    passcodeInput.focus();
                }
            });
        },
    };
}