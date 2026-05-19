const makeUserName = (username) => (username || "operator").replace(/[^\w.-]/g, "_");

export function createVirtualFilesystem(username) {
    const safeName = makeUserName(username);

    return {
        cwd: `/users/${safeName}/home`,
        tree: {
            users: {
                [safeName]: {
                    home: {
                        "readme.txt": `Welcome ${username || "operator"}.\nThis is a simulated Bucky VM filesystem.\nNo command leaves the browser.`,
                        "mission.txt": "Locate signal traces, inspect logs, and keep the arcade node warm."
                    },
                    desktop: {
                        "terminal.link": "Terminal",
                        "files.link": "Files"
                    }
                }
            },
            logs: {
                "boot.log": "INITIALIZING VM\nLOADING MEMORY\nCONNECTING SECURE NODE\nBOOTING BUCKY OS",
                "network.log": "127.0.0.1 arcade-node stable\nsecure relay bucky.net simulated"
            },
            downloads: {
                "cipher.pkg": "48 45 4c 4c 4f 20 42 55 43 4b 59"
            },
            targets: {
                "arcade-node.json": "{ \"target\": \"arcade-node\", \"status\": \"online\", \"risk\": \"low\" }"
            },
            mail: {
                "welcome.msg": "Subject: Bucky VM\nThe workstation is online. More apps are coming."
            },
            system: {
                "version.sys": "Bucky OS 0.1 cinematic desktop runtime",
                "apps.sys": "terminal files browser mail database osint missions"
            }
        }
    };
}

export function resolvePath(cwd, input = "") {
    if (!input || input === ".") return cwd;
    const parts = input.startsWith("/") ? [] : cwd.split("/").filter(Boolean);

    input.split("/").filter(Boolean).forEach((part) => {
        if (part === ".") return;
        if (part === "..") {
            parts.pop();
            return;
        }
        parts.push(part);
    });

    return `/${parts.join("/")}`;
}

export function getNode(tree, path) {
    const parts = path.split("/").filter(Boolean);
    let node = tree;

    for (const part of parts) {
        if (!node || typeof node !== "object" || !(part in node)) return null;
        node = node[part];
    }

    return node;
}

export function listNode(node) {
    if (!node || typeof node !== "object") return [];
    return Object.entries(node).map(([name, value]) => ({
        name,
        type: typeof value === "object" ? "dir" : "file"
    }));
}
