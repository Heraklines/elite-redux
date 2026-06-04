import puppeteer from "puppeteer";
const b = await puppeteer.launch({ headless: true, args: ["--no-sandbox","--disable-setuid-sandbox","--autoplay-policy=no-user-gesture-required"], defaultViewport:{width:1280,height:720} });
const p = await b.newPage(); const errors=[]; p.on("pageerror",e=>errors.push(`[PAGEERROR] ${e.message}\n${e.stack}`));
await p.goto("http://localhost:8000/", {waitUntil:"domcontentloaded",timeout:30000});
await p.waitForFunction(()=>document.querySelector("canvas")?.width>0,{timeout:60000});
await p.waitForFunction(()=>{const s=globalThis.dev?.scene;return s?.gameData!=null&&s?.ui?.getHandler?.()!=null&&s?.scene?.isActive?.();},{timeout:300000,polling:500});
for(let i=0;i<30;i++){const h=await p.evaluate(()=>globalThis.dev.scene.ui.getHandler()?.constructor?.name);if(h==="TitleUiHandler")break;await p.keyboard.press("Enter");await new Promise(r=>setTimeout(r,400));}
await p.evaluate(()=>{globalThis.dev.scene.enableTutorials=false;globalThis.dev.battle({player:["BOUFFALANT"],enemy:"ABOMASNOW",enemyLevel:50,level:50});});
let onCmd=false;
for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,1000));const h=await p.evaluate(()=>globalThis.dev.scene.ui.getHandler()?.constructor?.name);if(h==="CommandUiHandler"){onCmd=true;break;}if(h==="BattleMessageUiHandler")await p.keyboard.press("Enter");}
console.log("on command menu:",onCmd);
// Fire STATS (Button.STATS = 8) to open enemy inspect.
const opened = await p.evaluate(()=>{ const h=globalThis.dev.scene.ui.getHandler(); h.processInput(8); return h.enemyInspectContainer!=null; });
console.log("inspect opened:",opened);
await new Promise(r=>setTimeout(r,600));
await p.screenshot({path:"scripts/dbg-inspect.png"});
// Any input closes it.
const closed = await p.evaluate(()=>{ const h=globalThis.dev.scene.ui.getHandler(); h.processInput(6); return h.enemyInspectContainer==null && h.constructor.name==="CommandUiHandler"; });
console.log("closed cleanly, still on command:",closed);
console.log(`pageerrors: ${errors.length}`);errors.slice(0,3).forEach(e=>console.log(e.slice(0,1000)));
await b.close();
