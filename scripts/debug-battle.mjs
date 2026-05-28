import puppeteer from "puppeteer";
const b = await puppeteer.launch({ headless: true, args: ["--no-sandbox","--disable-setuid-sandbox","--autoplay-policy=no-user-gesture-required"], defaultViewport:{width:1280,height:720} });
const p = await b.newPage();
const errors = [];
p.on("pageerror", e => errors.push(`[PAGEERROR] ${e.message}\n${e.stack}`));
await p.goto("http://localhost:8000/", { waitUntil:"domcontentloaded", timeout:30000 });
await p.waitForFunction(() => document.querySelector("canvas")?.width > 0, { timeout:60000 });
await p.waitForFunction(() => { const s=globalThis.dev?.scene; return s?.gameData!=null && s?.ui?.getHandler?.()!=null && s?.scene?.isActive?.(); }, { timeout:300000, polling:500 });
console.log("scene ready");
// Press Enter through welcome messages + gender select until at TitleUiHandler.
let atTitle = false;
for (let i=0;i<30;i++){
  const h = await p.evaluate(()=>globalThis.dev.scene.ui.getHandler()?.constructor?.name);
  if (h === "TitleUiHandler") { atTitle = true; break; }
  await p.keyboard.press("Enter");
  await new Promise(r=>setTimeout(r,400));
}
console.log("reached title:", atTitle);
await p.evaluate(() => { globalThis.dev.battle({ player:["BOUFFALANT"], enemy:"ABOMASNOW", enemyLevel:50, level:50 }); });
let phase = null;
for (let i=0;i<45;i++){
  await new Promise(r=>setTimeout(r,1000));
  phase = await p.evaluate(()=>{ const s=globalThis.dev.scene; return { current: s.phaseManager?.getCurrentPhase?.()?.phaseName, handler: s.ui?.getHandler?.()?.constructor?.name, party: s.getPlayerParty?.().map(x=>x.name), enemy: s.getEnemyParty?.().map(x=>({n:x.name,lv:x.level,ability:x.getAbility?.()?.name})) }; });
  // Advance any message prompts by pressing Enter.
  if (phase.handler === "BattleMessageUiHandler") await p.keyboard.press("Enter");
  if (phase.handler === "CommandUiHandler" || phase.current === "CommandPhase") break;
}
console.log("battle state:", JSON.stringify(phase, null, 2));
await p.screenshot({ path:"scripts/dbg-battle.png" });
console.log(`pageerrors: ${errors.length}`); errors.slice(0,3).forEach(e=>console.log(e.slice(0,1200)));
await b.close();
