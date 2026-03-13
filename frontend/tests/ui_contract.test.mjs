import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = "D:/Spotify_AnylaticsWeb_App/frontend";
const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("group multi-select shortcuts and empty-area context menu are wired", () => {
  assert.match(appJs, /e\.key\.toLowerCase\(\)\s*===\s*'a'/);
  assert.match(appJs, /selectAllGroups\(\)/);
  assert.match(appJs, /listScrollWrap\.addEventListener\('contextmenu'/);
  assert.match(appJs, /showRowContextMenu\(e\.clientX,\s*e\.clientY,\s*null\)/);
});

test("owner sort control exists and is handled", () => {
  assert.match(indexHtml, /id="owner-sort-select"/);
  assert.match(appJs, /ownerSortSelect\.addEventListener\('change'/);
  assert.match(appJs, /playlistOwnerSortDirection/);
});

test("group context menu has clear and delete actions", () => {
  assert.match(indexHtml, /id="group-context-menu"/);
  assert.match(indexHtml, /data-group-context-action="clear-list"/);
  assert.match(indexHtml, /data-group-context-action="delete-group"/);
});

test("copy clipboard no longer exposes track\/album\/playlist submenu items", () => {
  assert.match(indexHtml, /data-context-action="clipboard-selected"/);
  assert.doesNotMatch(indexHtml, /txt-playlist-type3/);
  assert.doesNotMatch(indexHtml, /txt-album-type0/);
  assert.doesNotMatch(indexHtml, /txt-track-offline/);
});

