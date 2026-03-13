import json
import shutil
import subprocess
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
FRONTEND_APP_JS = ROOT_DIR / "frontend" / "app.js"


def _run_frontend_js(js_statement: str):
    node_bin = shutil.which("node")
    if not node_bin:
        raise RuntimeError("Node.js is required for frontend behavior tests.")

    app_js_path = FRONTEND_APP_JS.as_posix()
    prelude = f"""
const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync({json.dumps(app_js_path)}, 'utf8');
const noop = () => {{}};
const storage = new Map();
const localStorage = {{
  getItem: (key) => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
}};
const document = {{
  addEventListener: noop,
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({{
    style: {{}},
    classList: {{ add: noop, remove: noop, toggle: noop }},
    appendChild: noop,
    setAttribute: noop,
    innerHTML: '',
    onclick: null,
  }}),
  body: {{ classList: {{ add: noop, remove: noop, toggle: noop }} }},
}};
const context = {{
  window: {{
    location: {{ hostname: 'localhost', href: 'http://localhost/' }},
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: noop,
  }},
  document,
  localStorage,
  console,
  fetch: async () => ({{
    ok: true,
    status: 200,
    json: async () => ({{}}),
    text: async () => '',
    clone() {{ return this; }},
  }}),
  URLSearchParams,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  requestAnimationFrame: (cb) => setTimeout(cb, 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
  MutationObserver: class {{
    constructor(cb) {{ this.cb = cb; }}
    observe() {{}}
    disconnect() {{}}
  }},
  navigator: {{ clipboard: {{ writeText: async () => {{}} }} }},
  confirm: () => true,
  alert: noop,
}};
context.window.document = document;
context.window.localStorage = localStorage;
context.window.navigator = context.navigator;
context.window.setTimeout = setTimeout;
context.window.clearTimeout = clearTimeout;
context.window.setInterval = setInterval;
context.window.clearInterval = clearInterval;
vm.createContext(context);
vm.runInContext(code, context, {{ filename: 'app.js' }});
vm.runInContext({json.dumps(js_statement)}, context);
process.stdout.write(JSON.stringify(context.__result));
"""
    output = subprocess.check_output([node_bin, "-e", prelude], cwd=ROOT_DIR, text=True).strip()
    return json.loads(output)


def test_select_all_groups_only_selects_manageable_groups():
    result = _run_frontend_js(
        """
renderGroups = () => {};
showToast = () => {};
canManageGroupEntry = (group) => Boolean(group && group.manageable);
state.groups = [
  { id: 'all', manageable: false },
  { id: 'group-1', manageable: true },
  { id: 'group-2', manageable: true },
  { id: 'group-3', manageable: false },
];
state.selectedGroupIds = new Set();
state.groupSelectionAnchorId = null;
selectAllGroups();
globalThis.__result = {
  selected: Array.from(state.selectedGroupIds),
  anchor: state.groupSelectionAnchorId,
};
"""
    )
    assert result["selected"] == ["group-1", "group-2"]
    assert result["anchor"] == "group-1"


def test_move_custom_group_before_supports_multi_group_block_move():
    result = _run_frontend_js(
        """
saveCustomGroups = () => {};
state.customGroups = ['Group A', 'Group B', 'Group C', 'Group D'];
state.groups = [
  { id: 'all', name: 'All Links' },
  { id: 'Group A', name: 'Group A' },
  { id: 'Group B', name: 'Group B' },
  { id: 'Group C', name: 'Group C' },
  { id: 'Group D', name: 'Group D' },
];
const moved = moveCustomGroupBefore(['Group C', 'Group D'], 'Group B', 'before');
globalThis.__result = {
  moved,
  order: state.customGroups.slice(),
};
"""
    )
    assert result["moved"] is True
    assert result["order"] == ["Group A", "Group C", "Group D", "Group B"]


def test_ctrl_a_shortcut_triggers_group_select_all():
    source = FRONTEND_APP_JS.read_text(encoding="utf-8", errors="ignore")
    assert "(e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a'" in source
    assert "selectAllGroups();" in source


def test_empty_list_area_context_menu_opens_row_menu():
    source = FRONTEND_APP_JS.read_text(encoding="utf-8", errors="ignore")
    assert "listScrollWrap.addEventListener('contextmenu'" in source
    assert "showRowContextMenu(e.clientX, e.clientY, null);" in source


def test_group_delete_flow_uses_multi_selection_when_target_is_selected():
    source = FRONTEND_APP_JS.read_text(encoding="utf-8", errors="ignore")
    assert "const selectedGroupIds = Array.from(state.selectedGroupIds).filter((id) => {" in source
    assert "const targetIds = selectedGroupIds.length > 1" in source
    assert "Delete ${targetIds.length} selected groups?" in source
