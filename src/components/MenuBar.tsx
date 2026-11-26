import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { ChevronRight } from "lucide-solid";

export type MenuEntry =
  | { type: "sep" }
  | { type: "item"; label: string; shortcut?: string; action: () => void }
  | {
      type: "submenu";
      label: string;
      items: { label: string; action: () => void }[];
    };

export interface TopMenuGroup {
  id: string;
  label: string;
  items: MenuEntry[];
}

interface MenuBarProps {
  menus: TopMenuGroup[];
}

export function MenuBar(props: MenuBarProps) {
  const [openId, setOpenId] = createSignal<string | null>(null);
  const [openSubLabel, setOpenSubLabel] = createSignal<string | null>(null);
  const [pos, setPos] = createSignal({ left: 0, top: 36 });

  const openMenu = (id: string, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    setPos({ left: rect.left, top: rect.bottom + 3 });
    setOpenId(id);
    setOpenSubLabel(null);
  };

  const closeAll = () => {
    setOpenId(null);
    setOpenSubLabel(null);
  };

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAll();
    };
    window.addEventListener("click", closeAll);
    window.addEventListener("keydown", onKey);
    onCleanup(() => {
      window.removeEventListener("click", closeAll);
      window.removeEventListener("keydown", onKey);
    });
  });

  const activeGroup = () => props.menus.find((m) => m.id === openId()) ?? null;

  return (
    <nav class="menubar" onClick={(e) => e.stopPropagation()}>
      <For each={props.menus}>
        {(group) => (
          <button
            type="button"
            class={`menu-trigger${openId() === group.id ? " open" : ""}`}
            onClick={(e) => {
              if (openId() === group.id) {
                closeAll();
              } else {
                openMenu(group.id, e.currentTarget);
              }
            }}
            onMouseEnter={(e) => {
              if (openId() !== null && openId() !== group.id) {
                openMenu(group.id, e.currentTarget);
              }
            }}
          >
            {group.label}
          </button>
        )}
      </For>

      <Show when={activeGroup()}>
        {(group) => (
          <div
            class="menu-dropdown"
            style={{ left: `${pos().left}px`, top: `${pos().top}px` }}
          >
            <For each={group().items}>
              {(entry) => {
                if (entry.type === "sep") {
                  return <div class="menu-sep" />;
                }
                if (entry.type === "submenu") {
                  return (
                    <div
                      class="menu-submenu-wrap"
                      onMouseEnter={() => setOpenSubLabel(entry.label)}
                      onMouseLeave={() => setOpenSubLabel(null)}
                    >
                      <button type="button" class="menu-item">
                        <span>{entry.label}</span>
                        <ChevronRight size={13} style={{ color: "var(--text-muted)" }} />
                      </button>
                      <Show when={openSubLabel() === entry.label}>
                        <div class="menu-submenu">
                          <For each={entry.items}>
                            {(sub) => (
                              <button
                                type="button"
                                class="menu-item"
                                onClick={() => {
                                  closeAll();
                                  sub.action();
                                }}
                              >
                                <span>{sub.label}</span>
                              </button>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  );
                }
                return (
                  <button
                    type="button"
                    class="menu-item"
                    onMouseEnter={() => setOpenSubLabel(null)}
                    onClick={() => {
                      closeAll();
                      entry.action();
                    }}
                  >
                    <span>{entry.label}</span>
                    {entry.shortcut && <span class="kbd-hint">{entry.shortcut}</span>}
                  </button>
                );
              }}
            </For>
          </div>
        )}
      </Show>
    </nav>
  );
}
