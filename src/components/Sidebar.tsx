import { For, Show, createEffect, createSignal } from "solid-js";
import { ChevronDown, ChevronRight, FileCode2, Folder, FolderOpen } from "lucide-solid";
import { api, FileNode, WorkspaceSearchHit } from "../api/bridge";
import { I18nDict } from "../i18n";

interface SidebarProps {
  mode: "files" | "search";
  workspaceRoot: string | null;
  activePath: string | null;
  t: I18nDict;
  onModeChange: (mode: "files" | "search") => void;
  onPickFolder: () => void;
  onOpenFile: (path: string, line?: number) => void;
}

interface TreeBranchProps {
  node: FileNode;
  depth: number;
  activePath: string | null;
  onOpenFile: (path: string) => void;
}

function TreeBranch(props: TreeBranchProps) {
  const [expanded, setExpanded] = createSignal(false);
  const [children, setChildren] = createSignal<FileNode[]>([]);

  const toggle = async () => {
    if (!props.node.is_dir) {
      props.onOpenFile(props.node.path);
      return;
    }
    if (!expanded() && children().length === 0) {
      const list = await api.listDir(props.node.path);
      setChildren(list);
    }
    setExpanded((v) => !v);
  };

  return (
    <>
      <div
        class={`tree-row${props.activePath === props.node.path ? " active" : ""}`}
        style={{ "padding-left": `${8 + props.depth * 14}px` }}
        onClick={toggle}
        title={props.node.path}
      >
        <Show
          when={props.node.is_dir}
          fallback={<FileCode2 size={14} style={{ "flex-shrink": "0", opacity: "0.7" }} />}
        >
          {expanded() ? (
            <ChevronDown size={13} style={{ "flex-shrink": "0" }} />
          ) : (
            <ChevronRight size={13} style={{ "flex-shrink": "0" }} />
          )}
          {expanded() ? (
            <FolderOpen size={14} style={{ "flex-shrink": "0", color: "var(--accent)" }} />
          ) : (
            <Folder size={14} style={{ "flex-shrink": "0", opacity: "0.8" }} />
          )}
        </Show>
        <span>{props.node.name}</span>
      </div>
      <Show when={expanded()}>
        <For each={children()}>
          {(child) => (
            <TreeBranch
              node={child}
              depth={props.depth + 1}
              activePath={props.activePath}
              onOpenFile={props.onOpenFile}
            />
          )}
        </For>
      </Show>
    </>
  );
}

export function Sidebar(props: SidebarProps) {
  const [rootNodes, setRootNodes] = createSignal<FileNode[]>([]);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchHits, setSearchHits] = createSignal<WorkspaceSearchHit[]>([]);
  const [searching, setSearching] = createSignal(false);

  createEffect(() => {
    const root = props.workspaceRoot;
    if (!root) {
      setRootNodes([]);
      return;
    }
    api.listDir(root).then(setRootNodes).catch(() => setRootNodes([]));
  });

  const runSearch = async (q: string) => {
    setSearchQuery(q);
    if (!props.workspaceRoot || q.trim().length < 2) {
      setSearchHits([]);
      return;
    }
    setSearching(true);
    try {
      const hits = await api.searchWorkspace(props.workspaceRoot, q, false, false);
      setSearchHits(hits);
    } catch {
      setSearchHits([]);
    } finally {
      setSearching(false);
    }
  };

  return (
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-tabs">
          <button
            class={`sidebar-tab-btn${props.mode === "files" ? " active" : ""}`}
            onClick={() => props.onModeChange("files")}
          >
            {props.t.files}
          </button>
          <button
            class={`sidebar-tab-btn${props.mode === "search" ? " active" : ""}`}
            onClick={() => props.onModeChange("search")}
          >
            {props.t.search}
          </button>
        </div>
        <Show when={props.workspaceRoot}>
          <button
            class="icon-btn"
            title={props.t.switchFolder}
            onClick={props.onPickFolder}
          >
            <FolderOpen size={14} />
          </button>
        </Show>
      </div>

      <Show when={props.mode === "files"}>
        <div class="sidebar-content scroller">
          <Show
            when={props.workspaceRoot}
            fallback={
              <div class="empty-folder-box">
                <div>{props.t.noFolderHint}</div>
                <button class="primary-btn" onClick={props.onPickFolder}>
                  <FolderOpen size={14} />
                  {props.t.openFolder}
                </button>
              </div>
            }
          >
            <For each={rootNodes()}>
              {(node) => (
                <TreeBranch
                  node={node}
                  depth={0}
                  activePath={props.activePath}
                  onOpenFile={(p) => props.onOpenFile(p)}
                />
              )}
            </For>
          </Show>
        </div>
      </Show>

      <Show when={props.mode === "search"}>
        <div class="search-panel">
          <input
            class="input-minimal"
            placeholder={
              props.workspaceRoot ? props.t.searchPlaceholder : props.t.searchNeedFolder
            }
            disabled={!props.workspaceRoot}
            value={searchQuery()}
            onInput={(e) => runSearch(e.currentTarget.value)}
          />
          <div style={{ "font-size": "11px", color: "var(--text-muted)" }}>
            {searching() ? props.t.searching : props.t.searchResults(searchHits().length)}
          </div>
          <div class="sidebar-content scroller" style={{ padding: "0" }}>
            <For each={searchHits()}>
              {(hit) => (
                <div
                  class="search-hit"
                  onClick={() => props.onOpenFile(hit.path, hit.line)}
                >
                  <div class="search-hit-file">
                    {hit.relative_path}:{hit.line + 1}
                  </div>
                  <div class="search-hit-line">{hit.preview}</div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </aside>
  );
}
