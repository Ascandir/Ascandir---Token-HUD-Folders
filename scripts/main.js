/**
 * Ascandir - Token HUD Folders
 *
 * Der Spielleiter legt Ordner im Token-HUD an und sortiert Buttons hinein.
 * Die Buttons werden NICHT nachgebaut, sondern nur innerhalb des HUD verschoben.
 * Dadurch funktionieren sie weiter wie vorher – auch die von anderen Modulen.
 */

const MODULE_ID = "ascandir-token-hud-folders";
const S_FOLDERS = "folders";
const S_KNOWN = "knownButtons";
const S_PLAYERS = "applyToPlayers";
const S_COLUMNS = "flyoutColumns";

const DEFAULT_FOLDER_ICON = "fa-solid fa-folder";
const IMG_RE = /\.(webp|png|jpe?g|gif|svg|avif)(\?.*)?$/i;

/** Ordner, die gerade aufgeklappt sind (bleiben über HUD-Neuzeichnungen hinweg offen). */
const openFolders = new Set();
let lastTokenId = null;
const observers = new WeakMap();

/** Namen für Core-Buttons, falls Foundry keinen Tooltip mitliefert. */
const CORE_LABELS = {
  visibility: "THF.Core.Visibility",
  combat: "THF.Core.Combat",
  target: "THF.Core.Target",
  config: "THF.Core.Config",
  sort: "THF.Core.Sort",
  effects: "THF.Core.Effects",
  movementAction: "THF.Core.Movement",
  level: "THF.Core.Level"
};

/* -------------------------------------------- */
/*  Hilfsfunktionen                             */
/* -------------------------------------------- */

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function stripHTML(str) {
  const div = document.createElement("div");
  div.innerHTML = String(str ?? "");
  return div.textContent.trim();
}

function isImagePath(icon) {
  return typeof icon === "string" && (IMG_RE.test(icon) || icon.includes("/"));
}

/** HTML für ein Ordner-Symbol (Font-Awesome-Klassen oder Bildpfad). */
function folderIconHTML(icon) {
  const value = (icon || DEFAULT_FOLDER_ICON).trim();
  if (isImagePath(value)) return `<img src="${esc(value)}" alt="">`;
  return `<i class="${esc(value)}"></i>`;
}

/** HTML für ein gespeichertes Button-Symbol. */
function buttonIconHTML(icon) {
  if (!icon) return `<i class="fa-solid fa-question"></i>`;
  if (icon.type === "img") return `<img src="${esc(icon.value)}" alt="">`;
  if (icon.type === "fa") return `<i class="${esc(icon.value)}"></i>`;
  return `<span class="thf-text-icon">${esc(icon.value || "?")}</span>`;
}

function getFolders() {
  const folders = game.settings.get(MODULE_ID, S_FOLDERS);
  return Array.isArray(folders) ? folders : [];
}

function getKnown() {
  const known = game.settings.get(MODULE_ID, S_KNOWN);
  return known && typeof known === "object" ? known : {};
}

function rerenderHUD() {
  const hud = canvas?.tokens?.hud;
  if (hud?.rendered && hud.object) hud.render();
}

/* -------------------------------------------- */
/*  Buttons im HUD erkennen                     */
/* -------------------------------------------- */

/** Ist dieses Element ein Button, den man in einen Ordner legen kann? */
function isCandidate(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.classList.contains("thf-folder")) return false;
  if (el.matches(".palette, .attribute, input, select, label, textarea, .thf-ignore")) return false;
  if (el.matches("button, .control-icon, [data-action]")) return true;
  // Manche Module packen ihren Button in einen eigenen Container.
  return !!el.querySelector(".control-icon, button, [data-action]");
}

/** Symbol eines Buttons für die Anzeige im Einstellungsfenster. */
function readIcon(el) {
  const i = el.matches("i") ? el : el.querySelector("i[class*='fa']");
  if (i) {
    const cls = [...i.classList].filter(c => c.startsWith("fa") || c.startsWith("ra"));
    if (cls.length) return { type: "fa", value: cls.join(" ") };
  }
  const img = el.matches("img") ? el : el.querySelector("img");
  if (img?.getAttribute("src")) return { type: "img", value: img.getAttribute("src") };
  const text = el.textContent.trim().slice(0, 3);
  return { type: "text", value: text || "?" };
}

/** Lesbarer Name eines Buttons. */
function readLabel(el, key) {
  const sources = [el, ...el.querySelectorAll("[data-tooltip], [aria-label], [title]")];
  for (const node of sources) {
    const raw = node.dataset?.tooltip || node.dataset?.tooltipText || node.getAttribute("aria-label") || node.getAttribute("title");
    if (raw) {
      const text = game.i18n.has?.(raw) ? game.i18n.localize(raw) : raw;
      const clean = stripHTML(text);
      if (clean) return clean.slice(0, 80);
    }
  }
  const action = el.dataset.palette || el.dataset.action;
  if (action && CORE_LABELS[action]) {
    let label = t(CORE_LABELS[action]);
    if (el.dataset.direction) label += ` (${el.dataset.direction})`;
    return label;
  }
  return action || key;
}

/** Stabile Kennung für einen Button, damit er bei jedem Öffnen wiedererkannt wird. */
function computeKey(el) {
  if (el.id) return `id:${el.id}`;
  const attrs = [];
  for (const a of el.attributes) {
    if (!a.name.startsWith("data-")) continue;
    if (/^data-(tooltip|thf-|state|active|value)/.test(a.name)) continue;
    attrs.push(`${a.name.slice(5)}=${a.value}`);
  }
  if (attrs.length) return `data:${attrs.sort().join("|")}`;
  const skip = new Set(["control-icon", "active", "hidden", "disabled", "selected", "toggled", "on", "off"]);
  const cls = [...el.classList].filter(c => !skip.has(c) && !c.startsWith("thf-")).sort();
  const icon = readIcon(el);
  return `sig:${[el.tagName.toLowerCase(), ...cls, icon.type === "fa" || icon.type === "img" ? icon.value : ""].join("|")}`;
}

/* -------------------------------------------- */
/*  Ordner ins HUD einbauen                     */
/* -------------------------------------------- */

const pendingKnown = {};
const saveKnown = foundry.utils.debounce(async () => {
  if (!game.user.isGM || !Object.keys(pendingKnown).length) return;
  const known = foundry.utils.deepClone(getKnown());
  Object.assign(known, pendingKnown);
  for (const k of Object.keys(pendingKnown)) delete pendingKnown[k];
  await game.settings.set(MODULE_ID, S_KNOWN, known);
}, 600);

/** Merkt sich (nur beim SL) alle Buttons, die im HUD auftauchen. */
function rememberButtons(found) {
  if (!game.user.isGM) return;
  const known = getKnown();
  for (const { el, key } of found) {
    // Schon bekannt? Dann nicht erneut speichern – viele Buttons wechseln Text/Symbol je nach Zustand
    // (z. B. „Versteckt+ an/aus“), und jedes Speichern wäre ein Schreibzugriff, der an alle Spieler geht.
    const old = known[key] ?? pendingKnown[key];
    if (old?.label && old.icon && old.side === el.dataset.thfSide) continue;
    pendingKnown[key] = { label: readLabel(el, key), icon: readIcon(el), side: el.dataset.thfSide };
  }
  if (Object.keys(pendingKnown).length) saveKnown();
}

function getColumns(root) {
  return {
    left: root.querySelector(".col.left"),
    right: root.querySelector(".col.right")
  };
}

function buildFolderElement(folder) {
  const wrap = document.createElement("div");
  wrap.className = "thf-folder";
  wrap.dataset.thfFolder = folder.id;
  wrap.innerHTML = `
    <div class="control-icon thf-toggle" data-tooltip="${esc(folder.name)}" aria-label="${esc(folder.name)}">
      ${folderIconHTML(folder.icon)}
      <span class="thf-count"></span>
    </div>
    <div class="thf-flyout"></div>`;
  wrap.querySelector(".thf-toggle").addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    const isOpen = !openFolders.has(folder.id);
    // Andere Ordner auf derselben Seite schließen, damit sie sich nicht überlappen.
    const col = wrap.parentElement;
    for (const other of col?.querySelectorAll(":scope > .thf-folder") ?? []) {
      if (other === wrap) continue;
      openFolders.delete(other.dataset.thfFolder);
      other.classList.remove("open");
    }
    if (isOpen) openFolders.add(folder.id);
    else openFolders.delete(folder.id);
    wrap.classList.toggle("open", isOpen);
  });
  // Rechtsklick auf den Ordner schließt ihn ebenfalls.
  wrap.querySelector(".thf-toggle").addEventListener("contextmenu", event => {
    event.preventDefault();
    event.stopPropagation();
    openFolders.delete(folder.id);
    wrap.classList.remove("open");
  });
  return wrap;
}

/** Sortiert die Buttons des HUD in die Ordner. Darf beliebig oft laufen. */
function organize(root) {
  if (!root?.isConnected) return;
  const cols = getColumns(root);
  if (!cols.left && !cols.right) return;

  // 1. Alle Buttons einsammeln – in den Spalten und in unseren Ordnern.
  const found = [];
  const dupes = new Map();
  const collect = (el, side) => {
    if (!isCandidate(el)) return;
    if (!el.dataset.thfKey) {
      let key = computeKey(el);
      const n = (dupes.get(key) ?? 0) + 1;
      dupes.set(key, n);
      if (n > 1) key = `${key}#${n}`;
      el.dataset.thfKey = key;
    }
    if (!el.dataset.thfSide) el.dataset.thfSide = side;
    found.push({ el, key: el.dataset.thfKey });
  };
  for (const side of ["left", "right"]) {
    const col = cols[side];
    if (!col) continue;
    for (const child of [...col.children]) collect(child, side);
  }
  for (const child of root.querySelectorAll(".thf-flyout > *")) collect(child, child.dataset.thfSide || "right");

  rememberButtons(found);

  const enabled = game.user.isGM || game.settings.get(MODULE_ID, S_PLAYERS);
  const folders = enabled ? getFolders() : [];
  const folderIds = new Set(folders.map(f => f.id));
  const assignment = new Map();
  for (const folder of folders) {
    for (const key of folder.buttons ?? []) if (!assignment.has(key)) assignment.set(key, folder.id);
  }

  // 2. Ordner, die es nicht mehr gibt, auflösen.
  for (const wrap of root.querySelectorAll(".thf-folder")) {
    if (folderIds.has(wrap.dataset.thfFolder)) continue;
    for (const child of [...wrap.querySelector(".thf-flyout").children]) {
      const col = cols[child.dataset.thfSide] ?? cols.right ?? cols.left;
      col.append(child);
    }
    wrap.remove();
  }

  // 3. Ordner anlegen bzw. an die richtige Seite setzen.
  const wraps = new Map();
  for (const folder of folders) {
    const col = cols[folder.side] ?? cols.right ?? cols.left;
    let wrap = root.querySelector(`.thf-folder[data-thf-folder="${CSS.escape(folder.id)}"]`);
    if (!wrap) wrap = buildFolderElement(folder);
    if (wrap.parentElement !== col) col.append(wrap);
    wraps.set(folder.id, wrap);
  }

  // 4. Buttons in ihre Ordner verschieben (oder zurück, wenn nicht mehr zugeordnet).
  for (const { el, key } of found) {
    const folderId = assignment.get(key);
    if (folderId) {
      const flyout = wraps.get(folderId).querySelector(".thf-flyout");
      if (el.parentElement !== flyout) flyout.append(el);
    } else if (el.parentElement?.classList.contains("thf-flyout")) {
      const col = cols[el.dataset.thfSide] ?? cols.right ?? cols.left;
      const firstFolder = col.querySelector(":scope > .thf-folder");
      col.insertBefore(el, firstFolder);
    }
  }

  // 5. Reihenfolge im Ordner, Zähler, leere Ordner ausblenden, Auf/Zu-Zustand.
  const maxCols = Math.max(1, Number(game.settings.get(MODULE_ID, S_COLUMNS)) || 4);
  for (const folder of folders) {
    const wrap = wraps.get(folder.id);
    const flyout = wrap.querySelector(".thf-flyout");
    const order = folder.buttons ?? [];
    const children = [...flyout.children];
    const sorted = [...children].sort((a, b) => order.indexOf(a.dataset.thfKey) - order.indexOf(b.dataset.thfKey));
    if (sorted.some((el, i) => el !== children[i])) for (const el of sorted) flyout.append(el);

    const count = String(children.length);
    const badge = wrap.querySelector(".thf-count");
    if (badge.textContent !== count) badge.textContent = count;
    wrap.hidden = children.length === 0;
    flyout.style.setProperty("--thf-cols", String(Math.min(children.length || 1, maxCols)));
    wrap.classList.toggle("open", openFolders.has(folder.id));
    // Aktiver Button im Ordner → Ordner leicht hervorheben.
    wrap.classList.toggle("has-active", !!flyout.querySelector(".active"));
  }
}

const scheduled = new WeakMap();
function scheduleOrganize(root) {
  if (scheduled.get(root)) return;
  scheduled.set(root, true);
  setTimeout(() => {
    scheduled.delete(root);
    try { organize(root); } catch (err) { console.error(`${MODULE_ID} |`, err); }
  }, 25);
}

/** Beobachtet das HUD, damit auch Buttons erfasst werden, die andere Module später einfügen. */
function observe(root) {
  if (observers.has(root)) return;
  const obs = new MutationObserver(() => scheduleOrganize(root));
  obs.observe(root, { childList: true, subtree: true });
  observers.set(root, obs);
}

function onRenderTokenHUD(app, html) {
  const root = app?.element ?? (html instanceof HTMLElement ? html : html?.[0]);
  if (!root) return;
  const tokenId = app?.object?.id ?? null;
  if (tokenId !== lastTokenId) {
    openFolders.clear();
    lastTokenId = tokenId;
  }
  try { organize(root); } catch (err) { console.error(`${MODULE_ID} |`, err); }
  // Manche Module hängen ihre Buttons erst etwas später an.
  scheduleOrganize(root);
  setTimeout(() => scheduleOrganize(root), 250);
  observe(root);
}

/* -------------------------------------------- */
/*  Einstellungsfenster für den SL              */
/* -------------------------------------------- */

const FA_PRESETS = [
  "fa-solid fa-folder", "fa-solid fa-folder-open", "fa-solid fa-box-archive", "fa-solid fa-toolbox",
  "fa-solid fa-wand-magic-sparkles", "fa-solid fa-hat-wizard", "fa-solid fa-dice-d20", "fa-solid fa-skull",
  "fa-solid fa-shield-halved", "fa-solid fa-swords", "fa-solid fa-hand-sparkles", "fa-solid fa-eye",
  "fa-solid fa-gear", "fa-solid fa-gears", "fa-solid fa-map", "fa-solid fa-users", "fa-solid fa-dragon",
  "fa-solid fa-sack", "fa-solid fa-scroll", "fa-solid fa-book", "fa-solid fa-music", "fa-solid fa-star",
  "fa-solid fa-heart", "fa-solid fa-bolt", "fa-solid fa-fire", "fa-solid fa-ghost", "fa-solid fa-crown"
];

class FolderConfig extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "thf-folder-config",
    tag: "div",
    classes: ["thf-config"],
    window: {
      title: "THF.Config.Title",
      icon: "fa-solid fa-folder-tree",
      resizable: true
    },
    position: { width: 860, height: 680 },
    actions: {
      addFolder: FolderConfig.#onAddFolder,
      deleteFolder: FolderConfig.#onDeleteFolder,
      moveFolder: FolderConfig.#onMoveFolder,
      pickIcon: FolderConfig.#onPickIcon,
      unassign: FolderConfig.#onUnassign,
      forget: FolderConfig.#onForget,
      save: FolderConfig.#onSave
    }
  };

  constructor(options) {
    super(options);
    this.folders = foundry.utils.deepClone(getFolders());
    this.dirty = false;
  }

  /* ---------- Darstellung ---------- */

  #itemHTML(key, known) {
    const info = known[key];
    const label = info?.label ?? key;
    const side = info?.side ? t(info.side === "left" ? "THF.Config.SideLeft" : "THF.Config.SideRight") : t("THF.Config.Unseen");
    return `
      <li class="thf-item${info ? "" : " unseen"}" draggable="true" data-key="${esc(key)}" title="${esc(key)}">
        <span class="thf-item-icon">${buttonIconHTML(info?.icon)}</span>
        <span class="thf-item-label">${esc(label)}</span>
        <span class="thf-item-side">${esc(side)}</span>
      </li>`;
  }

  async _renderHTML() {
    const known = getKnown();
    const assigned = new Set(this.folders.flatMap(f => f.buttons ?? []));
    const pool = Object.keys(known)
      .filter(k => !assigned.has(k))
      .sort((a, b) => (known[a].side ?? "").localeCompare(known[b].side ?? "") || known[a].label.localeCompare(known[b].label));

    const poolHTML = pool.length
      ? pool.map(k => this.#itemHTML(k, known)).join("")
      : `<li class="thf-empty">${t(Object.keys(known).length ? "THF.Config.PoolEmpty" : "THF.Config.PoolNoneSeen")}</li>`;

    const foldersHTML = this.folders.length
      ? this.folders.map((f, idx) => `
        <div class="thf-card" data-folder-id="${esc(f.id)}">
          <div class="thf-card-head">
            <span class="thf-preview">${folderIconHTML(f.icon)}</span>
            <input type="text" class="thf-name" data-field="name" value="${esc(f.name)}" placeholder="${esc(t("THF.Config.NamePlaceholder"))}">
            <input type="text" class="thf-icon" data-field="icon" value="${esc(f.icon)}" list="thf-fa-presets" placeholder="fa-solid fa-folder">
            <button type="button" data-action="pickIcon" data-tooltip="${esc(t("THF.Config.PickImage"))}"><i class="fa-solid fa-file-image"></i></button>
            <select data-field="side" data-tooltip="${esc(t("THF.Config.Side"))}">
              <option value="left" ${f.side === "left" ? "selected" : ""}>${t("THF.Config.SideLeft")}</option>
              <option value="right" ${f.side !== "left" ? "selected" : ""}>${t("THF.Config.SideRight")}</option>
            </select>
            <button type="button" data-action="moveFolder" data-dir="-1" ${idx === 0 ? "disabled" : ""} data-tooltip="${esc(t("THF.Config.Up"))}"><i class="fa-solid fa-arrow-up"></i></button>
            <button type="button" data-action="moveFolder" data-dir="1" ${idx === this.folders.length - 1 ? "disabled" : ""} data-tooltip="${esc(t("THF.Config.Down"))}"><i class="fa-solid fa-arrow-down"></i></button>
            <button type="button" class="thf-danger" data-action="deleteFolder" data-tooltip="${esc(t("THF.Config.Delete"))}"><i class="fa-solid fa-trash"></i></button>
          </div>
          <ul class="thf-list thf-drop" data-folder="${esc(f.id)}">
            ${(f.buttons ?? []).length
              ? f.buttons.map(k => this.#itemHTML(k, known)).join("")
              : `<li class="thf-empty">${t("THF.Config.DropHere")}</li>`}
          </ul>
        </div>`).join("")
      : `<p class="thf-empty">${t("THF.Config.NoFolders")}</p>`;

    return `
      <datalist id="thf-fa-presets">${FA_PRESETS.map(p => `<option value="${p}">`).join("")}</datalist>
      <div class="thf-layout">
        <section class="thf-pool">
          <h3><i class="fa-solid fa-grip"></i> ${t("THF.Config.Pool")}</h3>
          <p class="thf-hint">${t("THF.Config.PoolHint")}</p>
          <ul class="thf-list thf-drop" data-folder="">${poolHTML}</ul>
        </section>
        <section class="thf-folders">
          <div class="thf-folders-head">
            <h3><i class="fa-solid fa-folder-tree"></i> ${t("THF.Config.Folders")}</h3>
            <button type="button" data-action="addFolder"><i class="fa-solid fa-folder-plus"></i> ${t("THF.Config.Add")}</button>
          </div>
          <div class="thf-cards">${foldersHTML}</div>
        </section>
      </div>
      <footer class="thf-footer">
        <button type="button" data-action="forget" data-tooltip="${esc(t("THF.Config.ForgetHint"))}"><i class="fa-solid fa-broom"></i> ${t("THF.Config.Forget")}</button>
        <span class="thf-dirty">${this.dirty ? t("THF.Config.Unsaved") : ""}</span>
        <button type="button" class="thf-primary" data-action="save"><i class="fa-solid fa-floppy-disk"></i> ${t("THF.Config.Save")}</button>
      </footer>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    this.#activate(content);
  }

  #markDirty() {
    this.dirty = true;
    const el = this.element?.querySelector(".thf-dirty");
    if (el) el.textContent = t("THF.Config.Unsaved");
  }

  #folderOf(el) {
    const id = el.closest(".thf-card")?.dataset.folderId;
    return this.folders.find(f => f.id === id);
  }

  #activate(html) {
    // Eingabefelder direkt in den Arbeitsstand übernehmen (ohne neu zu zeichnen).
    for (const input of html.querySelectorAll("[data-field]")) {
      const handler = () => {
        const folder = this.#folderOf(input);
        if (!folder) return;
        folder[input.dataset.field] = input.value;
        if (input.dataset.field === "icon") {
          input.closest(".thf-card").querySelector(".thf-preview").innerHTML = folderIconHTML(input.value);
        }
        this.#markDirty();
      };
      input.addEventListener("input", handler);
      input.addEventListener("change", handler);
    }

    // Drag & Drop
    for (const item of html.querySelectorAll(".thf-item")) {
      item.addEventListener("dragstart", event => {
        this._dragKey = item.dataset.key;
        event.dataTransfer.setData("text/plain", item.dataset.key);
        event.dataTransfer.effectAllowed = "move";
        item.classList.add("dragging");
      });
      item.addEventListener("dragend", () => {
        item.classList.remove("dragging");
        this._dragKey = null;
      });
      // Doppelklick auf einen zugeordneten Button legt ihn zurück in den Pool.
      item.addEventListener("dblclick", () => {
        if (!item.closest(".thf-card")) return;
        this.#moveKey(item.dataset.key, "", null);
      });
    }
    for (const zone of html.querySelectorAll(".thf-drop")) {
      zone.addEventListener("dragover", event => {
        if (!this._dragKey) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        zone.classList.add("over");
      });
      zone.addEventListener("dragleave", event => {
        if (!zone.contains(event.relatedTarget)) zone.classList.remove("over");
      });
      zone.addEventListener("drop", event => {
        event.preventDefault();
        zone.classList.remove("over");
        const key = this._dragKey || event.dataTransfer.getData("text/plain");
        if (!key) return;
        // Einfügeposition anhand des Buttons unter dem Mauszeiger.
        let before = null;
        const target = event.target.closest(".thf-item");
        if (target && target.dataset.key !== key) {
          const rect = target.getBoundingClientRect();
          before = event.clientY < rect.top + rect.height / 2
            ? target.dataset.key
            : target.nextElementSibling?.dataset?.key ?? null;
        }
        this.#moveKey(key, zone.dataset.folder, before);
      });
    }
  }

  #moveKey(key, folderId, beforeKey) {
    for (const f of this.folders) f.buttons = (f.buttons ?? []).filter(k => k !== key);
    if (folderId) {
      const folder = this.folders.find(f => f.id === folderId);
      if (folder) {
        const idx = beforeKey ? folder.buttons.indexOf(beforeKey) : -1;
        if (idx >= 0) folder.buttons.splice(idx, 0, key);
        else folder.buttons.push(key);
      }
    }
    this.dirty = true;
    this.render();
  }

  /* ---------- Aktionen ---------- */

  static #onAddFolder() {
    this.folders.push({
      id: foundry.utils.randomID(),
      name: t("THF.Config.NewFolder"),
      icon: DEFAULT_FOLDER_ICON,
      side: "right",
      buttons: []
    });
    this.dirty = true;
    this.render();
  }

  static async #onDeleteFolder(event, target) {
    const folder = this.#folderOf(target);
    if (!folder) return;
    const DialogV2 = foundry.applications.api.DialogV2;
    const ok = await DialogV2.confirm({
      window: { title: t("THF.Config.Delete") },
      content: `<p>${t("THF.Config.DeleteConfirm", { name: esc(folder.name) })}</p>`
    });
    if (!ok) return;
    this.folders = this.folders.filter(f => f !== folder);
    this.dirty = true;
    this.render();
  }

  static #onMoveFolder(event, target) {
    const folder = this.#folderOf(target);
    const idx = this.folders.indexOf(folder);
    const dir = Number(target.dataset.dir);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= this.folders.length) return;
    [this.folders[idx], this.folders[to]] = [this.folders[to], this.folders[idx]];
    this.dirty = true;
    this.render();
  }

  static #onPickIcon(event, target) {
    const folder = this.#folderOf(target);
    if (!folder) return;
    const FP = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    const picker = new FP({
      type: "image",
      current: isImagePath(folder.icon) ? folder.icon : "",
      callback: path => {
        folder.icon = path;
        this.dirty = true;
        this.render();
      }
    });
    picker.render(true);
  }

  static #onUnassign(event, target) {
    const key = target.closest(".thf-item")?.dataset.key;
    if (key) this.#moveKey(key, "", null);
  }

  static async #onForget() {
    const assigned = new Set(this.folders.flatMap(f => f.buttons ?? []));
    const known = foundry.utils.deepClone(getKnown());
    for (const key of Object.keys(known)) if (!assigned.has(key)) delete known[key];
    await game.settings.set(MODULE_ID, S_KNOWN, known);
    ui.notifications.info(t("THF.Config.Forgotten"));
    this.render();
  }

  static async #onSave() {
    const clean = this.folders.map(f => ({
      id: f.id,
      name: String(f.name ?? "").trim() || t("THF.Config.NewFolder"),
      icon: String(f.icon ?? "").trim() || DEFAULT_FOLDER_ICON,
      side: f.side === "left" ? "left" : "right",
      buttons: [...new Set(f.buttons ?? [])]
    }));
    await game.settings.set(MODULE_ID, S_FOLDERS, clean);
    this.folders = foundry.utils.deepClone(clean);
    this.dirty = false;
    ui.notifications.info(t("THF.Config.Saved"));
    this.render();
  }
}

/* -------------------------------------------- */
/*  Start                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, S_FOLDERS, {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: () => rerenderHUD()
  });

  game.settings.register(MODULE_ID, S_KNOWN, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.registerMenu(MODULE_ID, "folderConfig", {
    name: "THF.Settings.Menu.Name",
    label: "THF.Settings.Menu.Label",
    hint: "THF.Settings.Menu.Hint",
    icon: "fa-solid fa-folder-tree",
    type: FolderConfig,
    restricted: true
  });

  game.settings.register(MODULE_ID, S_PLAYERS, {
    name: "THF.Settings.Players.Name",
    hint: "THF.Settings.Players.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => rerenderHUD()
  });

  game.settings.register(MODULE_ID, S_COLUMNS, {
    name: "THF.Settings.Columns.Name",
    hint: "THF.Settings.Columns.Hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 1, max: 8, step: 1 },
    default: 4,
    onChange: () => rerenderHUD()
  });
});

Hooks.on("renderTokenHUD", onRenderTokenHUD);

Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = { openConfig: () => new FolderConfig().render(true), organize };
});
