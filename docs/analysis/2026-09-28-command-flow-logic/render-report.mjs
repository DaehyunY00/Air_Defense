// 지휘흐름 모의논리서 — HTML을 A4 PDF로 렌더링한다. 본문은 자연 흐름(고정 쪽 없음)이고, 쪽 번호는 Playwright 꼬리말 템플릿으로 찍는다.
// Reuses installed Playwright + Chrome. CHROME_PATH / PLAYWRIGHT_MODULE_DIR may override discovery.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const HERE=path.dirname(fileURLToPath(import.meta.url)),ROOT=path.resolve(HERE,'../../..');
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
const outputs=[['report.html','K-JAMDS_지휘흐름_모의논리서.pdf']];
const DATE='2026-09-28';
const browser=await chromium.launch({headless:true,executablePath});
const audits=[];
try {
  for(const [source,name]of outputs){
    const page=await browser.newPage({viewport:{width:1000,height:1200}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(path.join(HERE,source)).href);
    await page.emulateMedia({media:'print'});
    await page.evaluate(()=>document.fonts.ready);
    const overflow=await page.evaluate(()=>[...document.querySelectorAll('table,.diagram')].filter(e=>e.scrollWidth>e.clientWidth+1).length);
    if(errors.length)throw new Error(errors.join('\n'));
    if(overflow)throw new Error('Horizontal overflow in '+overflow+' block(s) of '+source);
    const out=path.join(ROOT,name);
    await page.pdf({path:out,printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,
      headerTemplate:'<div></div>',
      footerTemplate:`<div style="width:100%;font-size:7.5pt;color:#66737f;font-family:'Apple SD Gothic Neo','Noto Sans KR',sans-serif;padding:0 15mm;display:flex;justify-content:space-between;border-top:1px solid #cfd8e0;padding-top:4px;margin:0 15mm"><span>지휘흐름 모의논리서 | ${DATE}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`});
    const info=execFileSync('pdfinfo',[out],{encoding:'utf8'});
    const pages=Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
    audits.push({html:source,pdf:name,pages,errors,renderedAt:new Date().toISOString()});
    console.log('rendered',name,'pages',pages);
    await page.close();
  }
} finally {await browser.close();}
fs.writeFileSync(path.join(HERE,'render-qa.json'),JSON.stringify(audits,null,2));
