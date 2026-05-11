import { homeHref } from "../../app/router.js";

export function renderUnlockPage({ vault, onOpenVault }) {
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
                                >
                                <button type="button" class="unlock-passcode-field__toggle" data-unlock-toggle aria-label="Toggle password visibility">
                                    <img src="./assets/icons/browse.svg" alt="" width="22" height="22">
                                </button>
                            </div>
                            <p class="status-line" data-unlock-status></p>
                            <div class="lk-dialog__buttons unlock-dialog-card__buttons">
                                <a class="button button--secondary" href="${homeHref()}">Cancel</a>
                                <button class="button button--primary" type="submit">Open</button>
                            </div>
                        </form>
                    </div>
                </section>
            </section>
        `,
        setup(root) {
            root.querySelector("[data-unlock-title]").textContent = `Open ${vault.alias}`;

            const form = root.querySelector("[data-unlock-form]");
            const statusLine = root.querySelector("[data-unlock-status]");
            const submitButton = form.querySelector("button[type='submit']");
            const passcodeInput = form.querySelector("input[name='passcode']");

            root.querySelector("[data-unlock-toggle]")?.addEventListener("click", () => {
                passcodeInput.type = passcodeInput.type === "password" ? "text" : "password";
            });

            form.addEventListener("submit", async (event) => {
                event.preventDefault();
                const formData = new FormData(form);

                submitButton.disabled = true;
                statusLine.textContent = "";

                try {
                    await onOpenVault(String(formData.get("passcode") || ""));
                } catch (error) {
                    submitButton.disabled = false;
                    statusLine.textContent = error.message || "Vault open failed.";
                }
            });
        },
    };
}
