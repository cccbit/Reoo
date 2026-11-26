import { For, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { ExternalLink, Minus, Plus, X } from "lucide-solid";
import { AccentColor, api, FontFamilyId, StartupMode, ThemeMode } from "../api/bridge";
import { I18nDict, Locale } from "../i18n";

const ACCENT_PRESETS: { id: AccentColor; swatch: string; zh: string; en: string }[] = [
  { id: "blue", swatch: "#2563eb", zh: "科技蓝", en: "Tech Blue" },
  { id: "indigo", swatch: "#6366f1", zh: "深空靛", en: "Indigo" },
  { id: "violet", swatch: "#a855f7", zh: "星云紫", en: "Violet" },
  { id: "emerald", swatch: "#10b981", zh: "翡翠绿", en: "Emerald" },
  { id: "amber", swatch: "#f59e0b", zh: "琥珀金", en: "Amber" },
  { id: "rose", swatch: "#f43f5e", zh: "珊瑚粉", en: "Rose" },
  { id: "slate", swatch: "#94a3b8", zh: "极简银", en: "Slate" },
];

interface SettingsDialogProps {
  open: boolean;
  theme: ThemeMode;
  locale: Locale;
  accent: AccentColor;
  startupMode: StartupMode;
  wordWrap: boolean;
  fontSize: number;
  fontFamily: FontFamilyId;
  t: I18nDict;
  onClose: () => void;
  onThemeChange: (mode: ThemeMode) => void;
  onLocaleChange: (locale: Locale) => void;
  onAccentChange: (accent: AccentColor) => void;
  onStartupModeChange: (mode: StartupMode) => void;
  onWordWrapChange: (enabled: boolean) => void;
  onFontSizeChange: (size: number) => void;
  onFontFamilyChange: (family: FontFamilyId) => void;
}

export function SettingsDialog(props: SettingsDialogProps) {
  let dialogRef: HTMLDialogElement | undefined;
  const [appVersion, setAppVersion] = createSignal("0.1.3");
  const [shellMenuEnabled, setShellMenuEnabled] = createSignal(false);
  const [shellBusy, setShellBusy] = createSignal(false);

  onMount(() => {
    api.getAppVersion().then(setAppVersion).catch(() => {});
    api.shellMenuStatus().then(setShellMenuEnabled).catch(() => {});

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
      api.shellMenuStatus().then(setShellMenuEnabled).catch(() => {});
      if (!dialogRef.open) dialogRef.showModal();
    } else if (dialogRef.open) {
      dialogRef.close();
    }
  });

  const toggleShellMenu = async (enable: boolean) => {
    setShellBusy(true);
    try {
      const next = await api.setShellContextMenu(enable);
      setShellMenuEnabled(next);
    } catch {
      // 保持原状态
    } finally {
      setShellBusy(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      class="settings-dialog"
      aria-label={props.t.settingsTitle}
      {...({ closedby: "any" } as Record<string, string>)}
    >
      <div class="settings-header">
        <span>{props.t.settingsTitle}</span>
        <button
          type="button"
          class="icon-btn"
          aria-label={props.t.close}
          onClick={props.onClose}
        >
          <X size={14} />
        </button>
      </div>

      <div class="settings-body">
        <div class="settings-row">
          <span class="settings-label">{props.t.settingsLanguage}</span>
          <div class="segmented">
            <button
              type="button"
              class={`seg-btn${props.locale === "zh" ? " active" : ""}`}
              onClick={() => props.onLocaleChange("zh")}
            >
              简体中文
            </button>
            <button
              type="button"
              class={`seg-btn${props.locale === "en" ? " active" : ""}`}
              onClick={() => props.onLocaleChange("en")}
            >
              English
            </button>
          </div>
        </div>

        <div class="settings-row">
          <span class="settings-label">{props.t.settingsTheme}</span>
          <div class="segmented">
            <button
              type="button"
              class={`seg-btn${props.theme === "system" ? " active" : ""}`}
              onClick={() => props.onThemeChange("system")}
            >
              {props.t.themeSystem}
            </button>
            <button
              type="button"
              class={`seg-btn${props.theme === "dark" ? " active" : ""}`}
              onClick={() => props.onThemeChange("dark")}
            >
              {props.t.themeDark}
            </button>
            <button
              type="button"
              class={`seg-btn${props.theme === "light" ? " active" : ""}`}
              onClick={() => props.onThemeChange("light")}
            >
              {props.t.themeLight}
            </button>
          </div>
        </div>

        <div class="settings-row">
          <span class="settings-label">{props.t.settingsAccent}</span>
          <div class="accent-swatches">
            <For each={ACCENT_PRESETS}>
              {(preset) => {
                const label = () => (props.locale === "zh" ? preset.zh : preset.en);
                return (
                  <button
                    type="button"
                    class={`accent-dot-btn${props.accent === preset.id ? " active" : ""}`}
                    style={{ "background-color": preset.swatch }}
                    title={label()}
                    aria-label={label()}
                    onClick={() => props.onAccentChange(preset.id)}
                  />
                );
              }}
            </For>
          </div>
        </div>

        <div class="settings-row">
          <span class="settings-label">{props.t.settingsStartup}</span>
          <select
            class="settings-select"
            value={props.startupMode}
            onChange={(e) => props.onStartupModeChange(e.currentTarget.value as StartupMode)}
          >
            <option value="new_session">{props.t.startupNew}</option>
            <option value="restore_session">{props.t.startupRestore}</option>
          </select>
        </div>

        <div class="settings-row">
          <span class="settings-label">{props.t.settingsWordWrap}</span>
          <div class="segmented">
            <button
              type="button"
              class={`seg-btn${props.wordWrap ? " active" : ""}`}
              onClick={() => props.onWordWrapChange(true)}
            >
              {props.t.wordWrapOn}
            </button>
            <button
              type="button"
              class={`seg-btn${!props.wordWrap ? " active" : ""}`}
              onClick={() => props.onWordWrapChange(false)}
            >
              {props.t.wordWrapOff}
            </button>
          </div>
        </div>

        <div class="settings-row">
          <span class="settings-label">{props.t.settingsFontSize}</span>
          <div class="stepper">
            <button
              type="button"
              class="icon-btn"
              style={{ width: "24px", height: "22px" }}
              onClick={() => props.onFontSizeChange(Math.max(11, props.fontSize - 1))}
            >
              <Minus size={12} />
            </button>
            <span class="stepper-val">{props.fontSize}px</span>
            <button
              type="button"
              class="icon-btn"
              style={{ width: "24px", height: "22px" }}
              onClick={() => props.onFontSizeChange(Math.min(26, props.fontSize + 1))}
            >
              <Plus size={12} />
            </button>
          </div>
        </div>

        <div class="settings-row">
          <span class="settings-label">{props.t.settingsFontFamily}</span>
          <select
            class="settings-select"
            value={props.fontFamily}
            onChange={(e) => props.onFontFamilyChange(e.currentTarget.value as FontFamilyId)}
          >
            <option value="default">{props.t.fontDefault}</option>
            <option value="cascadia">Cascadia Code</option>
            <option value="jetbrains">JetBrains Mono</option>
            <option value="fira">Fira Code</option>
            <option value="consolas">Consolas</option>
            <option value="yahei_mono">{props.t.fontYaheiMono}</option>
          </select>
        </div>

        <div class="settings-row">
          <span class="settings-label">{props.t.settingsShellMenu}</span>
          <div class="segmented">
            <button
              type="button"
              disabled={shellBusy()}
              class={`seg-btn${shellMenuEnabled() ? " active" : ""}`}
              onClick={() => toggleShellMenu(true)}
            >
              {props.t.shellMenuOn}
            </button>
            <button
              type="button"
              disabled={shellBusy()}
              class={`seg-btn${!shellMenuEnabled() ? " active" : ""}`}
              onClick={() => toggleShellMenu(false)}
            >
              {props.t.shellMenuOff}
            </button>
          </div>
        </div>
      </div>

      <div class="settings-footer">
        <button
          type="button"
          class="settings-link"
          title="https://github.com/cccbit/Reoo.git"
          onClick={() =>
            api.openExternalUrl("https://github.com/cccbit/Reoo.git").catch(() => {})
          }
        >
          <span>GitHub · cccbit/Reoo</span>
          <ExternalLink size={11} />
        </button>
        <span>
          Reoo {props.t.versionLabel} v{appVersion()}
        </span>
      </div>
    </dialog>
  );
}
