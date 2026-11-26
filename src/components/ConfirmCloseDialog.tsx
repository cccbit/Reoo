import { For, createEffect, onCleanup, onMount } from "solid-js";
import { X } from "lucide-solid";
import { TabMeta } from "../api/bridge";
import { I18nDict } from "../i18n";

interface ConfirmCloseDialogProps {
  open: boolean;
  dirtyTabs: TabMeta[];
  t: I18nDict;
  onSaveAndExit: () => void;
  onDiscardAndExit: () => void;
  onCancel: () => void;
}

export function ConfirmCloseDialog(props: ConfirmCloseDialogProps) {
  let dialogRef: HTMLDialogElement | undefined;

  onMount(() => {
    if (!dialogRef) return;
    const dlg = dialogRef;
    const onCancel = () => props.onCancel();
    const onClose = () => props.onCancel();
    dlg.addEventListener("cancel", onCancel);
    dlg.addEventListener("close", onClose);
    onCleanup(() => {
      dlg.removeEventListener("cancel", onCancel);
      dlg.removeEventListener("close", onClose);
    });
  });

  createEffect(() => {
    if (!dialogRef) return;
    if (props.open) {
      if (!dialogRef.open) dialogRef.showModal();
    } else if (dialogRef.open) {
      dialogRef.close();
    }
  });

  return (
    <dialog
      ref={dialogRef}
      class="confirm-dialog"
      aria-label={props.t.confirmExitTitle}
    >
      <div class="settings-header">
        <span>{props.t.confirmExitTitle}</span>
        <button
          type="button"
          class="icon-btn"
          aria-label={props.t.confirmCancel}
          onClick={props.onCancel}
        >
          <X size={14} />
        </button>
      </div>

      <div class="confirm-body">
        <div>{props.t.confirmExitDesc(props.dirtyTabs.length)}</div>
        <div class="confirm-file-list scroller">
          <For each={props.dirtyTabs}>
            {(tab) => <div>• {tab.title}</div>}
          </For>
        </div>
      </div>

      <div class="confirm-actions">
        <button type="button" class="btn-secondary" onClick={props.onCancel}>
          {props.t.confirmCancel}
        </button>
        <button type="button" class="btn-danger" onClick={props.onDiscardAndExit}>
          {props.t.confirmDiscardExit}
        </button>
        <button type="button" class="btn-primary-solid" onClick={props.onSaveAndExit}>
          {props.t.confirmSaveExit}
        </button>
      </div>
    </dialog>
  );
}
