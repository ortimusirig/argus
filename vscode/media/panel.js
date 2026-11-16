// The Argus panel's page. It only sends messages to the extension and remembers which parts are folded.
// It reads nothing from anywhere and writes no HTML.
(function () {
  const vscode = acquireVsCodeApi();

  function send(target) {
    if (target.dataset.note !== undefined) { vscode.postMessage({ type: "openNote", name: target.dataset.note }); return true; }
    if (target.dataset.href !== undefined) { vscode.postMessage({ type: "external", href: target.dataset.href }); return true; }
    if (target.dataset.pick !== undefined) { vscode.postMessage({ type: "pick", id: Number(target.dataset.pick) }); return true; }
    if (target.dataset.obsidian !== undefined) { vscode.postMessage({ type: "obsidian", id: Number(target.dataset.obsidian) }); return true; }
    if (target.dataset.msg === "create") { vscode.postMessage({ type: "create" }); return true; }
    if (target.dataset.msg === "check") { vscode.postMessage({ type: "check" }); return true; }
    if (target.dataset.msg === "setup") { vscode.postMessage({ type: "setup" }); return true; }
    return false;
  }

  function sender(event) {
    return event.target instanceof Element ? event.target.closest("a[data-note], a[data-href], button") : null;
  }

  document.addEventListener("click", function (event) {
    const target = sender(event);
    if (target && send(target)) { event.preventDefault(); }
  });

  // Links are reached with the keyboard as buttons are.
  for (const link of document.querySelectorAll("a[data-note], a[data-href]")) {
    link.setAttribute("tabindex", "0");
    link.setAttribute("role", "link");
  }
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Enter") { return; }
    const target = sender(event);
    if (target && target.tagName === "A" && send(target)) { event.preventDefault(); }
  });

  // Folding: a folded part stays as the person left it when the panel is drawn again.
  const folds = (vscode.getState() || {}).folds || {};
  for (const part of document.querySelectorAll("details[data-fold]")) {
    const name = part.dataset.fold;
    if (Object.prototype.hasOwnProperty.call(folds, name)) { part.open = folds[name] === true; }
    part.addEventListener("toggle", function () {
      folds[name] = part.open;
      vscode.setState({ folds: folds });
    });
  }
})();
