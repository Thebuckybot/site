import { getNode, listNode } from "../core/filesystem.js";

export function renderFilesApp(runtime) {
    const home = runtime.filesystem.cwd;
    const rootEntries = listNode(runtime.filesystem.tree);
    const homeNode = getNode(runtime.filesystem.tree, home);
    const homeEntries = listNode(homeNode);

    const sidebar = rootEntries.map((entry) => `
        <button class="vm-file-source" type="button">
            <span>${entry.type === "dir" ? "DIR" : "TXT"}</span>${entry.name}
        </button>
    `).join("");

    const files = homeEntries.map((entry) => `
        <div class="vm-file-tile">
            <div class="vm-file-icon">${entry.type === "dir" ? "DIR" : "TXT"}</div>
            <span>${entry.name}</span>
        </div>
    `).join("");

    return `
        <div class="vm-files-app">
            <aside class="vm-files-sidebar">${sidebar}</aside>
            <section class="vm-files-main">
                <div class="vm-files-path">${home}</div>
                <div class="vm-files-grid">${files}</div>
            </section>
        </div>
    `;
}
