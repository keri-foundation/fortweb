import { escapeHtml } from "../../shared/dom.js";

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

interface BadgeProps {
    label: string;
    tone?: BadgeTone;
    className?: string;
}

export function badgeHtml(props: BadgeProps): string {
    const { label, tone = "neutral", className = "" } = props;
    const classes = ["badge", `badge--${tone}`, className].filter(Boolean).join(" ");
    return `<span class="${classes}">${escapeHtml(label)}</span>`;
}