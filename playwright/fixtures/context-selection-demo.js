(() => {
  "use strict";

  const STATES = Object.freeze({
    NO_CONTEXTS: "NO_CONTEXTS",
    SUGGESTED_CONTEXT: "SUGGESTED_CONTEXT",
    SELECTING_CONTEXT: "SELECTING_CONTEXT",
    CREATING_CONTEXT: "CREATING_CONTEXT",
    CONFIRMING_CONTEXT: "CONFIRMING_CONTEXT",
    DEMO_COMPLETE: "DEMO_COMPLETE",
  });
  const explanation = "A context is a part of your life, such as work or family. Keeping contexts separate can help reduce how easily separate interactions are linked. This does not prevent all tracking.";
  const expandedExplanation = "Some presentations can use different identifiers or credentials. Other information may still connect interactions.";
  const root = document.querySelector("#context-demo");
  const suggestedMode = document.documentElement.dataset.mode !== "first-use";
  const model = {
    state: suggestedMode ? STATES.SUGGESTED_CONTEXT : STATES.NO_CONTEXTS,
    contexts: suggestedMode ? ["Work", "Family"] : [],
    suggestion: suggestedMode ? "Work" : null,
    selected: null,
    selectionOrigin: STATES.SUGGESTED_CONTEXT,
    creationOrigin: STATES.NO_CONTEXTS,
    nameDraft: "",
    error: "",
  };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function whyDisclosure() {
    return `<details class="context-demo__why">
      <summary>Why contexts?</summary>
      <div class="context-demo__why-copy"><p>${explanation}</p><p>${expandedExplanation}</p></div>
    </details>`;
  }

  function heading(title, description = "") {
    return `<header class="context-demo__header">
      <p class="context-demo__eyebrow">Locksmith</p>
      <h1 id="context-demo-title" tabindex="-1">${title}</h1>
      ${description ? `<p class="context-demo__intro">${description}</p>` : ""}
    </header>`;
  }

  function actions(primaryLabel, primaryAction, secondaryLabel, secondaryAction, disabled = false) {
    return `<footer class="context-demo__actions">
      <button class="context-demo__button context-demo__button--primary" type="button" data-action="${primaryAction}" ${disabled ? "disabled" : ""}>${primaryLabel}</button>
      ${secondaryLabel ? `<button class="context-demo__button context-demo__button--secondary" type="button" data-action="${secondaryAction}">${secondaryLabel}</button>` : ""}
    </footer>`;
  }

  function render() {
    root.dataset.state = model.state;
    root.innerHTML = `<section class="context-demo__surface" role="dialog" aria-modal="true" aria-labelledby="context-demo-title" tabindex="-1">${renderState()}</section>`;
    const surface = root.querySelector(".context-demo__surface");
    surface.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const focusable = [...surface.querySelectorAll("button:not(:disabled), input:not(:disabled), summary")]
        .filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === surface)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    });
    root.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => act(button.dataset.action)));
    root.querySelector("#context-name")?.addEventListener("input", (event) => {
      model.nameDraft = event.currentTarget.value;
      const save = root.querySelector('[data-action="save-context"]');
      if (save) save.disabled = !model.nameDraft.trim();
      model.error = "";
      root.querySelector("[data-error]")?.remove();
      root.querySelector("#context-name")?.removeAttribute("aria-invalid");
    });
    root.querySelector("#context-demo-title")?.focus({ preventScroll: true });
  }

  function renderState() {
    switch (model.state) {
      case STATES.NO_CONTEXTS:
        return `${heading("Create your first context", explanation)}${whyDisclosure()}
          ${nameField()}${actions("Save context", "save-context", "", "", !model.nameDraft.trim())}`;
      case STATES.SUGGESTED_CONTEXT:
        return `${heading("Choose a context", explanation)}${whyDisclosure()}
          <div class="context-demo__suggestion"><span class="context-demo__eyebrow">Suggested</span><strong>${escapeHtml(model.suggestion)}</strong></div>
          ${actions(`Use ${escapeHtml(model.suggestion)}`, "use-suggestion", "Choose another", "choose-another")}`;
      case STATES.SELECTING_CONTEXT:
        return `${heading("Choose a context", explanation)}${whyDisclosure()}
          <fieldset class="context-demo__choices"><legend class="context-demo__eyebrow">Your contexts</legend>
            ${model.contexts.map((name, index) => `<label class="context-demo__choice" for="context-option-${index}">
              <input id="context-option-${index}" type="radio" name="context-choice" value="${escapeHtml(name)}">
              <span class="context-demo__radio" aria-hidden="true"></span><span class="context-demo__choice-name">${escapeHtml(name)}</span>
              ${name === model.suggestion ? '<span class="context-demo__choice-note">Suggested</span>' : ""}
            </label>`).join("")}
          </fieldset>
          <div class="context-demo__selector-footer">
            <button class="context-demo__text-button" type="button" data-action="create-new">Create new context</button>
            ${actions("Continue", "select-context", "Cancel", "cancel-selection", true)}
          </div>`;
      case STATES.CREATING_CONTEXT:
        return `${heading("Create a context", "Give this context a name that makes sense to you.")}${whyDisclosure()}
          ${nameField()}${actions("Save context", "save-context", "Cancel", "cancel-creation", !model.nameDraft.trim())}`;
      case STATES.CONFIRMING_CONTEXT:
        return `${heading("Before you continue")}
          <div class="context-demo__confirmation"><span class="context-demo__eyebrow">Present using</span><strong>${escapeHtml(model.selected)}</strong></div>
          ${actions("Continue", "complete-demo", "Change", "change-context")}`;
      case STATES.DEMO_COMPLETE:
        return `${heading("Context confirmed", "This prototype stops before credentials are presented.")}`;
      default:
        return "";
    }
  }

  function nameField() {
    return `<div class="context-demo__field">
      <label for="context-name">Context name</label>
      <input id="context-name" name="context-name" type="text" maxlength="80" autocomplete="off" required value="${escapeHtml(model.nameDraft)}" aria-describedby="context-name-hint" ${model.error ? 'aria-invalid="true"' : ""}>
      <p id="context-name-hint" class="context-demo__hint">Choose a name you will recognize.</p>
      ${model.error ? `<div class="context-demo__duplicate" data-error><p class="context-demo__error" role="alert">${escapeHtml(model.error)}</p><button class="context-demo__text-button" type="button" data-use-existing="${escapeHtml(model.contexts.find((context) => context.toLocaleLowerCase("en-US") === model.nameDraft.trim().toLocaleLowerCase("en-US")) || "")}">Use ${escapeHtml(model.contexts.find((context) => context.toLocaleLowerCase("en-US") === model.nameDraft.trim().toLocaleLowerCase("en-US")) || "existing context")}</button></div>` : ""}
    </div>`;
  }

  function act(action) {
    if (action === "use-suggestion") {
      model.selected = model.suggestion;
      model.state = STATES.CONFIRMING_CONTEXT;
    } else if (action === "choose-another") {
      model.selectionOrigin = STATES.SUGGESTED_CONTEXT;
      model.state = STATES.SELECTING_CONTEXT;
    } else if (action === "create-new") {
      model.creationOrigin = STATES.SELECTING_CONTEXT;
      model.nameDraft = "";
      model.error = "";
      model.state = STATES.CREATING_CONTEXT;
    } else if (action === "select-context") {
      const chosen = root.querySelector('input[name="context-choice"]:checked');
      if (!chosen) return;
      model.selected = chosen.value;
      model.state = STATES.CONFIRMING_CONTEXT;
    } else if (action === "cancel-selection") {
      model.state = model.selectionOrigin;
    } else if (action === "cancel-creation") {
      model.nameDraft = "";
      model.error = "";
      model.state = model.creationOrigin;
    } else if (action === "save-context") {
      const name = model.nameDraft.trim();
      if (!name) return;
      const existing = model.contexts.find((context) => context.toLocaleLowerCase("en-US") === name.toLocaleLowerCase("en-US"));
      if (existing) {
        model.error = `A context named ${existing} already exists.`;
        render();
        return;
      }
      model.contexts.push(name);
      model.selected = name;
      model.nameDraft = "";
      model.error = "";
      model.state = STATES.CONFIRMING_CONTEXT;
    } else if (action === "change-context") {
      model.selectionOrigin = STATES.CONFIRMING_CONTEXT;
      model.state = STATES.SELECTING_CONTEXT;
    } else if (action === "complete-demo") {
      model.state = STATES.DEMO_COMPLETE;
    }
    render();
  }

  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-use-existing]");
    if (button) {
      model.selected = button.dataset.useExisting;
      model.error = "";
      model.nameDraft = "";
      model.state = STATES.CONFIRMING_CONTEXT;
      render();
    }
  });
  root.addEventListener("change", (event) => {
    if (event.target.matches('input[name="context-choice"]')) {
      const next = root.querySelector('[data-action="select-context"]');
      if (next) next.disabled = false;
    }
  });

  window.contextSelectionDemo = Object.freeze({ states: STATES, getState: () => model.state });
  render();
})();
