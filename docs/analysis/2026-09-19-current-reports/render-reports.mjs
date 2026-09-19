// Reuses installed Playwright + Chrome. CHROME_PATH / PLAYWRIGHT_MODULE_DIR may override discovery.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HERE, ROOT } from './report-common.mjs';
const localRequire=createRequire(import.meta.url);
let chromium;
try { ({chromium}=localRequire('playwright')); }
catch {
  const moduleDir=process.env.PLAYWRIGHT_MODULE_DIR||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node');
  ({chromium}=createRequire(path.join(moduleDir,'package.json'))('playwright'));
}
const executablePath=process.env.CHROME_PATH||[
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'
].find(p=>fs.existsSync(p));
if(!executablePath)throw new Error('Chrome unavailable; set CHROME_PATH');
// One integrated document since 2026-09-19 (the separate C2 report was merged into it).
const outputs=[['report.html','K-JAMDS_분석_방법과_결과.pdf']];
const selected=outputs;
const browser=await chromium.launch({headless:true,executablePath});
const audits=[];
try {
  for(const [source,name]of selected){
    const page=await browser.newPage({viewport:{width:1000,height:1200}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(path.join(HERE,source)).href);
    await page.emulateMedia({media:'print'});
    await page.evaluate(()=>document.fonts.ready);
    const layout=await page.evaluate(()=>[...document.querySelectorAll('.page')].map((section,index)=>{
      const box=section.getBoundingClientRect(),footer=section.querySelector('.footer')?.getBoundingClientRect();
      const content=[...section.children].filter(e=>!e.classList.contains('footer')).map(e=>e.getBoundingClientRect());
      return {page:index+1,height:box.height,contentBottom:Math.max(...content.map(r=>r.bottom))-box.top,
        footerTop:footer?footer.top-box.top:null,overflowX:section.scrollWidth-section.clientWidth,
        overlapsFooter:footer?content.some(r=>r.bottom>footer.top-3):null};
    }));
    if(errors.length)throw new Error(errors.join('\n'));
    if(layout.some(p=>p.overlapsFooter||p.overflowX>1))throw new Error('Layout overflow '+source+': '+JSON.stringify(layout));
    await page.pdf({path:path.join(ROOT,name),printBackground:true,preferCSSPageSize:true});
    audits.push({html:source,pdf:name,pages:layout,errors});
    console.log('rendered',name,'layout pages',layout.length);
    await page.close();
  }
} finally {await browser.close();}
const auditPath=path.join(HERE,'render-qa.json');
const prior=fs.existsSync(auditPath)?JSON.parse(fs.readFileSync(auditPath,'utf8')):[];
// Drop audits of documents that are no longer produced.
const merged=[...prior.filter(p=>outputs.some(o=>o[1]===p.pdf)&&!audits.some(a=>a.pdf===p.pdf)),...audits];
fs.writeFileSync(auditPath,JSON.stringify(merged,null,2));
