export interface ToastMessage {
    message: string;
    tone?: "info" | "success" | "warning" | "error";
    durationMs?: number;
    actionLabel?: string;
    onAction?: () => void;
}

let toastContainer: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
    if (toastContainer && document.body.contains(toastContainer)) {
        return toastContainer;
    }
    toastContainer = document.createElement("div");
    toastContainer.className = "ui-toast-container";
    toastContainer.setAttribute("aria-live", "polite");
    toastContainer.setAttribute("aria-atomic", "false");
    document.body.appendChild(toastContainer);
    return toastContainer;
}

/**
 * Show a toast notification.
 */
export function showToast(props: ToastMessage): void {
    const {
        message,
        tone = "info",
        durationMs = 3000,
        actionLabel = "",
        onAction,
    } = props;

    const container = ensureContainer();

    const toast = document.createElement("div");
    toast.className = `ui-toast ui-toast--${tone}`;
    toast.setAttribute("role", "status");

    const messageSpan = document.createElement("span");
    messageSpan.className = "ui-toast__message";
    messageSpan.textContent = message;
    toast.appendChild(messageSpan);

    if (actionLabel) {
        const actionBtn = document.createElement("button");
        actionBtn.className = "ui-toast__action";
        actionBtn.textContent = actionLabel;
        actionBtn.addEventListener("click", () => {
            onAction?.();
            dismiss();
        });
        toast.appendChild(actionBtn);
    }

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));

    let timer: ReturnType<typeof setTimeout> | null = null;

    function dismiss(): void {
        if (timer) clearTimeout(timer);
        toast.classList.remove("is-visible");
        toast.addEventListener("transitionend", () => toast.remove(), { once: true });
        setTimeout(() => toast.remove(), 300);
    }

    timer = setTimeout(dismiss, durationMs);
}
