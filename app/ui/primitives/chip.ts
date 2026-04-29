import { escapeHtml } from "../../shared/dom.js";

type ChipTone = "neutral" | "success" | "warning" | "danger" | "info";

interface ChipProps {
    label: string;
    tone?: ChipTone;
    selected?: boolean;
    dataValue?: string;
    className?: string;
}

export function chipHtml(props: ChipProps): string {
    const {
        label,
        tone = "neutral",
        selected = false,
        dataValue = "",
        className = "",
    } = props;

    const classes = [
        "ui-chip",
        `ui-chip--${tone}`,
        selected ? "is-active" : "",
        className,
    ].filter(Boolean).join(" ");

    const attrs = [
        `class="${classes}"`,
        'type="button"',
        dataValue ? `data-value="${escapeHtml(dataValue)}"` : "",
        selected ? 'aria-pressed="true"' : 'aria-pressed="false"',
    ].filter(Boolean).join(" ");

    return `<button ${attrs}>${escapeHtml(label)}</button>`;
}