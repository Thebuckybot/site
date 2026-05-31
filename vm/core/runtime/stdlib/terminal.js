/**
 * bucky.terminal — output + interaction helpers (Phase 4.4, Parts 2, 4 & 18).
 *
 * Convenience around the interpreter's output stream so scripts can produce a
 * professional, consistent presentation (banners, rules, headers) without
 * hand-rolling separators. Writes through the same channel as print(), so
 * output appears live in the terminal scrollback / BuckyCode output panel.
 *
 *   print(*args)   line(text)   banner(title)   rule()   header(title)
 *   input(prompt)  -> suspends the run for terminal input (pausing marker)
 */
import { mod } from "./kit.js";

const RULE = "=================================";

export function createTerminalModule(ctx) {
    const emit = (interp, text) => interp.print(text);

    return mod("bucky.terminal", {
        print: (args, kwargs, interp) => interp.print.apply(interp, args || []),
        line: (args, kwargs, interp) => emit(interp, args && args.length ? String(args[0]) : ""),
        rule: (args, kwargs, interp) => emit(interp, RULE),
        banner: (args, kwargs, interp) => {
            const title = args && args[0] != null ? String(args[0]) : "";
            interp.print(RULE);
            interp.print(title);
            interp.print(RULE);
            return null;
        },
        header: (args, kwargs, interp) => {
            const title = args && args[0] != null ? String(args[0]) : "";
            interp.print(title);
            interp.print("-".repeat(Math.max(3, title.length)));
            return null;
        },
        // Pausing marker — recognised by the interpreter exactly like the
        // builtin input(); terminal.input("prompt") suspends the run.
        input: { __input__: true, pyName: "terminal.input" }
    });
}
