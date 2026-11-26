import { For, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Search, X } from "lucide-solid";
import { WorkspaceFileEntry } from "../api/bridge";
import { I18nDict } from "../i18n";

export interface PaletteCommand {
  id: string;
  label: string;
  shortcut?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  initialQuery: string;
  files: WorkspaceFileEntry[];
  commands: PaletteCommand[];
  t: I18nDict;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onJumpLine: (line: number) => void;
}

interface PaletteRow {
  key: string;
  title: string;
  sub?: string;
  shortcut?: string;
  action: () => void;
}

export function CommandPalette(props: CommandPaletteProps) {
  let dialogRef: HTMLDialogElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  const [query, setQuery] = createSignal("");
  const [selectedIdx, setSelectedIdx] = createSignal(0);

  onMount(() => {
    if (!dialogRef) return;
    const dlg = dialogRef;
    const onCancel = () => props.onClose();
    const onClose = () => props.onClose();
    dlg.addEventListener("cancel", onCancel);
    dlg.addEventListener("close", onClose);

    const onBackdropClick = (event: MouseEvent) => {
      if (event.target !== dlg) return;
      const rect = dlg.getBoundingClientRect();
      const inside =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!inside) {
        dlg.close();
      }
    };

    if (!("closedBy" in HTMLDialogElement.prototype)) {
      dlg.addEventListener("click", onBackdropClick);
    }

    onCleanup(() => {
      dlg.removeEventListener("cancel", onCancel);
      dlg.removeEventListener("close", onClose);
      dlg.removeEventListener("click", onBackdropClick);
    });
  });

  createEffect(() => {
    if (!dialogRef) return;
    if (props.open) {
      setQuery(props.initialQuery);
      setSelectedIdx(0);
      if (!dialogRef.open) {
        dialogRef.showModal();
      }
      requestAnimationFrame(() => inputRef?.focus());
    } else if (dialogRef.open) {
      dialogRef.close();
    }
  });

  const rows = createMemo<PaletteRow[]>(() => {
    const raw = query().trim();

    if (raw.startsWith(":")) {
      const n = parseInt(raw.slice(1), 10);
      if (!Number.isNaN(n) && n > 0) {
        return [
          {
            key: `goto-${n}`,
            title: props.t.gotoLine(n),
            sub: props.t.gotoLineSub,
            action: () => {
              props.onJumpLine(n - 1);
              props.onClose();
            },
          },
        ];
      }
      return [
        {
          key: "goto-hint",
          title: props.t.gotoLineHint,
          action: () => {},
        },
      ];
    }

    if (raw.startsWith(">") || props.files.length === 0) {
      const needle = (raw.startsWith(">") ? raw.slice(1) : raw).trim().toLowerCase();
      return props.commands
        .filter((c) => !needle || c.label.toLowerCase().includes(needle))
        .map((c) => ({
          key: c.id,
          title: c.label,
          shortcut: c.shortcut,
          action: () => {
            props.onClose();
            c.run();
          },
        }));
    }

    const needle = raw.toLowerCase();
    return props.files
      .filter((f) => !needle || f.relative_path.toLowerCase().includes(needle))
      .slice(0, 60)
      .map((f) => ({
        key: f.path,
        title: f.name,
        sub: f.relative_path,
        action: () => {
          props.onClose();
          props.onOpenFile(f.path);
        },
      }));
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    const list = rows();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => (list.length ? (i + 1) % list.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => (list.length ? (i - 1 + list.length) % list.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      list[selectedIdx()]?.action();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      class="palette-dialog"
      aria-label={props.t.commandCenter}
      {...({ closedby: "any" } as Record<string, string>)}
    >
      <div class="palette-header">
        <Search size={15} style={{ color: "var(--text-muted)" }} />
        <input
          ref={inputRef}
          class="palette-input"
          placeholder={props.t.commandPlaceholder}
          value={query()}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setSelectedIdx(0);
          }}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          class="icon-btn"
          aria-label={props.t.closePalette}
          onClick={() => props.onClose()}
        >
          <X size={14} />
        </button>
      </div>
      <div class="palette-list scroller">
        <For each={rows()}>
          {(row, idx) => (
            <div
              class={`palette-item${idx() === selectedIdx() ? " selected" : ""}`}
              onMouseEnter={() => setSelectedIdx(idx())}
              onClick={() => row.action()}
            >
              <div>
                <div>{row.title}</div>
                {row.sub && <div class="palette-item-sub">{row.sub}</div>}
              </div>
              {row.shortcut && <span class="kbd-hint">{row.shortcut}</span>}
            </div>
          )}
        </For>
      </div>
    </dialog>
  );
}
