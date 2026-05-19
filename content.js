(function () {
  "use strict";

  const STORAGE_KEY = "bombparty_cheat_enabled";
  const SUBMIT_EVT = "__bombparty_helper_submit";
  const RESULT_EVT = "__bombparty_helper_result";

  /** Every word played this match (you + others) — BombParty forbids reusing any of them. */
  const wordsPlayedThisMatch = new Set();
  /** Words we already tried this turn (invalid / rejected) so we pick another. */
  const failedAttempts = new Set();
  const MAX_SUBMIT_TRIES = 6;
  const AFTER_SUBMIT_MS = 400;
  let typing = false;
  let activePrompt = null;
  let lastPathname = location.pathname;
  let enabled = loadEnabled();

  function loadEnabled() {
    try {
      return localStorage.getItem(STORAGE_KEY) !== "0";
    } catch {
      return true;
    }
  }

  function saveEnabled(v) {
    enabled = v;
    try {
      localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: v ? "1" : "0" });
    } catch {
      /* ignore */
    }
  }

  function syncEnabledFromStorage() {
    try {
      chrome.storage.local.get({ [STORAGE_KEY]: null }, (r) => {
        const v = r[STORAGE_KEY];
        if (v === null) return;
        enabled = v !== "0";
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes[STORAGE_KEY]) return;
        enabled = changes[STORAGE_KEY].newValue !== "0";
      });
    } catch {
      /* ignore */
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function isBombpartyGameFrame() {
    return /\/games\/bombparty\/?/i.test(location.pathname || "");
  }

  function isHidden(el) {
    if (!el) return true;
    if (el.hidden) return true;
    if (el.hasAttribute("hidden")) return true;
    try {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return true;
      if (cs.opacity === "0" && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return true;
    } catch {
      return true;
    }
    return false;
  }

  function queryDeep(selectors, root = document) {
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  function findSelfTurn(root) {
    return queryDeep(
      [".selfTurn", "[class*='selfTurn']", "motion.selfTurn", "[data-self-turn]"],
      root
    );
  }

  function findSyllableEl(root) {
    return queryDeep(
      [
        ".round .syllable",
        ".syllable",
        "[class*='syllable']",
        ".prompt .syllable",
        ".game .syllable",
      ],
      root
    );
  }

  function getSyllableText(root) {
    const el = findSyllableEl(root);
    if (!el) return "";
    const t = (el.textContent || "").trim().toLowerCase();
    return /^[a-z]+$/.test(t) ? t : "";
  }

  function findTurnInput(root) {
    const self = findSelfTurn(root);
    if (!self) return null;
    const inp = self.querySelector('input[type="text"]') || self.querySelector("input:not([type])");
    return inp && inp.tagName === "INPUT" ? inp : null;
  }

  function isMyTurn(root) {
    const self = findSelfTurn(root);
    if (!self || isHidden(self)) return false;
    const input = findTurnInput(root);
    if (!input || input.disabled || isHidden(input)) return false;
    return true;
  }

  function clearTurnLock(root) {
    if (!isMyTurn(root)) activePrompt = null;
  }

  let lastRoundParsed = null;

  function detectRoundSignals(root) {
    const path = location.pathname;
    if (path !== lastPathname) {
      wordsPlayedThisMatch.clear();
      failedAttempts.clear();
      activePrompt = null;
      lastPathname = path;
      lastRoundParsed = null;
    }

    const body = root.body;
    if (!body) return;
    const text = body.innerText || "";
    const m = text.match(/\bRound\s+(\d+)\b/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n)) {
        if (lastRoundParsed !== null && lastRoundParsed >= 2 && n === 1) {
          wordsPlayedThisMatch.clear();
          failedAttempts.clear();
          activePrompt = null;
        }
        lastRoundParsed = n;
      }
    }
  }

  function getDict() {
    return globalThis.__BOMB_PARTY_DICT;
  }

  const LEARNED_STORAGE_KEY = "bpLearnedWordsV1";
  const MAX_LEARNED = 25000;
  /** @type {string[]} */
  let learnedList = [];
  /** @type {Set<string>} */
  let learnedSet = new Set();
  let persistLearnedTimer = 0;

  function shouldAcceptLearnedToken(w) {
    if (w.length < 3 || w.length > 22) return false;
    if (!/^[a-z\-]+$/.test(w)) return false;
    if ((w.match(/-/g) || []).length > 3) return false;
    if (!/[aeiouy]/.test(w)) return false;
    return true;
  }

  function extractWordsFromChatBlob(blob) {
    const found = new Set();
    if (!blob) return found;
    const patterns = [
      /\b(?:used|wrote|said|answered|typed)\s*:?\s*["']?([a-z][a-z\-]{2,39})/gi,
      /\b(?:played|submitted)\s+["']?([a-z][a-z\-]{2,39})/gi,
      /[«“\"']([a-z][a-z\-]{2,39})[»”\"']/gi,
    ];
    for (let i = 0; i < patterns.length; i++) {
      const re = patterns[i];
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(blob))) {
        const w = m[1].toLowerCase();
        if (shouldAcceptLearnedToken(w)) found.add(w);
      }
    }
    return found;
  }

  function recordObservedPlay(w) {
    if (!shouldAcceptLearnedToken(w)) return;
    wordsPlayedThisMatch.add(w);
    if (!learnedSet.has(w)) {
      learnedSet.add(w);
      learnedList.push(w);
      while (learnedList.length > MAX_LEARNED) {
        const old = learnedList.shift();
        learnedSet.delete(old);
      }
      schedulePersistLearned();
    }
  }

  function schedulePersistLearned() {
    if (persistLearnedTimer) clearTimeout(persistLearnedTimer);
    persistLearnedTimer = setTimeout(() => {
      persistLearnedTimer = 0;
      try {
        chrome.storage.local.set({ [LEARNED_STORAGE_KEY]: learnedList });
      } catch (e) {
        console.warn("[bombparty-helper] persist learned", e);
      }
    }, 1800);
  }

  function loadLearned() {
    try {
      chrome.storage.local.get({ bpLearnedWordsV1: [] }, (r) => {
        const arr = r.bpLearnedWordsV1;
        learnedList = Array.isArray(arr) ? arr.slice() : [];
        learnedSet = new Set(learnedList);
      });
    } catch (e) {
      console.warn("[bombparty-helper] load learned", e);
    }
  }

  function extractAndLearnFromDom(root) {
    const parts = [];
    const logs = root.querySelectorAll(
      ".chat .log, .chat.pane .log, .log.darkScrollbar, [class*='chat'] .log, div.log"
    );
    for (let i = 0; i < logs.length; i++) parts.push(logs[i].innerText || "");
    const blob = parts.join("\n");
    const words = extractWordsFromChatBlob(blob);
    for (const w of words) recordObservedPlay(w);
  }

  function intersectSortedArrays(arrays) {
    if (arrays.length === 0) return [];
    const nonempty = arrays.filter((a) => a && a.length);
    if (nonempty.length === 0) return [];
    nonempty.sort((a, b) => a.length - b.length);
    let cur = nonempty[0];
    for (let i = 1; i < nonempty.length; i++) {
      const b = nonempty[i];
      const next = [];
      let ia = 0;
      let ib = 0;
      while (ia < cur.length && ib < b.length) {
        const va = cur[ia];
        const vb = b[ib];
        if (va < vb) ia++;
        else if (va > vb) ib++;
        else {
          next.push(va);
          ia++;
          ib++;
        }
      }
      cur = next;
      if (!cur.length) return [];
    }
    return cur;
  }

  function candidateIdsForPrompt(dict, prompt) {
    const L = prompt.length;
    if (L === 0) return [];
    if (L === 1) {
      return null;
    }
    if (L === 2) {
      const arr = dict.bigram[prompt];
      return arr ? arr.slice() : [];
    }
    if (L === 3) {
      const arr = dict.trigram[prompt];
      return arr ? arr.slice() : [];
    }
    const buckets = [];
    for (let i = 0; i + 2 < L; i++) {
      const tri = prompt.slice(i, i + 3);
      const arr = dict.trigram[tri];
      if (!arr || !arr.length) return [];
      buckets.push(arr);
    }
    return intersectSortedArrays(buckets);
  }

  function pickWord(dict, prompt) {
    let ids = candidateIdsForPrompt(dict, prompt);
    if (ids === null) {
      ids = [];
      for (let i = 0; i < dict.words.length; i++) {
        if (dict.words[i].includes(prompt)) ids.push(i);
      }
    }
    const scored = [];
    for (const id of ids) {
      const w = dict.words[id];
      if (!w.includes(prompt) || wordsPlayedThisMatch.has(w) || failedAttempts.has(w)) continue;
      scored.push({ w, len: w.length });
    }
    for (let li = 0; li < learnedList.length; li++) {
      const w = learnedList[li];
      if (!w.includes(prompt) || wordsPlayedThisMatch.has(w) || failedAttempts.has(w)) continue;
      if (!shouldAcceptLearnedToken(w)) continue;
      scored.push({ w, len: w.length });
    }
    const uniq = [];
    const seenW = new Set();
    for (let si = 0; si < scored.length; si++) {
      const x = scored[si];
      if (seenW.has(x.w)) continue;
      seenW.add(x.w);
      uniq.push(x);
    }
    if (!uniq.length) return null;
    uniq.sort((a, b) => b.len - a.len || a.w.localeCompare(b.w));
    const maxLen = uniq[0].len;
    const longest = uniq.filter((x) => x.len === maxLen);
    return longest[Math.floor(Math.random() * longest.length)].w;
  }

  /** MAIN-world bridge: fill input, socket.emit, Enter, form submit. */
  function submitViaSocket(word) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        document.removeEventListener(RESULT_EVT, onResult, true);
        resolve(ok);
      };
      const onResult = (e) => {
        if (!e.detail || e.detail.word !== word) return;
        finish(!!e.detail.ok);
      };
      document.addEventListener(RESULT_EVT, onResult, true);
      try {
        document.documentElement.dispatchEvent(
          new CustomEvent(SUBMIT_EVT, { detail: { word }, bubbles: true })
        );
      } catch {
        finish(false);
        return;
      }
      setTimeout(() => finish(false), 350);
    });
  }

  async function tryPlay(root) {
    if (!isBombpartyGameFrame()) return;

    const dict = getDict();
    if (!dict || typing || !enabled) return;
    if (!isMyTurn(root)) return;

    const prompt = getSyllableText(root);
    if (prompt.length < 2) return;
    if (activePrompt === prompt) return;

    typing = true;
    activePrompt = prompt;
    try {
      for (let attempt = 0; attempt < MAX_SUBMIT_TRIES; attempt++) {
        const prNow = getSyllableText(root);
        if (prNow !== prompt || prNow.length < 2) break;
        if (!isMyTurn(root)) break;

        const word = pickWord(dict, prompt);
        if (!word) break;

        const ok = await submitViaSocket(word);
        if (!ok) {
          failedAttempts.add(word);
          continue;
        }

        await sleep(AFTER_SUBMIT_MS);

        if (!isMyTurn(root)) {
          wordsPlayedThisMatch.add(word);
          break;
        }
        if (getSyllableText(root) === prompt) {
          failedAttempts.add(word);
          activePrompt = null;
          continue;
        }
        wordsPlayedThisMatch.add(word);
        break;
      }
    } catch (e) {
      console.warn("[bombparty-helper]", e);
    } finally {
      typing = false;
      if (!isMyTurn(root)) activePrompt = null;
    }
  }

  function debounce(fn, ms) {
    let t = 0;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  function installFloatingToggle() {
    if (document.getElementById("bombparty-helper-toggle")) return;

    const wrap = document.createElement("div");
    wrap.id = "bombparty-helper-toggle";
    wrap.setAttribute("data-bombparty-helper", "1");
    Object.assign(wrap.style, {
      position: "fixed",
      left: "12px",
      top: "12px",
      zIndex: "2147483646",
      fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
      fontSize: "12px",
      lineHeight: "1.35",
      color: "#e8e8ec",
      background: "linear-gradient(145deg, rgba(28,28,34,0.97) 0%, rgba(18,18,22,0.97) 100%)",
      border: "1px solid rgba(255,255,255,0.08)",
      padding: "10px 12px",
      borderRadius: "10px",
      boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
      minWidth: "168px",
      userSelect: "none",
      backdropFilter: "blur(8px)",
    });

    const title = document.createElement("div");
    title.textContent = "BombParty Helper";
    Object.assign(title.style, {
      fontSize: "11px",
      fontWeight: "700",
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      color: "#9a9aa8",
      marginBottom: "8px",
    });

    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "10px",
    });

    const statusWrap = document.createElement("div");
    Object.assign(statusWrap.style, {
      display: "flex",
      alignItems: "center",
      gap: "7px",
    });

    const dot = document.createElement("span");
    Object.assign(dot.style, {
      width: "8px",
      height: "8px",
      borderRadius: "50%",
      flexShrink: "0",
      background: enabled ? "#4ade80" : "#6b7280",
      boxShadow: enabled ? "0 0 8px rgba(74,222,128,0.55)" : "none",
    });

    const statusLabel = document.createElement("span");
    statusLabel.textContent = "Auto-type";
    Object.assign(statusLabel.style, {
      fontSize: "13px",
      fontWeight: "600",
      color: "#f4f4f6",
    });

    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-pressed", enabled ? "true" : "false");
    btn.textContent = enabled ? "On" : "Off";
    Object.assign(btn.style, {
      border: "none",
      borderRadius: "999px",
      padding: "5px 14px",
      cursor: "pointer",
      fontWeight: "700",
      fontSize: "12px",
      background: enabled ? "#3d9a5c" : "rgba(255,255,255,0.12)",
      color: "#fff",
    });

    function refreshToggleUi() {
      btn.textContent = enabled ? "On" : "Off";
      btn.setAttribute("aria-pressed", enabled ? "true" : "false");
      btn.style.background = enabled ? "#3d9a5c" : "rgba(255,255,255,0.12)";
      dot.style.background = enabled ? "#4ade80" : "#6b7280";
      dot.style.boxShadow = enabled ? "0 0 8px rgba(74,222,128,0.55)" : "none";
    }

    btn.addEventListener("click", () => {
      enabled = !enabled;
      saveEnabled(enabled);
      refreshToggleUi();
    });

    const clear = document.createElement("button");
    clear.type = "button";
    clear.title = "Clear words used this match (same as new room / new game)";
    clear.textContent = "Reset used words";
    Object.assign(clear.style, {
      display: "block",
      width: "100%",
      marginTop: "8px",
      padding: "6px 0 0",
      border: "none",
      borderTop: "1px solid rgba(255,255,255,0.07)",
      cursor: "pointer",
      background: "transparent",
      color: "#8b8b9a",
      fontSize: "11px",
      fontWeight: "500",
      textAlign: "left",
    });
    clear.addEventListener("mouseenter", () => {
      clear.style.color = "#c8c8d4";
    });
    clear.addEventListener("mouseleave", () => {
      clear.style.color = "#8b8b9a";
    });

    clear.addEventListener("click", () => {
      wordsPlayedThisMatch.clear();
      failedAttempts.clear();
      activePrompt = null;
    });

    statusWrap.appendChild(dot);
    statusWrap.appendChild(statusLabel);
    row.appendChild(statusWrap);
    row.appendChild(btn);
    wrap.appendChild(title);
    wrap.appendChild(row);
    wrap.appendChild(clear);
    document.documentElement.appendChild(wrap);
  }

  let booted = false;

  function isJklmGameRoomPage() {
    try {
      const host = location.hostname.toLowerCase();
      if (host !== "jklm.fun" && !host.endsWith(".jklm.fun")) return false;
    } catch {
      return false;
    }
    if (/\/games\/bombparty/i.test(location.pathname)) return true;

    const path = (location.pathname || "/").replace(/\/+$/, "");
    if (path === "" || path === "/") return false;
    const segment = path.slice(1).split("/")[0] || "";
    if (!segment || segment.includes(".")) return false;
    const lower = segment.toLowerCase();
    const reserved = new Set([
      "faq",
      "terms",
      "games",
      "images",
      "common",
      "room",
      "manifest.json",
    ]);
    if (reserved.has(lower)) return false;
    return /^[a-z0-9-]{2,16}$/i.test(segment);
  }

  function bootRoomShell(root) {
    const scheduleSlow = debounce(() => detectRoundSignals(root), 280);
    const scheduleLearn = debounce(() => extractAndLearnFromDom(root), 500);
    const obs = new MutationObserver(() => {
      scheduleSlow();
      scheduleLearn();
    });
    obs.observe(root.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    scheduleSlow();
    scheduleLearn();
  }

  function bootGameFrame(root) {
    let tryPlayQueued = false;
    const scheduleFast = () => {
      clearTurnLock(root);
      if (tryPlayQueued) return;
      tryPlayQueued = true;
      queueMicrotask(() => {
        tryPlayQueued = false;
        void tryPlay(root);
      });
    };

    const scheduleSlow = debounce(() => detectRoundSignals(root), 280);

    const obs = new MutationObserver(() => {
      scheduleFast();
      scheduleSlow();
    });
    obs.observe(root.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["hidden", "class", "disabled", "style"],
    });

    scheduleSlow();
    scheduleFast();
  }

  function boot() {
    if (booted) return;
    if (!isJklmGameRoomPage()) return;
    booted = true;

    const root = document;
    syncEnabledFromStorage();

    if (!isBombpartyGameFrame()) {
      installFloatingToggle();
      loadLearned();
      bootRoomShell(root);
      return;
    }

    loadLearned();
    bootGameFrame(root);
  }

  function waitDict() {
    if (getDict()) {
      boot();
      return;
    }
    const id = setInterval(() => {
      if (getDict()) {
        clearInterval(id);
        boot();
      }
    }, 50);
    setTimeout(() => clearInterval(id), 30000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", waitDict, { once: true });
  } else {
    waitDict();
  }
})();
