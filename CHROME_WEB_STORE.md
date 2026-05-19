# Chrome Web Store checklist

Upload **`bombparty-helper-chrome-store.zip`** (rebuild with command at bottom).

Upload **`store-assets/screenshot-1280x800.png`** as a store screenshot (not inside the ZIP).

Upload **`icons/icon128.png`** in the listing’s icon field if the dashboard asks separately (icons are also inside the ZIP).

---

## Fix each error (dashboard)

### 1. Account (Settings page — not the listing)

| Error | Fix |
|-------|-----|
| Contact email required | **Developer Dashboard → Account → Contact email** — add your email |
| Verify contact email | Same page → **Verify** → click link in inbox |

You cannot publish until this is done.

---

### 2. Store listing tab

| Field | What to enter |
|-------|----------------|
| **Language** | English (or your language) |
| **Category** | **Fun** |
| **Icon** | Upload `icons/icon128.png` (128×128) |
| **Screenshot** | Upload `store-assets/screenshot-1280x800.png` (1280×800) |
| **Short description** | See below |
| **Detailed description** | See below (must be ≥25 characters; use full text) |

**Short description**

```
Optional BombParty word assistant for JKLM rooms. Toggle on/off in-game. Not affiliated with JKLM.
```

**Detailed description**

```
BombParty Helper is an optional assistant for BombParty on jklm.fun.

When it is your turn, the extension finds a word that matches the syllable prompt and submits it automatically. You stay in control with an in-page panel: turn auto-type on or off, or reset the list of words already used this match.

How to use:
1. Install the extension
2. Open a JKLM room (for example jklm.fun/ABCD) and start BombParty
3. Use the “BombParty Helper” panel at the top-left of the room page

Features:
• Built-in English word dictionary
• Avoids repeating words played in the current match
• On/Off toggle synced across the room page and game
• “Reset used words” for a new round or room

This extension is not made by or affiliated with JKLM or Sparklin Labs. Only use where game rules and other players allow assistants.

All processing happens locally in your browser. No account or external server is required.
```

---

### 3. Privacy practices tab

Copy each block into the matching justification field.

**Single purpose description**

```
This extension has one purpose: to help the user play BombParty on jklm.fun by suggesting and submitting valid words on the user’s turn when auto-type is enabled.
```

**Host permission justification** (`*://*.jklm.fun/*`)

```
The extension only needs access to jklm.fun and its subdomains (for example phoenix.jklm.fun) because that is where JKLM hosts BombParty rooms and the game iframe. Scripts run only on those pages to read the syllable prompt during the user’s turn and submit a word. No other websites are accessed.
```

**Storage justification**

```
Storage is used only on the user’s device to save: (1) whether auto-type is on or off, and (2) words observed in chat during the session so the extension does not suggest duplicates. Nothing is uploaded to our servers; we do not operate a backend for this extension.
```

**Remote code justification**

```
This extension does not load or execute remote code. All JavaScript (including the word dictionary) is bundled inside the extension package. No scripts are fetched from external URLs at runtime.
```

**Data usage / certification**

- Select: **No, I do not sell or transfer user data to third parties** (adjust if your answers differ).
- Under “Data collected”: typically **None** or only **Website content** if the form requires it for on-page syllable reading — many listings use **No data collected** when everything is local; if forced, choose the minimum that matches (local-only processing).
- Check the box: **I certify that my data usage complies with the Developer Program Policies**.

**Privacy policy URL**

Host `PRIVACY.md` on GitHub (repo → paste raw gist URL) or any public page. Example text is in `PRIVACY.md` in this repo.

---

## Rebuild ZIP

```bash
cd /Users/slava/dev/bombparty-cheater
zip -r bombparty-helper-chrome-store.zip manifest.json content.js page-bridge.js words.js icons/ -x "*.DS_Store"
```

---

## Order of operations

1. Settings → email + verify  
2. Upload new ZIP  
3. Store listing → language, category, descriptions, icon, screenshot  
4. Privacy practices → all justifications + privacy policy URL + certify  
5. Submit for review  

Review often takes 1–3 business days.
