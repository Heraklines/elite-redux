import puppeteer from "puppeteer";
const b = await puppeteer.launch({ headless: true, args: ["--no-sandbox","--disable-setuid-sandbox","--autoplay-policy=no-user-gesture-required"], defaultViewport:{width:1280,height:720} });
const p = await b.newPage();
const errors = [];
p.on("pageerror", e => errors.push(`[PAGEERROR] ${e.message}`));
await p.goto("http://localhost:8000/", { waitUntil:"domcontentloaded", timeout:30000 });
await p.waitForFunction(() => document.querySelector("canvas")?.width > 0, { timeout:60000 });
await p.waitForFunction(() => { const s=globalThis.dev?.scene; return s?.gameData!=null && s?.ui?.getHandler?.()!=null && s?.scene?.isActive?.(); }, { timeout:300000, polling:500 });
for (let i=0;i<30;i++){ const h=await p.evaluate(()=>globalThis.dev.scene.ui.getHandler()?.constructor?.name); if(h==="TitleUiHandler")break; await p.keyboard.press("Enter"); await new Promise(r=>setTimeout(r,400)); }
// Grant Bulbasaur full caught + passives unlocked so the panel is fully populated.
await p.evaluate(()=>{
  const s=globalThis.dev.scene;
  const id=1; // Bulbasaur
  const DexAttr = 0xFFFFFFn;
  s.gameData.dexData[id].seenAttr = DexAttr; s.gameData.dexData[id].caughtAttr = DexAttr;
  if (s.gameData.starterData[id]) { s.gameData.starterData[id].passiveAttr = 0b010101; s.gameData.starterData[id].candyCount = 99; }
});
await p.evaluate(()=>{ globalThis.dev.scene.enableTutorials=false; globalThis.dev.starterSelect(); });
await new Promise(r=>setTimeout(r,1500));
// Dismiss tutorial message box.
for(let k=0;k<6;k++){ await p.keyboard.press("Backspace"); await new Promise(r=>setTimeout(r,250)); }
// Move into grid (down) to focus Bulbasaur and populate the panel.
await p.keyboard.press("ArrowDown"); await new Promise(r=>setTimeout(r,800));
await p.screenshot({ path:"scripts/dbg-starter.png" });
// Inspect instruction container bounds.
const info = await p.evaluate(()=>{
  const h=globalThis.dev.scene.ui.getHandler();
  const ic = h.instructionsContainer;
  const kids = ic?.list?.length;
  return { handler:h?.constructor?.name, lastSpecies:h?.lastSpecies?.name, instrY: ic?.y, instrChildren: kids, instrVisible: ic?.visible };
});
console.log("state:", JSON.stringify(info));
console.log(`pageerrors: ${errors.length}`); errors.slice(0,3).forEach(e=>console.log(e));
await b.close();
