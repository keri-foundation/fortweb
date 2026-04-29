import { listFixtureKeys } from "./fixture-router.js";

interface PageRecord {
    title: string;
    render(container: HTMLElement): void;
}

export function renderFixtureIndexPage(): PageRecord {
    return {
        title: "Fixture Index",
        render(container: HTMLElement): void {
            container.replaceChildren();

            const section = document.createElement("section");
            section.className = "placeholder-card";
            section.style.maxWidth = "600px";
            section.style.margin = "32px auto";

            const heading = document.createElement("h2");
            heading.textContent = "Fixture Routes";

            const description = document.createElement("p");
            description.className = "muted";
            description.textContent =
                "Each link renders a page with deterministic mock data. Use these for visual regression screenshots.";

            const list = document.createElement("ul");
            list.style.listStyle = "none";
            list.style.padding = "0";
            list.style.display = "flex";
            list.style.flexDirection = "column";
            list.style.gap = "8px";

            for (const key of listFixtureKeys()) {
                const item = document.createElement("li");
                const link = document.createElement("a");
                link.href = `#/_fixtures/${key}`;
                link.className = "button button--secondary";
                link.style.display = "block";
                link.style.textAlign = "left";
                link.textContent = key;
                item.append(link);
                list.append(item);
            }

            section.append(heading, description, list);
            container.append(section);
        },
    };
}