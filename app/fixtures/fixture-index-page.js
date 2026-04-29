/**
 * Fixture index page that lists all available fixture routes.
 * Navigating to #/_fixtures shows a clickable index.
 *
 * @module fixtures/fixture-index-page
 */

import { listFixtureKeys } from "./fixture-router.js";

/**
 * @returns {{ title: string, render: function(HTMLElement): void }}
 */
export function renderFixtureIndexPage() {
    return {
        title: "Fixture Index",
        render(container) {
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
                "Each link renders a page with deterministic mock data. " +
                "Use these for visual regression screenshots.";

            const list = document.createElement("ul");
            list.style.listStyle = "none";
            list.style.padding = "0";
            list.style.display = "flex";
            list.style.flexDirection = "column";
            list.style.gap = "8px";

            for (const key of listFixtureKeys()) {
                const li = document.createElement("li");
                const a = document.createElement("a");
                a.href = `#/_fixtures/${key}`;
                a.className = "button button--secondary";
                a.style.display = "block";
                a.style.textAlign = "left";
                a.textContent = key;
                li.append(a);
                list.append(li);
            }

            section.append(heading, description, list);
            container.append(section);
        },
    };
}
