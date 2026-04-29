const ESCAPE_LOOKUP: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ESCAPE_LOOKUP[character]);
}

export function formatDateLabel(value: string | number | Date | null | undefined): string {
    if (!value) {
        return "Not opened yet";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(date);
}

export function toneClass(tone: string | null | undefined): string {
    return {
        success: "badge badge--success",
        warning: "badge badge--warning",
        danger: "badge badge--danger",
        info: "badge badge--info",
    }[tone ?? ""] || "badge badge--neutral";
}