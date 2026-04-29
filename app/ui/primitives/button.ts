import { escapeHtml } from "../../shared/dom.js";

type ButtonTone = "primary" | "secondary" | "ghost" | "danger";
type ButtonType = "button" | "submit" | "reset";

interface ButtonProps {
    label: string;
    tone?: ButtonTone;
    type?: ButtonType;
    disabled?: boolean;
    icon?: string;
    dataAction?: string;
    className?: string;
}

export function buttonHtml(props: ButtonProps): string {
    const {
        label,
        tone = "primary",
        type = "button",
        disabled = false,
        icon = "",
        dataAction = "",
        className = "",
    } = props;

    const classes = [
        "button",
        `button--${tone}`,
        className,
    ].filter(Boolean).join(" ");

    const attrs = [
        `type="${type}"`,
        `class="${classes}"`,
        disabled ? "disabled" : "",
        dataAction ? `data-action="${escapeHtml(dataAction)}"` : "",
    ].filter(Boolean).join(" ");

    return `<button ${attrs}>${icon}<span>${escapeHtml(label)}</span></button>`;
}