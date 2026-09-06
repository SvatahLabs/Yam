/**
 * The in-page picker (Draft 2.21, REQ-REC-12): an overlay that names the phrase,
 * follows the pointer, and stamps the element a person clicks with
 * `data-yam-picked`. Module (a)'s `bind()` record mode and the recorder's human
 * gateway both use it, from here, so a person's click is one thing.
 */
/** The in-page picker: highlight what the pointer is over, resolve on click. */
export const PICKER_SCRIPT = `(id) => {
  const previous = window.__yamPicker__;
  if (previous) previous.cancel();

  const overlay = document.createElement("div");
  overlay.setAttribute("data-yam-picker", "overlay");
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", zIndex: "2147483646", pointerEvents: "none",
  });

  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "fixed", border: "2px solid #2f5bd7", background: "rgba(47,91,215,0.12)",
    borderRadius: "3px", pointerEvents: "none", transition: "all 40ms linear",
  });

  const label = document.createElement("div");
  Object.assign(label.style, {
    position: "fixed", top: "0", left: "0", right: "0", padding: "8px 12px",
    font: "13px system-ui, sans-serif", background: "#14161a", color: "#fff",
    pointerEvents: "none", zIndex: "2147483647",
  });
  label.textContent = "Yam is recording \\u2014 click the element for \\u201c" + id + "\\u201d (Esc to cancel)";

  overlay.appendChild(box);
  document.documentElement.appendChild(overlay);
  document.documentElement.appendChild(label);

  return new Promise((resolve) => {
    let hovered = null;

    const paint = (element) => {
      if (!element) return;
      const r = element.getBoundingClientRect();
      Object.assign(box.style, {
        left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px",
      });
    };

    const onMove = (event) => {
      hovered = document.elementFromPoint(event.clientX, event.clientY);
      paint(hovered);
    };

    const finish = (value) => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      label.remove();
      delete window.__yamPicker__;
      resolve(value);
    };

    const onClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const element = document.elementFromPoint(event.clientX, event.clientY);
      if (!element) return;
      element.setAttribute("data-yam-picked", id);
      finish(true);
    };

    const onKey = (event) => {
      if (event.key === "Escape") finish(false);
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    window.__yamPicker__ = { cancel: () => finish(false) };
  });
}`;

/** The attribute the picker stamps on the clicked element. */
export const PICKED_ATTRIBUTE = "data-yam-picked";
