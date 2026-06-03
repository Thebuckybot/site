/**
 * Phase 4.5B runtime regression suite (headless).
 *
 * Guards the six confirmed Phase 4.5B bugs + the bundled examples against
 * silent regression. Runs the REAL site/vm runtime (interpreter + stdlib +
 * snapshot store) with faithful fake backend payloads — no DOM, no network.
 *
 * Run:  bash site/vm/tests/run.sh     (copies vm to a temp ESM dir and runs)
 * Exit code 0 = all guards pass; non-zero = a regression was reintroduced.
 *
 * Each assertion names the bug it protects so a failure points straight at it.
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

const SEC = { bank_code_set:true, firewall_level:0, breached:false, active_security:"firewall_3", security_scripts_count:3 };
const ME = { available:true, item:{ user_id:"1", level:57, prestige:2, coins:7958921, bank:4000000, networth:11958921,
  inventory_count:2, items:[{name:"hackbank",quantity:1},{name:"USB Killer",quantity:1}],
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

(async()=>{
  console.log("Phase 4.5B regression suite\n");

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
