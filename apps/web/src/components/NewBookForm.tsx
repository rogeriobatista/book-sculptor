"use client";

import { useLocale, useTranslations } from "next-intl";
import { FormEvent, useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import {
  ImportManuscriptModal,
  type ImportMode,
} from "@/components/ImportManuscriptModal";
import { useToast } from "@/components/ToastProvider";
import { type Book, clientApiFetch } from "@/lib/client-api";
import { useAppAuth } from "@/lib/use-app-auth";

type Step = "meta" | "start";

export function NewBookForm() {
  const { getToken } = useAppAuth();
  const toast = useToast();
  const locale = useLocale();
  const t = useTranslations("books");
  const s = useTranslations("studio");
  const common = useTranslations("common");
  const [step, setStep] = useState<Step>("meta");
  const [busy, setBusy] = useState(false);
  const [book, setBook] = useState<Book | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [canUseAi, setCanUseAi] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const me = await clientApiFetch<{ plan: string }>("/api/v1/me", token);
        if (!cancelled) setCanUseAi(me.plan !== "free");
      } catch {
        if (!cancelled) setCanUseAi(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  async function createBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const loadingId = toast.loading(s("notifyCreatingBook"));
    const form = new FormData(event.currentTarget);
    try {
      const token = await getToken();
      const created = await clientApiFetch<Book>("/api/v1/books", token, {
        method: "POST",
        body: JSON.stringify({
          title: String(form.get("title") || "Untitled"),
          author: String(form.get("author") || ""),
          locale: String(form.get("locale") || locale),
          mode: "book",
        }),
      });
      setBook(created);
      setStep("start");
      toast.update(loadingId, {
        tone: "success",
        title: s("notifyBookCreated"),
      });
    } catch (err) {
      toast.update(loadingId, {
        tone: "error",
        title: s("notifyBookCreateFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  function goToStudio(query = "tab=write") {
    if (!book) return;
    window.location.href = `/${locale}/books/${book.id}?${query}`;
  }

  async function runImport(
    files: File[],
    mode: ImportMode,
    useAiStructure = true,
  ) {
    if (!book || !files.length) return;
    setBusy(true);
    const loadingId = toast.loading(s("notifyImporting"));
    try {
      const token = await getToken();
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      form.append("replace", mode === "replace" ? "true" : "false");
      form.append("use_ai_structure", useAiStructure ? "true" : "false");
      await clientApiFetch(`/api/v1/books/${book.id}/import`, token, {
        method: "POST",
        body: form,
      });
      setImportOpen(false);
      toast.update(loadingId, {
        tone: "success",
        title: s("notifyImportDone"),
      });
      goToStudio();
    } catch (err) {
      toast.update(loadingId, {
        tone: "error",
        title: s("notifyImportFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function openBlank() {
    if (!book) return;
    setBusy(true);
    const loadingId = toast.loading(s("notifyChapterCreating"));
    try {
      const token = await getToken();
      await clientApiFetch(`/api/v1/books/${book.id}/chapters`, token, {
        method: "POST",
        body: JSON.stringify({
          title: `${s("chapter")} 1`,
          kind: "chapter",
          number: 1,
          content_text: "",
        }),
      });
      toast.update(loadingId, {
        tone: "success",
        title: s("notifyChapterCreated"),
      });
      goToStudio();
    } catch (err) {
      toast.update(loadingId, {
        tone: "error",
        title: s("notifyChapterFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  function openWithAi() {
    goToStudio("tab=write&start=ai");
  }

  return (
    <div className="create-flow">
      <ol className="create-steps" aria-label={t("createFlow")}>
        <li data-active={step === "meta"} data-done={step !== "meta"}>
          1. {t("createStepMeta")}
        </li>
        <li data-active={step === "start"}>2. {t("createStepStart")}</li>
      </ol>

      {step === "meta" ? (
        <form className="panel form-grid create-card" onSubmit={createBook}>
          <h2>{t("createMetaTitle")}</h2>
          <p className="muted">{t("createMetaLead")}</p>
          <label>
            {t("title")}
            <input
              name="title"
              type="text"
              placeholder={t("createTitlePlaceholder")}
              required
            />
          </label>
          <label>
            {t("author")}
            <input name="author" type="text" placeholder={t("createAuthorPlaceholder")} />
          </label>
          <label>
            {t("locale")}
            <select name="locale" defaultValue={locale}>
              <option value="en">English</option>
              <option value="pt-BR">Português (Brasil)</option>
              <option value="es">Español</option>
            </select>
          </label>
          <div className="cta-group">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {t("createContinue")}
            </button>
            <Link href="/books" className="btn btn-ghost">
              {common("cancel")}
            </Link>
          </div>
        </form>
      ) : (
        <div className="panel create-card create-start">
          <h2>{t("createStartTitle")}</h2>
          <p className="muted">{t("createStartLead")}</p>
          <div className="create-choice-grid">
            <button
              type="button"
              className="create-choice"
              disabled={busy}
              onClick={openBlank}
            >
              <strong>{t("createBlank")}</strong>
              <span className="muted">{t("createBlankHint")}</span>
            </button>
            <button
              type="button"
              className="create-choice"
              disabled={busy}
              onClick={() => setImportOpen(true)}
            >
              <strong>{t("createImport")}</strong>
              <span className="muted">{t("createImportHint")}</span>
            </button>
            <button
              type="button"
              className="create-choice"
              disabled={busy}
              onClick={openWithAi}
            >
              <strong>{t("createAi")}</strong>
              <span className="muted">{t("createAiHint")}</span>
            </button>
          </div>
        </div>
      )}

      <ImportManuscriptModal
        open={importOpen}
        chapterCount={0}
        busy={busy}
        canUseAi={canUseAi}
        onClose={() => {
          if (!busy) setImportOpen(false);
        }}
        onConfirm={({ files, mode, useAiStructure }) => {
          void runImport(files, mode, useAiStructure);
        }}
        labels={{
          title: s("importModalTitle"),
          lead: s("importModalLead"),
          pickFiles: s("importPickFiles"),
          dropHint: s("importDropHint"),
          selected: s("importSelected"),
          tocHint: s("importTocHint"),
          modeLabel: s("importModeLabel"),
          append: s("importModeAppend"),
          appendHint: s("importModeAppendHint"),
          replace: s("importModeReplace"),
          replaceHint: s("importModeReplaceHint"),
          aiStructure: s("importAiStructure"),
          aiStructureHint: s("importAiStructureHint"),
          aiStructureUpgrade: s("importAiStructureUpgrade"),
          cancel: common("cancel"),
          confirm: s("importConfirm"),
          emptyBookNote: s("importEmptyBookNote"),
        }}
      />
    </div>
  );
}
