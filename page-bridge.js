/**
 * MAIN world — same JS realm as bombparty.js (wordInput, socket, form handlers).
 */
(function () {
  "use strict";

  const SUBMIT_EVT = "__bombparty_helper_submit";
  const RESULT_EVT = "__bombparty_helper_result";

  let cachedSocket = null;

  function getSocket() {
    if (cachedSocket && typeof cachedSocket.emit === "function") return cachedSocket;
    try {
      if (typeof socket !== "undefined" && socket && typeof socket.emit === "function") {
        cachedSocket = socket;
        return cachedSocket;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function findTurnInput() {
    const self =
      document.querySelector(".selfTurn:not([hidden])") ||
      document.querySelector(".selfTurn");
    if (!self) return null;
    return (
      self.querySelector('input[type="text"]') ||
      self.querySelector("input:not([type])")
    );
  }

  function findTurnForm() {
    const self =
      document.querySelector(".selfTurn:not([hidden])") ||
      document.querySelector(".selfTurn");
    return self ? self.querySelector("form") : null;
  }

  function fillInput(input, word) {
    const tracker = input._valueTracker;
    if (tracker) tracker.setValue(input.value);
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (desc && desc.set) desc.set.call(input, word);
    else input.value = word;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function pressEnterOnInput(input) {
    const win = input.ownerDocument.defaultView || window;
    const K = win.KeyboardEvent || KeyboardEvent;
    for (const type of ["keydown", "keypress", "keyup"]) {
      const opts = {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true,
        ...(type === "keypress" ? { charCode: 13 } : { charCode: 0 }),
      };
      try {
        input.dispatchEvent(new K(type, { ...opts, view: win }));
      } catch {
        input.dispatchEvent(new K(type, opts));
      }
    }
  }

  function submitWord(word) {
    const w = String(word).trim().toLowerCase();
    if (!w) return false;

    const input = findTurnInput();
    const form = findTurnForm();

    if (input) {
      try {
        input.focus({ preventScroll: true });
        if (typeof input.click === "function") input.click();
      } catch {
        /* ignore */
      }
      fillInput(input, w);
    }

    const s = getSocket();
    if (s) {
      s.emit("setWord", w, true);
    }

    if (input) {
      pressEnterOnInput(input);
    }

    if (form) {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      try {
        if (typeof form.requestSubmit === "function") form.requestSubmit();
      } catch {
        /* ignore */
      }
    }

    if (input) {
      pressEnterOnInput(input);
    }

    return !!(input || s);
  }

  document.addEventListener(
    SUBMIT_EVT,
    (e) => {
      const word = e.detail && e.detail.word;
      const ok = !!(word && submitWord(word));
      try {
        document.dispatchEvent(
          new CustomEvent(RESULT_EVT, { detail: { ok, word }, bubbles: true })
        );
      } catch {
        /* ignore */
      }
    },
    true
  );
})();
