// Het script van vm-test.html. Stond inline in de pagina; de Content
// Security Policy staat geen inline scripts toe.

/*
 * Local-only guard. This harness is a development tool and must never
 * run on a hosted environment (GitHub Pages, etc.). The check is fully
 * self-contained — it does not depend on any backend. On a non-local
 * host the VM runtime is never even imported, so boot cannot start.
 */
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];
const isLocal = LOCAL_HOSTS.includes(location.hostname);

if (!isLocal) {
    const blok = document.createElement("div");
    blok.className = "harness-blocked";
    const kop = document.createElement("h1");
    kop.textContent = "DEVELOPMENT ONLY";
    const uitleg = document.createElement("p");
    uitleg.textContent = "The Bucky VM test harness runs on localhost only and is "
        + "disabled on hosted environments. Open it from a local "
        + "development server to use it.";
    blok.append(kop, uitleg);
    document.querySelector(".harness").replaceChildren(blok);
} else {
    const { BuckyVMRuntime } = await import("./core/vmRuntime.js");
    const root = document.getElementById("bucky-vm-root");
    const vm = new BuckyVMRuntime(root, { username: "Tommy" }, { debug: true });
    vm.start();

    // Exposed for manual inspection in the devtools console.
    window.buckyVM = vm;
}
