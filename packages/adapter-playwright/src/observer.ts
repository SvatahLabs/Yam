/**
 * The in-page observer (Draft 2.23, REQ-REC-13): what a person does in the
 * driven session, reported as it happens.
 *
 * Each click, committed value, choice and Enter stamps the element acted on
 * with `data-yam-observed=<n>` and calls the exposed binding with what
 * happened. The adapter finds the stamp, mints a reference, removes the stamp,
 * and hands the recorder an event on an element — the same element a snapshot
 * would have shown, so the binding synthesised from it is one a replay can find.
 * A click that navigates would take the element with it, so the page holds the
 * door itself: a click on a link or a submit button, and a form's submit, are
 * cancelled, the observations in flight are awaited — the binding's promise
 * resolves when the recorder has bound the element — and the click is
 * dispatched again, or the form resubmitted, marked to pass. The person sees a
 * click that takes a moment longer. The adapter holds the request too, as a
 * second line, for navigations a script starts.
 *
 * A click is reported on `click`, after the blur it caused has committed the
 * value of the field the person was in — so a value typed and a button pressed
 * arrive in the order they were done.
 */
export const OBSERVED_ATTRIBUTE = "data-yam-observed";
export const OBSERVER_BINDING = "__yamObserved";

export const OBSERVER_SCRIPT = `(() => {
  if (window.__yamObserver__) return;
  window.__yamObserver__ = true;
  let seq = 0;
  const INTERACTIVE = "a,button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=switch],[role=option],[contenteditable=true]";
  const TEXTLESS = ["checkbox", "radio", "button", "submit", "reset", "file", "range", "color", "image"];
  const typeOf = (el) => (el.getAttribute("type") || "text").toLowerCase();
  const isText = (el) => el.tagName === "TEXTAREA" || el.isContentEditable || (el.tagName === "INPUT" && !TEXTLESS.includes(typeOf(el)));
  const isToggle = (el) => el.tagName === "INPUT" && (typeOf(el) === "checkbox" || typeOf(el) === "radio");
  const inflight = new Set();
  const report = (element, detail) => {
    if (!element || element.closest("[data-yam-picker]")) return Promise.resolve();
    const id = String(++seq);
    element.setAttribute("${OBSERVED_ATTRIBUTE}", id);
    const send = window["${OBSERVER_BINDING}"];
    if (typeof send !== "function") return Promise.resolve();
    const one = Promise.resolve(send(JSON.stringify(Object.assign({ id }, detail)))).catch(() => undefined);
    inflight.add(one);
    one.then(() => inflight.delete(one));
    return one;
  };
  const settled = () => Promise.race([Promise.all([...inflight]), new Promise((done) => setTimeout(done, 5000))]);
  const navigates = (el) => {
    if (el.tagName === "A") return el.hasAttribute("href");
    if (el.tagName === "BUTTON") return !!el.form && (!el.hasAttribute("type") || typeOf(el) === "submit");
    if (el.tagName === "INPUT") return !!el.form && (typeOf(el) === "submit" || typeOf(el) === "image");
    return false;
  };
  const actedOn = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return null;
    return target.closest(INTERACTIVE) || target;
  };
  const clickable = (el) => !isText(el) && !isToggle(el) && el.tagName !== "SELECT" && el.tagName !== "LABEL" && el.tagName !== "OPTION";
  window.__yamObserverIdle = settled;
  document.addEventListener("click", (event) => {
    if (event.__yamPassed) return;
    const el = actedOn(event);
    if (!el || !clickable(el)) return;
    report(el, { kind: "click" });
    if (!navigates(el) || event.defaultPrevented) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const again = new MouseEvent("click", {
      bubbles: true, cancelable: true, composed: true, view: window,
      ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey, button: event.button,
    });
    again.__yamPassed = true;
    settled().then(() => el.dispatchEvent(again));
  }, true);
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.__yamPassed) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const submitter = event.submitter || undefined;
    settled().then(() => {
      form.__yamPassed = true;
      try { form.requestSubmit(submitter); } catch { form.submit(); } finally { form.__yamPassed = false; }
    });
  }, true);
  document.addEventListener("change", (event) => {
    const el = event.target instanceof Element ? event.target : null;
    if (!el) return;
    if (el.tagName === "SELECT") {
      const option = el.options[el.selectedIndex];
      report(el, { kind: "select", label: option ? (option.label || option.text) : "" });
      return;
    }
    if (isToggle(el)) { report(el, { kind: "check", checked: !!el.checked }); return; }
    if (isText(el)) report(el, { kind: "type", value: el.isContentEditable ? (el.textContent || "") : el.value, secret: typeOf(el) === "password" });
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const el = event.target instanceof Element ? event.target : null;
    if (!el || !isText(el) || el.tagName === "TEXTAREA") return;
    report(el, { kind: "type", value: el.value, secret: typeOf(el) === "password" });
    report(el, { kind: "press", key: "Enter" });
  }, true);
})()`;

/** One action a scripted person performs (`YAM_OBSERVE`, the test affordance). */
export interface ScriptedAction {
  readonly action: "goto" | "click" | "fill" | "select" | "check" | "uncheck" | "press";
  readonly selector?: string;
  readonly value?: string;
  readonly url?: string;
}
