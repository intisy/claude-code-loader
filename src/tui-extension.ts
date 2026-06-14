// @ts-nocheck
// Custom TUI tab (loaded via HUB_TUI_EXTENSION): map each Claude model tier to a
// {provider, model} chosen from a searchable list grouped by provider, with a
// pinned favorites section (Tab toggles a favorite).

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SLOTS = [
  { key: "opus", label: "Opus" },
  { key: "sonnet", label: "Sonnet" },
  { key: "haiku", label: "Haiku" },
  { key: "default", label: "Default" },
];
const WINDOW = 14;

function configDir() { return process.env.HUB_CONFIG_DIR || join(homedir(), ".claude"); }
function reposDir() { return join(configDir(), "repos"); }
// the loader config the proxy reads, not core-loader's oc-config.json
function configPath() { return join(configDir(), "config", "claude-code-loader.json"); }

function readConfig() {
  try { if (existsSync(configPath())) return JSON.parse(readFileSync(configPath(), "utf8")); } catch {}
  return {};
}

function writeConfig(cfg) {
  try {
    const dir = join(configDir(), "config");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(configPath(), JSON.stringify(cfg, null, 2), "utf8");
  } catch {}
}

function allEntries() {
  const out = [];
  let repos = [];
  try { repos = readdirSync(reposDir()); } catch { return out; }
  for (const repo of repos) {
    try {
      const pkg = JSON.parse(readFileSync(join(reposDir(), repo, "package.json"), "utf8"));
      const declared = (pkg.claudeHub && pkg.claudeHub.authProviders) || pkg.authProviders || [];
      for (const p of declared) {
        const provider = p.name || repo;
        for (const m of (p.models || [])) {
          const model = typeof m === "string" ? m : m.id;
          const name = typeof m === "string" ? m : (m.name || m.id);
          out.push({ provider, model, name, id: provider + "/" + model });
        }
      }
    } catch {}
  }
  return out;
}

// favorited entries (matching the search) pinned first, then the rest grouped by
// provider. Returns the flat selectable order + the grouped layout for rendering.
function buildPick(search) {
  const favSet = new Set(readConfig().favorites || []);
  const q = (search || "").toLowerCase();
  const match = (e) => (e.provider + " " + e.model + " " + e.name).toLowerCase().indexOf(q) >= 0;
  const entries = allEntries().filter(match);
  const favs = entries.filter((e) => favSet.has(e.id));
  const groups = [];
  const byProvider = {};
  for (const e of entries) {
    if (favSet.has(e.id)) continue;
    if (!byProvider[e.provider]) { byProvider[e.provider] = { provider: e.provider, items: [] }; groups.push(byProvider[e.provider]); }
    byProvider[e.provider].items.push(e);
  }
  const selectable = favs.concat(...groups.map((g) => g.items));
  return { favSet, favs, groups, selectable };
}

const tab = { mode: "slots", slotCursor: 0, editingSlot: "opus", search: "", pickCursor: 0 };

function renderSlots(h) {
  const map = readConfig().modelMap || {};
  h.pushBody("  " + h.MAGENTA + "#" + h.GRAY + " Claude model mapping" + h.RST, false);
  h.pushBody("  " + h.DIM + "Assign each Claude tier to a provider model." + h.RST, false);
  h.pushBody("", false);
  SLOTS.forEach((slot, i) => {
    const sel = tab.slotCursor === i;
    const a = map[slot.key];
    const value = a && a.provider ? (h.CYAN + a.provider + " / " + a.model + h.RST) : (h.DIM + "(unset)" + h.RST);
    const arrow = sel ? (h.YELLOW + " > " + h.RST) : "   ";
    h.pushBody("  " + (sel ? h.BG_SEL : "") + arrow + (sel ? h.BOLD + h.WHITE : h.GRAY) + h.pad(slot.label, 10) + h.RST + h.GRAY + " -> " + h.RST + value, sel);
  });
  h.pushBody("", false);
  h.pushFoot("  " + h.GRAY + "-".repeat(h.barW) + h.RST);
  h.pushFoot("  " + h.DIM + "^v Move   Enter Assign   Tab Switch   Q Quit" + h.RST);
}

function renderPick(h) {
  const { favSet, favs, groups, selectable } = buildPick(tab.search);
  if (tab.pickCursor >= selectable.length) tab.pickCursor = Math.max(0, selectable.length - 1);
  const slot = SLOTS.find((s) => s.key === tab.editingSlot);

  h.pushBody("  " + h.MAGENTA + "#" + h.GRAY + " Assign " + (slot ? slot.label : "") + " " + h.RST +
    h.BG_SEL + " Search: " + tab.search + "_ " + h.RST, false);

  if (selectable.length === 0) h.pushBody("  " + h.GRAY + "No matching models." + h.RST, false);

  // a window around the cursor across the flat selectable order
  const start = Math.max(0, Math.min(tab.pickCursor - Math.floor(WINDOW / 2), Math.max(0, selectable.length - WINDOW)));
  const end = Math.min(selectable.length, start + WINDOW);
  let i = 0;
  const row = (e) => {
    if (i >= start && i < end) {
      const sel = i === tab.pickCursor;
      const star = favSet.has(e.id) ? (h.YELLOW + "★ " + h.RST) : "  ";
      const arrow = sel ? (h.YELLOW + " > " + h.RST) : "   ";
      h.pushBody("  " + (sel ? h.BG_SEL : "") + arrow + star + (sel ? h.BOLD + h.WHITE : h.GRAY) + e.model + h.RST + h.GRAY + "  " + e.name + h.RST, sel);
    }
    i++;
  };
  if (favs.length) { if (start === 0) h.pushBody("  " + h.MAGENTA + "★ Favorites" + h.RST, false); favs.forEach(row); }
  for (const g of groups) {
    const before = i;
    const headerVisible = before < end && (before + g.items.length) > start;
    if (headerVisible) h.pushBody("  " + h.MAGENTA + g.provider + h.RST, false);
    g.items.forEach(row);
  }

  h.pushBody("", false);
  h.pushFoot("  " + h.GRAY + "-".repeat(h.barW) + h.RST);
  h.pushFoot("  " + h.DIM + "Type to filter   ^v Move   Enter Select   Tab ★ Favorite   Esc Cancel" + h.RST);
}

function render(state, h) {
  if (tab.mode === "pick") renderPick(h);
  else renderSlots(h);
}

function handleKey(key, state, tuiApi) {
  if (tab.mode === "slots") {
    if (key === "up" || key === "w") { tab.slotCursor = (tab.slotCursor - 1 + SLOTS.length) % SLOTS.length; return; }
    if (key === "down" || key === "s") { tab.slotCursor = (tab.slotCursor + 1) % SLOTS.length; return; }
    if (key === "enter" || key === "space") {
      tab.editingSlot = SLOTS[tab.slotCursor].key;
      tab.mode = "pick"; tab.search = ""; tab.pickCursor = 0;
      if (tuiApi && tuiApi.setTextInput) tuiApi.setTextInput(true);
    }
    return;
  }
  // pick mode (raw text routed in via S.mode=tabinput)
  const close = () => { tab.mode = "slots"; if (tuiApi.setTextInput) tuiApi.setTextInput(false); };
  if (key === "escape") { close(); return; }
  if (key === "up") { tab.pickCursor = Math.max(0, tab.pickCursor - 1); return; }
  if (key === "down") { const n = buildPick(tab.search).selectable.length; tab.pickCursor = Math.min(n - 1, tab.pickCursor + 1); return; }
  if (key === "backspace") { tab.search = tab.search.slice(0, -1); tab.pickCursor = 0; return; }
  if (key === "tab") {
    const e = buildPick(tab.search).selectable[tab.pickCursor];
    if (e) {
      const cfg = readConfig();
      const favs = new Set(cfg.favorites || []);
      if (favs.has(e.id)) favs.delete(e.id); else favs.add(e.id);
      cfg.favorites = Array.from(favs);
      writeConfig(cfg);
    }
    return;
  }
  if (key === "enter") {
    const e = buildPick(tab.search).selectable[tab.pickCursor];
    close();
    if (e) {
      const cfg = readConfig();
      cfg.modelMap = cfg.modelMap || {};
      cfg.modelMap[tab.editingSlot] = { provider: e.provider, model: e.model };
      writeConfig(cfg);
      try { if (tuiApi.flash) tuiApi.flash(tab.editingSlot + " -> " + e.provider + " / " + e.model); } catch {}
    }
    return;
  }
  if (typeof key === "string" && key.length === 1) { tab.search += key; tab.pickCursor = 0; }
}

export default function (tuiApi) {
  tuiApi.registerTab({ id: "providers", label: "Providers", render, handleKey });
}
