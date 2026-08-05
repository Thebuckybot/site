/**
 * Phase 4.5B + 4.6 runtime regression suite (headless).
 *
 * Guards the confirmed Phase 4.5B bugs (1-6) + Phase 4.6 bugs (7 hackbank
 * ownership, 8 inventory amount) + a core language compatibility battery + the
 * bundled examples against silent regression. Runs the REAL site/vm runtime
 * (interpreter + stdlib + snapshot store) with faithful fake backend payloads —
 * no DOM, no network.
 *
 * Run:  bash site/vm/tests/run.sh     (copies vm to a temp ESM dir and runs)
 * Exit code 0 = all guards pass; non-zero = a regression was reintroduced.
 *
 * Each assertion names the bug/feature it protects so a failure points straight
 * at it.
 */
import { createRuntime } from "../core/runtime/index.js";
import { prefetchSnapshot } from "../core/runtime/snapshot.js";
import { createSnapshotStore } from "../core/runtime/snapshotStore.js";
import { renderMarkdown } from "../core/markdown.js";
import { EXAMPLE_DEMOS } from "../core/runtime/examples_demos.js";
import { EXAMPLE_SCRIPTS } from "../core/runtime/examples.js";

let failures = 0;
const okmsg = (m) => console.log("  PASS  " + m);
const fail  = (m) => { console.log("  FAIL  " + m); failures++; };
const assert = (cond, m) => cond ? okmsg(m) : fail(m);

// Phase 4.6 fixture realism: the bot stores items as { id, amount } (NOT
// { name, quantity }), and HackBank ownership comes from attack_scripts — there
// is no "hackbank" inventory item. The old fixture seeded a fake { name:
// "hackbank" } item, which masked BUG-7 entirely.
const SEC = { bank_code_set:true, firewall_level:0, breached:false,
  active_security:"firewall_3", security_scripts_count:3, security_scripts:["firewall_1","firewall_2","firewall_3"],
  attack_scripts_count:1, attack_scripts:["bruteforce"], active_attack:"bruteforce" };
const ME = { available:true, item:{ user_id:"1", level:57, prestige:2, coins:7958921, bank:4000000, networth:11958921,
  inventory_count:2, items:[{id:"usb_killer",amount:1},{id:"shard",amount:7}],
  organization:{id:"null",name:"Null Division",reputation:880}, reputation:880, titles:["Ghost"], exposures:[], security:SEC } };
const row=(r,u,l)=>({rank:r,user_id:u,level:l,score_value:l});
const LB={available:true,kinds:["richest","level","org-reputation","most-leaked"],boards:[
  {kind:"richest",items:[row(1,"111",57),row(2,"222",40)]},{kind:"level",items:[row(1,"111",57)]},
  {kind:"org-reputation",items:[{rank:1,org_id:"null",name:"Null Division",reputation:880,members:12,score_value:880}]},
  {kind:"most-leaked",items:[]}]};
const ok=(d)=>Promise.resolve({ok:true,status:200,error:null,data:d});
const GW={hasAuthToken:()=>true,fetchSelfPlayer:()=>ok(ME),fetchLeaderboards:()=>ok(LB),
  fetchLeakStats:()=>ok({stats:{total_incidents:42}}),fetchLeakIncidents:()=>ok({items:[{incident_id:"LEAK-1",title:"Helix",severity:"high"}]}),
  fetchLeakOperators:()=>ok({records:[{handle:"gh0st",severity:"high",incident_id:"LEAK-1"}]}),fetchMyLeaks:()=>ok({items:[]}),
  fetchOrganizations:()=>ok({items:[{id:"null",name:"Null Division",members:12,reputation:880}]}),fetchMyOrganization:()=>ok({item:{id:"null",name:"Null Division"}})};
function FS(){const f={};return{homePath:"/projects",read:(p)=>f[p]?{ok:true,content:f[p]}:{ok:false,error:"nf"},write:(p,c)=>{f[p]=String(c);return{ok:true};},append:(p,c)=>{f[p]=(f[p]||"")+String(c);return{ok:true};},exists:(p)=>!!f[p],normalize:(p)=>p,parentOf:()=>({parentPath:"/projects"}),mkdir:()=>({ok:true}),isdir:()=>false,list:()=>({ok:true,entries:[]}),resolve:(_b,p)=>String(p)};}
const NEEDS=["leaks","profile","organizations","leaderboards"];
async function rt(){const s=await prefetchSnapshot(GW,new Set(NEEDS));return createRuntime({filesystem:FS(),snapshot:s,user:{id:"1"}});}
async function run(src,argv=[]){return (await rt()).run(src,{argv});}
async function inter(src,inp){const r=await rt();const se=r.session(src,{});let st=se.start();const q=inp.slice();while(st.status==="input")st=se.provide(q.length?q.shift():"");return se.output;}
// Phase 4.6: run a script against an arbitrary self-view profile.
function gwFor(item){return {hasAuthToken:()=>true,fetchSelfPlayer:()=>ok({available:true,item}),
  fetchLeaderboards:()=>ok(LB),fetchLeakStats:()=>ok({stats:{}}),fetchLeakIncidents:()=>ok({items:[]}),
  fetchLeakOperators:()=>ok({records:[]}),fetchMyLeaks:()=>ok({items:[]}),
  fetchOrganizations:()=>ok({items:[]}),fetchMyOrganization:()=>ok({item:null})};}
async function runProfile(item,src){const s=await prefetchSnapshot(gwFor(item),new Set(NEEDS));return createRuntime({filesystem:FS(),snapshot:s,user:{id:"1"}}).run(src,{argv:[]});}
const J=(r)=>r.output.join(" ");

(async()=>{
  console.log("Phase 4.5B + 4.6 regression suite\n");

  // BUG 1 — menu.show returns a structured selection (both arg orders).
  let o = await inter('s=menu.show(["Leaks","Profile","Exit"],"M")\nprint(s["index"],s["label"]) if s!=None else print("NONE")', ["2"]);
  assert(/2 Profile/.test(o.join(" ")), "BUG1 menu.show(items,title) returns selection");
  o = await inter('s=menu.show("M",["Leaks","Profile","Exit"])\nprint(s["index"],s["label"]) if s!=None else print("NONE")', ["3"]);
  assert(/3 Exit/.test(o.join(" ")), "BUG1 menu.show(title,items) swapped order still works");

  // BUG 3 — print(table.render(rows)) renders once; capture still works.
  let r = await run('rows=[{"u":"Tommy"},{"u":"Bucky"}]\nprint(table.render(rows))');
  assert(r.output.filter(l=>/Tommy/.test(l)).length===1, "BUG3 print(table.render) shows table once");
  r = await run('b=table.render([{"a":1}])\nfiles.write("/p.txt",b)\nprint("C:",files.read("/p.txt"))');
  assert(/C: A/.test(r.output.join("\n")), "BUG3 table.render return still captures text");

  // BUG 2 — status.card reflects real profile.
  r = await run('status.card("P",{"level":profile.level(),"coins":profile.coins()})');
  assert(/57/.test(r.output.join("\n")) && /7958921/.test(r.output.join("\n")), "BUG2 status.card shows real profile data");

  // BUG 4/5 — leaderboards populated.
  r = await run('print(len(leaderboards.richest()), len(leaderboards.top("level")))');
  assert(/2 1/.test(r.output.join(" ")), "BUG4/5 leaderboards.richest()/top() return rows");

  // BUG 6 — firewall derived from active_security.
  r = await run('print(security.firewall()["level"], security.firewall()["tier"])');
  assert(/3 hardened/.test(r.output.join(" ")), "BUG6 security.firewall() reports level 3 / hardened");

  // ---- Phase 4.6 ---------------------------------------------------------
  // BUG 7 — HackBank ownership mirrors Currency.py: the `hackbank` command is
  // gated on owning >=1 ATTACK script. There is no "hackbank" inventory item.
  const ATTACKER={user_id:"1",items:[{id:"usb_killer",amount:1}],
    security:{attack_scripts_count:2,attack_scripts:["bruteforce","trojan"],security_scripts_count:0}};
  r=await runProfile(ATTACKER,'print(hackbank.owned(), hackbank.available())');
  assert(/True True/.test(J(r)), "BUG7 hackbank.owned() True when operator owns attack scripts");

  // The original bug-report scenario: owns only SECURITY scripts (defensive).
  // Per Currency.py that does NOT grant HackBank — must read False.
  const DEFENDER={user_id:"2",items:[],
    security:{attack_scripts_count:0,attack_scripts:[],security_scripts_count:3,active_security:"firewall_3",security_scripts:["firewall_3"]}};
  r=await runProfile(DEFENDER,'print(hackbank.owned())');
  assert(/\bFalse\b/.test(J(r)) && r.ok, "BUG7 hackbank.owned() False with security scripts only (no attack scripts)");

  // A stray item literally named "hackbank" must NOT fake ownership anymore.
  const FAKEITEM={user_id:"3",items:[{id:"hackbank",amount:1}],security:{attack_scripts_count:0,attack_scripts:[]}};
  r=await runProfile(FAKEITEM,'print(hackbank.owned())');
  assert(/\bFalse\b/.test(J(r)) && r.ok, "BUG7 a stray 'hackbank'-named item no longer fakes ownership");

  // Explicit override still wins (Discord may pin ownership directly).
  const PINNED={user_id:"5",hackbank:{owned:true},security:{attack_scripts_count:0,attack_scripts:[]}};
  r=await runProfile(PINNED,'print(hackbank.owned())');
  assert(/\bTrue\b/.test(J(r)) && r.ok, "BUG7 explicit profile.hackbank.owned override honoured");

  // BUG 8 — inventory.count() reads the bot's `amount` field (was `quantity`),
  // so stacked items are counted, not collapsed to 1.
  const STACK={user_id:"4",items:[{id:"shard",amount:50},{id:"usb",amount:1}]};
  r=await runProfile(STACK,'print(inventory.count("shard"), inventory.count(), inventory.has("usb"))');
  assert(/50 51 True/.test(J(r)) && r.ok, "BUG8 inventory.count() reads amount (stacked items counted)");

  // ---- Language compatibility battery (Phase 4.6, P3) --------------------
  r = await run('x=2\nif x==1:\n    print("a")\nelif x==2:\n    print("b")\nelse:\n    print("c")');
  assert(/b/.test(r.output.join("")) && r.ok, "LANG if/elif/else");
  r = await run('t=0\nfor i in range(5):\n    if i==3:\n        break\n    if i==1:\n        continue\n    t+=i\nprint(t)');
  assert(/\b2\b/.test(J(r)) && r.ok, "LANG for + break + continue");
  r = await run('n=0\nwhile n<3:\n    n+=1\nprint(n)');
  assert(/\b3\b/.test(J(r)) && r.ok, "LANG while loop");
  r = await run('def fib(n):\n    if n<2:\n        return n\n    return fib(n-1)+fib(n-2)\nprint(fib(10))');
  assert(/\b55\b/.test(J(r)) && r.ok, "LANG def + recursion + return + nested calls");
  r = await run('def mk(a):\n    def add(b):\n        return a+b\n    return add\nprint(mk(10)(5))');
  assert(/\b15\b/.test(J(r)) && r.ok, "LANG closures");
  r = await run('d={"a":{"b":[1,2,3]}}\nprint(d["a"]["b"][2], 3 in d["a"]["b"], "a" in d)');
  assert(/3 True True/.test(J(r)) && r.ok, "LANG nested dict/list + membership");
  r = await run('print(True and False, True or False, not False, 3<=3, 4!=5)');
  assert(/False True True True True/.test(J(r)) && r.ok, "LANG boolean logic + comparisons");
  r = await run('print(17//5, 17%5, 2**8, 10/4)');
  assert(/3 2 256 2\.5/.test(J(r)) && r.ok, "LANG operators // % ** /");
  r = await run('n="Tommy"\nprint(f"{n} L{2**4}")\nprint("a,b".split(",")[1].upper())');
  assert(/Tommy L16/.test(J(r)) && /\bB\b/.test(J(r)) && r.ok, "LANG f-string + string methods");
  r = await run('json.save("/d.json",{"k":42})\nv=json.load("/d.json")\nprint(v["k"])');
  assert(/\b42\b/.test(J(r)) && r.ok, "LANG file/json round-trip");

  // Error reporting: typed, line-numbered, host never crashes; output preserved
  // up to the failing line.
  r = await run('print("before")\nprint(1/0)\nprint("after")');
  assert(r.ok===false && /ZeroDivisionError/.test(r.error||"") && /Line 2/.test(r.error||"") && r.output.join("").includes("before"),
    "LANG runtime formats typed errors (ZeroDivisionError, line-numbered)");
  r = await run('print(undefined_var)');
  assert(r.ok===false && /NameError/.test(r.error||""), "LANG runtime formats NameError");

  // GAP GUARD — try/except + raise are NOT supported yet (Phase 4.6 finding).
  // If either of these starts passing, the interpreter gained exception
  // handling: update docs/phase4.6 language report + Phase 5 readiness notes.
  r = await run('try:\n    x=1\nexcept:\n    x=2\nprint(x)');
  assert(r.ok===false && /SyntaxError/.test(r.error||""), "LANG (gap) try/except still unsupported — revisit docs if this flips");
  r = await run('raise ValueError("boom")');
  assert(r.ok===false && /SyntaxError/.test(r.error||""), "LANG (gap) raise still unsupported — revisit docs if this flips");

  // BLOK 4 — a[::-1] used to HANG the VM. The old slice loop ran
  // `for (k = start; k < stop; k += step)`; with step -1 that starts at 0,
  // decrements, and never reaches its stop — an infinite loop with no tick()
  // in it, so no budget could stop it. Reversing a list is an everyday idiom
  // and the cost was a frozen browser tab, not an error.
  r = await run('print([1,2,3][::-1])');
  assert(r.ok && /3, 2, 1/.test(J(r)), "SLICE a[::-1] reverses a list");
  r = await run("print('abcdef'[::-1])");
  assert(r.ok && /fedcba/.test(J(r)), "SLICE a[::-1] reverses a string");
  r = await run('print([1,2,3,4,5][::-2])');
  assert(r.ok && /5, 3, 1/.test(J(r)), "SLICE a[::-2] steps backwards by two");
  r = await run('print([0,1,2,3,4,5][4:1:-1])');
  assert(r.ok && /4, 3, 2/.test(J(r)), "SLICE explicit bounds with a negative step");
  r = await run('print([1,2,3][::0])');
  assert(r.ok===false && /step cannot be zero/.test(r.error||""), "SLICE step 0 is a ValueError, not a hang");
  // And the forward cases still behave, so the negative branch did not eat them.
  r = await run('print([1,2,3,4,5][::2], [1,2,3,4,5][1:4], [1,2,3,4,5][-2:], [1,2,3,4,5][:-2])');
  assert(r.ok && /1, 3, 5/.test(J(r)) && /2, 3, 4/.test(J(r)) && /4, 5/.test(J(r)) && /1, 2, 3/.test(J(r)),
         "SLICE forward slicing is unchanged");

  // BLOK 4 — zip() referenced an undeclared `out` and had therefore NEVER
  // worked: every call raised "out is not defined" on a name the script never
  // typed. It is bound as a builtin and documented as available.
  r = await run("print(zip([1,2,3],['a','b']))");
  assert(r.ok && /1, 'a'/.test(J(r)) && /2, 'b'/.test(J(r)), "ZIP pairs two lists and stops at the shortest");
  r = await run("print(zip())");
  assert(r.ok, "ZIP with no arguments returns empty instead of raising");
  r = await run("for p in zip([1,2],['x','y']):\n    print(p[0], p[1])");
  assert(r.ok && /1 x/.test(J(r)) && /2 y/.test(J(r)), "ZIP is iterable in a for loop");

  // BLOK 4 — de docs-pagina wordt GEGENEREERD uit de moduletabel, en dit is de
  // guard waar die belofte op rust. helptext.js is prose, nooit de inventaris;
  // gemeten voor deze ronde was hij weggedreven met 1 verzonnen lid, 4 modules
  // zonder entry, 20 ongedocumenteerde leden en vier examples die niet parsen.
  {
    const { helpDrift, buildDocs } = await import("../core/runtime/docs.js");
    const drift = helpDrift();
    assert(drift.invented.length === 0,
      "DOCS help documents nothing that does not exist (" + drift.invented.join(", ") + ")");
    assert(drift.missingEntry.length === 0,
      "DOCS every module has a description (" + drift.missingEntry.join(", ") + ")");
    assert(drift.undocumented.length === 0,
      "DOCS every member is documented (" + drift.undocumented.join(", ") + ")");

    const model = buildDocs();
    assert(model.modules.length >= 25, "DOCS the model finds the module table");
    assert(model.language.builtins.includes("zip") && model.language.methods.str.includes("upper"),
      "DOCS the language surface comes from the interpreter itself");
    // Een stub mag nooit als werkende aanroep gepresenteerd worden.
    const db = model.modules.find((m) => m.name === "database");
    assert(db && db.raising === db.members.length && db.working === 0,
      "DOCS an interface-only module is marked as raising, not as working");
    const eco = model.modules.find((m) => m.name === "economy");
    assert(eco && eco.members.find((x) => x.name === "transfer").status === "raises",
      "DOCS economy.transfer is marked as raising");
    assert(eco.members.find((x) => x.name === "balance").status === "ok",
      "DOCS a working member is not marked as raising");
  }

  // EN ELKE `example` IN DE HELP MOET DRAAIEN. Vier deden dat niet: ze gebruikten
  // een puntkomma die deze interpreter weigert, dus wie ze kopieerde kreeg een
  // SyntaxError uit het helpsysteem zelf.
  {
    const { HELP } = await import("../core/runtime/stdlib/helptext.js");
    const interactief = new Set(["form", "menu"]);   // die vragen de Terminal
    let stuk = [];
    for (const sleutel of Object.keys(HELP)) {
      const voorbeeld = HELP[sleutel].example;
      if (!voorbeeld || interactief.has(sleutel)) continue;
      if (voorbeeld.trim().startsWith("#")) continue;   // alleen commentaar
      const res = await run(voorbeeld);
      if (!res.ok && /SyntaxError/.test(res.error || "")) stuk.push(sleutel + ": " + res.error);
    }
    assert(stuk.length === 0, "DOCS every help example parses (" + stuk.join(" | ") + ")");
  }

  // En de pagina zelf, want een model dat klopt is nog geen pagina die rendert.
  {
    const { createSiteRegistry } = await import("../core/siteRegistry.js");
    const { registerDocsSite } = await import("../apps/browser/sites/docs.js");
    const reg = createSiteRegistry();
    registerDocsSite(reg);

    const index = reg.resolve("bucky://docs").render({ url: "bucky://docs" });
    assert(/vm-docs-cards/.test(index) && /The language/.test(index) && /Budgets/.test(index),
      "DOCS the index page renders modules, the language and the budgets");
    assert(!/do not match the runtime/.test(index),
      "DOCS the index reports no drift");
    // De val uit blok 4, taak D4: sitePage() escapet `domain` en `lead`, dus een
    // HTML-entiteit daarin komt letterlijk op het scherm.
    assert(!/&amp;(middot|nbsp|amp);/.test(index),
      "DOCS no HTML entity ends up on screen as literal text");

    const eco = reg.resolve("bucky://docs/economy").render({ url: "bucky://docs/economy" });
    assert(/is-stub/.test(eco), "DOCS a raising member gets a visible badge");

    // Zoeken op een METHODENAAM moet de modulepagina vinden - dat is wat een
    // speler intypt, niet de modulenaam.
    const treffers = reg.search("richest").map((h) => (h.entry || h).url);
    assert(treffers.includes("bucky://docs/leaderboards"),
      "DOCS searching for a method name finds its module page");
  }

  // Hydration — cold 200-empty must NOT poison the section; it re-hydrates.
  let mode="empty";
  const eLB={available:true,kinds:[],boards:[{kind:"richest",items:[]}]};
  const g2={hasAuthToken:()=>true,fetchSelfPlayer:()=>ok(mode==="empty"?{available:true,first_run:true,item:null}:ME),
    fetchLeaderboards:()=>ok(mode==="empty"?eLB:LB),fetchLeakStats:()=>ok({stats:{}}),fetchLeakIncidents:()=>ok({items:[]}),
    fetchLeakOperators:()=>ok({records:[]}),fetchMyLeaks:()=>ok({items:[]}),fetchOrganizations:()=>ok({items:[]}),fetchMyOrganization:()=>ok({item:null})};
  const store=createSnapshotStore(g2);
  await store.ensure(new Set(["profile","leaderboards"]));
  mode="full";
  const s2=await store.ensure(new Set(["profile","leaderboards"]));
  assert((s2.profile&&s2.profile.level===57)&&((s2.leaderboards.kinds.richest||[]).length>0), "HYDRATION cold-empty re-hydrates when data appears");

  // Markdown table renders to a table element with escaped cells.
  const html=renderMarkdown("| U | L |\n|---|---|\n| Tommy | 57 |\n| <b>x</b> | 1 |");
  assert(/<table class="vm-md-table">/.test(html)&&/<td>Tommy<\/td>/.test(html)&&/&lt;b&gt;/.test(html), "MARKDOWN GFM table renders + escapes");

  // All bundled examples execute without error.
  const examples = {...EXAMPLE_DEMOS, ...EXAMPLE_SCRIPTS};
  const skipInteractive = new Set(["menu.py","bruteforce_demo.py"]);
  let ex=0, exFail=0;
  for (const [name, src] of Object.entries(examples)) {
    if (skipInteractive.has(name)) continue;
    ex++;
    const argv = name==="args_demo.py" ? ["-u:1","--full"] : [];
    const res = await run(src, argv);
    if (!res.ok) { exFail++; console.log("    example FAIL: "+name+" -> "+res.error); }
  }
  assert(exFail===0, `EXAMPLES ${ex-exFail}/${ex} bundled scripts run clean`);

  console.log("\n" + (failures===0 ? "ALL GUARDS PASS ✓" : (failures+" GUARD(S) FAILED ✗")));
  process.exit(failures===0?0:1);
})().catch(e=>{console.error("SUITE ERROR:",e);process.exit(2);});
