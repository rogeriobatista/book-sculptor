const state = {
  projectId: null,
  options: null,
  settings: {
    style_id: "prosa_literaria",
    format_id: "medio",
    font_id: "garamond",
    font_size: 11,
    density: "padrao",
    page_number: "centro",
    include_toc: true,
  },

  mode: "book",
  files: [],
  book: null,
  diagnostic: null,
  pages: [],
  css: null,
  pageIndex: 0,
  chaptersOpen: true,
};

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const res = await fetch(path, options);
  if (!res.ok) {
    let msg = "Algo deu errado.";
    try {
      const data = await res.json();
      msg = data.detail || msg;
    } catch (_) {}
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return res.json();
}

function choiceButton(label, active, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "choice" + (active ? " active" : "");
  const parts = String(label).split("\n");
  if (parts.length > 1) {
    btn.innerHTML = `<strong>${parts[0]}</strong><small>${parts.slice(1).join(" ")}</small>`;
  } else {
    btn.textContent = label;
  }
  btn.addEventListener("click", onClick);
  return btn;
}

function updateChrome() {
  const hasBook = Boolean(state.book);
  document.body.classList.toggle("is-empty", !hasBook);
  const meta = $("toolbarMeta");
  if (!meta) return;
  if (!hasBook) {
    meta.textContent = "Aguardando manuscrito";
  } else if (state.pages.length) {
    meta.textContent = `${state.pages.length} páginas · ${state.book.title}`;
  } else {
    meta.textContent = state.book.title;
  }
}

function renderOptions() {
  const o = state.options;
  const s = state.settings;

  const styleList = $("styleList");
  if (styleList && o.styles) {
    styleList.innerHTML = "";
    o.styles.forEach((style) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "style-card" + (s.style_id === style.id ? " active" : "");
      btn.innerHTML = `<strong>${style.label}</strong><span>${style.description}</span>`;
      btn.addEventListener("click", () => applyStyle(style.id));
      styleList.appendChild(btn);
    });
    const current = o.styles.find((x) => x.id === s.style_id);
    if ($("styleHint") && current) $("styleHint").textContent = current.description;
  }

  const formatGrid = $("formatGrid");
  formatGrid.innerHTML = "";
  o.formats.forEach((f) => {
    formatGrid.appendChild(
      choiceButton(f.label, s.format_id === f.id, () => updateSetting("format_id", f.id))
    );
  });

  const fontGrid = $("fontGrid");
  fontGrid.innerHTML = "";
  o.fonts.forEach((f) => {
    fontGrid.appendChild(
      choiceButton(f.label, s.font_id === f.id, () => updateSetting("font_id", f.id))
    );
  });

  const sizeRow = $("sizeRow");
  sizeRow.innerHTML = "";
  o.font_sizes.forEach((n) => {
    sizeRow.appendChild(
      choiceButton(String(n), s.font_size === n, () => updateSetting("font_size", n))
    );
  });

  const densityRow = $("densityRow");
  densityRow.innerHTML = "";
  o.densities.forEach((d) => {
    densityRow.appendChild(
      choiceButton(d.label, s.density === d.id, () => updateSetting("density", d.id))
    );
  });

  const pageNumRow = $("pageNumRow");
  pageNumRow.innerHTML = "";
  o.page_numbers.forEach((p) => {
    pageNumRow.appendChild(
      choiceButton(p.label, s.page_number === p.id, () => updateSetting("page_number", p.id))
    );
  });

  const tocRow = $("tocRow");
  tocRow.innerHTML = "";
  o.toc.forEach((t) => {
    const active = t.id === "com" ? s.include_toc : !s.include_toc;
    tocRow.appendChild(
      choiceButton(t.label, active, () => updateSetting("include_toc", t.id === "com"))
    );
  });
}

async function updateSetting(key, value) {
  state.settings[key] = value;
  renderOptions();
  if (!state.projectId) return;
  await api(`/api/projects/${state.projectId}/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state.settings),
  });
  if (state.book) {
    try {
      await refreshPreview();
    } catch (_) {}
  }
}

async function applyStyle(styleId) {
  const preset = state.options?.presets?.[styleId];
  state.settings.style_id = styleId;
  if (preset) {
    Object.assign(state.settings, preset);
    state.settings.style_id = styleId;
  }
  renderOptions();
  if (!state.projectId) return;
  await api(`/api/projects/${state.projectId}/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state.settings),
  });
  if (state.book) {
    try {
      await refreshPreview();
    } catch (_) {}
  }
}

async function ensureProject() {
  if (state.projectId) return state.projectId;
  const data = await api("/api/projects", { method: "POST" });
  state.projectId = data.project_id;
  await api(`/api/projects/${state.projectId}/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state.settings),
  });
  await api(`/api/projects/${state.projectId}/mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: state.mode }),
  });
  return state.projectId;
}

function renderFiles() {
  $("fileCount").textContent = String(state.files.length);
  $("currentFile").textContent = state.files.length
    ? state.files.map((f) => f.name).join(", ")
    : "Nenhum arquivo enviado";
  $("uploadBtn").textContent = state.files.length ? "Trocar manuscrito" : "Enviar manuscrito";

  const list = $("fileList");
  list.innerHTML = "";
  state.files.forEach((f) => {
    const pill = document.createElement("div");
    pill.className = "file-pill";
    pill.innerHTML = `<span></span><button type="button" aria-label="Remover">×</button>`;
    pill.querySelector("span").textContent = f.name;
    pill.querySelector("button").addEventListener("click", () => removeFile(f.id));
    list.appendChild(pill);
  });
}

function renderChapters() {
  const panel = $("detectionPanel");
  if (!state.book) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  $("detectionText").textContent = "✓ " + state.book.detection;
  const list = $("chapterList");
  list.hidden = !state.chaptersOpen;
  $("toggleChapters").textContent = state.chaptersOpen ? "fechar" : "abrir";
  list.innerHTML = "";

  state.book.chapters.forEach((ch, index) => {
    const card = document.createElement("div");
    card.className = "chapter-card";
    card.innerHTML = `
      <div class="chapter-top">
        <strong></strong>
        <div class="chapter-moves">
          <button type="button" data-dir="-1" title="Subir">↑</button>
          <button type="button" data-dir="1" title="Descer">↓</button>
        </div>
      </div>
      <p class="chapter-snippet"></p>
    `;
    card.querySelector("strong").textContent = ch.label;
    card.querySelector(".chapter-snippet").textContent = ch.snippet || "(sem texto)";
    card.querySelectorAll("[data-dir]").forEach((btn) => {
      btn.addEventListener("click", () => moveChapter(index, Number(btn.dataset.dir)));
    });
    list.appendChild(card);
  });
}

function renderDiagnostic() {
  const box = $("diagnostic");
  if (!state.diagnostic) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  $("diagChapters").textContent = state.diagnostic.chapters;
  $("diagWords").textContent = state.diagnostic.words.toLocaleString("pt-BR");
  $("diagIssues").textContent = state.diagnostic.issue_count;
  $("diagMessage").textContent = state.diagnostic.message;
  $("diagIssuesBox").classList.toggle("warn", state.diagnostic.issue_count > 0);
  $("exportBtn").disabled = !state.book;
  $("exportBtn").textContent =
    state.mode === "chapter"
      ? "Preparar o meu capítulo →"
      : "Preparar o meu livro completo →";
}

function applyPageCss() {
  const page = $("bookPage");
  const css = state.css;
  if (!css) return;
  page.style.width = css.width_px + "px";
  page.style.height = css.height_px + "px";
  page.style.fontFamily = css.font_family;
  page.style.fontSize = css.font_size;
  page.style.lineHeight = css.line_height;
  page.dataset.style = css.style_id || "prosa_literaria";
  page.style.setProperty("--indent", (css.indent_em || 1.5) + "em");
  page.style.setProperty("--para-gap", (css.paragraph_gap_pt || 0) + "pt");
  $("pageContent").style.padding = css.padding;

  const num = $("pageNumber");
  num.className = "page-number " + (state.settings.page_number || "sem");
}

function renderPage() {
  const hasPages = state.pages.length > 0;
  $("emptyState").hidden = hasPages;
  $("pageWrap").hidden = !hasPages;
  $("pager").hidden = !hasPages;
  updateChrome();
  if (!hasPages) return;

  state.pageIndex = Math.max(0, Math.min(state.pageIndex, state.pages.length - 1));
  const page = state.pages[state.pageIndex];
  applyPageCss();
  $("pageContent").innerHTML = page.html;
  $("pageNumber").textContent = String(state.pageIndex + 1);
  $("pageIndicator").textContent = `${state.pageIndex + 1} / ${state.pages.length}`;
  $("prevPage").disabled = state.pageIndex === 0;
  $("nextPage").disabled = state.pageIndex >= state.pages.length - 1;
}

async function refreshPreview() {
  if (!state.projectId || !state.book) return;
  const data = await api(`/api/projects/${state.projectId}/preview`);
  state.pages = data.pages;
  state.css = data.css;
  state.book = data.book;
  state.diagnostic = data.diagnostic;
  state.files = data.files;
  renderFiles();
  renderChapters();
  renderDiagnostic();
  renderPage();
}

async function uploadFiles(fileList, replace = false) {
  if (!fileList?.length) return;
  await ensureProject();

  if (replace && state.files.length) {
    // create a fresh project when "trocar manuscrito"
    state.projectId = null;
    state.files = [];
    state.book = null;
    state.pages = [];
    await ensureProject();
  }

  const body = new FormData();
  [...fileList].forEach((f) => body.append("files", f));
  const data = await api(`/api/projects/${state.projectId}/files`, {
    method: "POST",
    body,
  });
  state.files = data.files;
  state.book = data.book;
  state.diagnostic = data.diagnostic;
  state.pageIndex = 0;
  renderFiles();
  renderChapters();
  renderDiagnostic();
  await refreshPreview();
}

async function removeFile(fileId) {
  const data = await api(`/api/projects/${state.projectId}/files/${fileId}`, {
    method: "DELETE",
  });
  state.files = data.files;
  state.book = data.book;
  state.diagnostic = data.diagnostic;
  state.pageIndex = 0;
  renderFiles();
  renderChapters();
  renderDiagnostic();
  if (state.book) await refreshPreview();
  else {
    state.pages = [];
    renderPage();
    $("exportBtn").disabled = true;
  }
}

async function moveChapter(index, direction) {
  const data = await api(`/api/projects/${state.projectId}/chapters/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index, direction }),
  });
  state.book = data.book;
  state.diagnostic = data.diagnostic;
  renderChapters();
  renderDiagnostic();
  await refreshPreview();
}

async function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll("#modeSeg .seg-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  $("modeHint").textContent =
    mode === "chapter"
      ? "Um arquivo isolado é tratado só como conteúdo de capítulo — sem estrutura de livro."
      : "Vários arquivos ou um manuscrito completo viram livro com título, sumário e capítulos.";
  $("tocPanel").style.opacity = mode === "chapter" ? "0.45" : "1";

  if (state.projectId) {
    const data = await api(`/api/projects/${state.projectId}/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    state.book = data.book;
    state.files = data.files;
    state.diagnostic = data.diagnostic;
    renderFiles();
    renderChapters();
    renderDiagnostic();
    if (state.book) await refreshPreview();
  }
}

function setExportStatus(text, isError = false) {
  const el = $("exportStatus");
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? "#8B2E2E" : "";
}

async function waitForDesktopApi(timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (window.pywebview?.api?.pick_save_path) return window.pywebview.api;
    await new Promise((r) => setTimeout(r, 50));
  }
  return window.pywebview?.api || null;
}

async function downloadViaBrowser(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Não foi possível baixar o arquivo gerado.");
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}

async function exportBook() {
  if (!state.projectId || !state.book) {
    setExportStatus("Envie um manuscrito antes de exportar.", true);
    return;
  }

  const fmt = document.querySelector('input[name="exportFmt"]:checked')?.value || "docx";
  const btn = $("exportBtn");
  const previousLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Gerando arquivo…";
  setExportStatus("Gerando seu livro…");

  try {
    const data = await api(`/api/projects/${state.projectId}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: fmt }),
    });

    const desktopApi = await waitForDesktopApi();
    if (desktopApi?.pick_save_path && desktopApi?.copy_export) {
      const chosen = await desktopApi.pick_save_path(data.filename, fmt);
      if (!chosen) {
        setExportStatus("Exportação cancelada.");
        return;
      }
      const saved = await desktopApi.copy_export(data.temp_path, chosen);
      setExportStatus(`Livro salvo em: ${saved}`);
      if (desktopApi.reveal_in_folder) {
        try {
          await desktopApi.reveal_in_folder(saved);
        } catch (_) {}
      }
      return;
    }

    await downloadViaBrowser(data.download_url, data.filename);
    setExportStatus(`Download iniciado: ${data.filename}`);
  } catch (err) {
    console.error(err);
    setExportStatus(err.message || "Falha ao exportar.", true);
    alert(err.message || "Falha ao exportar o livro.");
  } finally {
    btn.disabled = !state.book;
    btn.textContent = previousLabel;
  }
}

function bindEvents() {
  const openPicker = (append = false) => {
    $("fileInput").value = "";
    $("fileInput").dataset.append = append ? "1" : "";
    $("fileInput").click();
  };
  $("uploadBtn").addEventListener("click", () => openPicker(false));
  $("emptyUploadBtn")?.addEventListener("click", () => openPicker(false));
  $("addFileBtn").addEventListener("click", () => openPicker(true));
  $("fileInput").addEventListener("change", async (e) => {
    const append = $("fileInput").dataset.append === "1";
    $("fileInput").dataset.append = "";
    try {
      await uploadFiles(e.target.files, !append);
    } catch (err) {
      alert(err.message);
    }
  });

  document.querySelectorAll("#modeSeg .seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode).catch((e) => alert(e.message)));
  });

  $("toggleChapters").addEventListener("click", () => {
    state.chaptersOpen = !state.chaptersOpen;
    renderChapters();
  });

  $("refreshBtn").addEventListener("click", () => {
    refreshPreview().catch((e) => alert(e.message));
  });
  $("prevPage").addEventListener("click", () => {
    state.pageIndex -= 1;
    renderPage();
  });
  $("nextPage").addEventListener("click", () => {
    state.pageIndex += 1;
    renderPage();
  });
  $("exportBtn").addEventListener("click", () => {
    exportBook().catch((e) => alert(e.message));
  });
  $("fullscreenBtn").addEventListener("click", () => {
    document.body.classList.toggle("fullscreen-mode");
    $("fullscreenBtn").textContent = document.body.classList.contains("fullscreen-mode")
      ? "Sair da tela cheia"
      : "Tela cheia";
  });
}

async function init() {
  bindEvents();
  state.options = await api("/api/options");
  renderOptions();
  renderFiles();
  renderPage();
  updateChrome();
  setMode("book");
}

init().catch((err) => {
  console.error(err);
  alert("Não foi possível iniciar o Book Sculptor.");
});
