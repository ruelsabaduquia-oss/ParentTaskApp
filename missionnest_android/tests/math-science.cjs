const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {chromium}=require('playwright');
async function main(){
  const assets=path.resolve(__dirname,'../app/src/main/assets/www');
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:768,height:1024}}),errors=[],failedFonts=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>{if(r.url().includes('/fonts/'))failedFonts.push(r.url());});
    await page.route('http://math.test/**',route=>{
      const file=new URL(route.request().url()).pathname.slice(1);
      if(!file)return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div>'});
      assert(!file.includes('..'));
      return route.fulfill({contentType:file.endsWith('.woff2')?'font/woff2':file.endsWith('.css')?'text/css':'application/javascript',body:fs.readFileSync(path.join(assets,file))});
    });
    await page.goto('http://math.test/');
    for(const file of ['styles.css','vendor/katex/katex.min.css','math.css'])await page.addStyleTag({url:'http://math.test/'+file});
    for(const file of ['vendor/katex/katex.min.js','vendor/katex/contrib/mhchem.min.js','vendor/katex/contrib/auto-render.min.js','math.js','billing.js'])await page.addScriptTag({url:'http://math.test/'+file});
    await page.addScriptTag({content:fs.readFileSync(path.join(assets,'app.js'),'utf8').replace('init();','')});
    const checks=await page.evaluate(()=>{
      const sum=String.raw`\(\sum_{n=1}^{10} n^2\)`,chem=String.raw`\(\ce{2H2 + O2 -> 2H2O}\)`;
      const pasted=parseQuiz(`**1. Evaluate ${sum}.**\nA) 385\nB) 100\nAnswer: A\n\n2. Choose ${chem}.\nA) ${String.raw`\(x*y+z_1\)`}\nB) None\nAnswer: A`);
      return {count:pasted.length,sum:pasted[0].prompt,chem:pasted[1].prompt,choice:pasted[1].choices[0].text,
        csv:cleanQuizText(String.raw`Value \(x*y+z_1\)`),multiply:cleanQuizText('2 * 3'),
        correct:answersMatch('CO',String.raw`\(\ce{CO}\)`),wrong:answersMatch('Co',String.raw`\(\ce{CO}\)`),
        formula:answersMatch(String.raw`\frac{1}{2}`,String.raw`\(\frac{1}{2}\)`),plain:answersMatch(' keyboard ','Keyboard')};
    });
    assert.equal(checks.count,2);assert(checks.sum.includes(String.raw`\sum_{n=1}^{10}`));assert(checks.chem.includes(String.raw`\ce{2H2 + O2 -> 2H2O}`));assert(checks.choice.includes('x*y+z_1'));assert(checks.csv.includes('x*y+z_1'));assert.equal(checks.multiply,'2 * 3');assert(checks.correct&&checks.formula&&checks.plain&&!checks.wrong);
    await page.evaluate(()=>{
      state.session={mode:'parent',userId:'parent'};state.family={id:'family',name:'Test Family'};state.children=[{id:'kid',display_name:'Test Child'}];state.view='quiz';render();
    });
    await page.locator('[name=mc_source][value=manual]').check();await page.locator('[name=mc_question]').fill('Calculate ');
    await page.locator('.equation-editor summary').click();
    for(const preset of ['fraction','sum','algebra','integral','derivative','limit','physics','units','chemistry','ion']){
      await page.locator('#equationTemplate').selectOption(preset);assert.equal(await page.locator('#equationPreview .katex-error').count(),0,preset);assert.equal(await page.locator('#equationPreview .katex').count(),1,preset);
    }
    await page.locator('#equationTemplate').selectOption('sum');await page.locator('#insertEquation').click();
    assert((await page.locator('[name=mc_question]').inputValue()).includes(String.raw`\sum_{n=1}^{10}`));
    await page.locator('[name=mc_choice_A]').fill(String.raw`\(\frac{1}{2}\)`);await page.locator('[name=mc_choice_B]').fill(String.raw`\(\ce{H2O}\)`);await page.locator('[name=mc_answer]').selectOption('B');
    await page.locator('button[value=preview]').click();assert.equal(await page.locator('.answer .katex').count(),2);
    assert.equal(await page.locator('h1 .katex').count(),1);
    await page.locator('#backToQuizBtn').click();assert((await page.locator('[name=mc_question]').inputValue()).includes('sum'));
    // CSV and manual entry preserve delimiters and literal operators.
    const csv=String.raw`Question,Choice A,Choice B,Choice C,Choice D,Answer Key,Explanation
"Evaluate \(\int_0^1 x^2 dx\)","\(\frac{1}{3}\)","\(\frac{1}{2}\)",0,1,A,"Use \(x^3/3\)"`;
    await page.locator('[name=mc_source][value=csv]').check();await page.locator('#mcCsvFile').setInputFiles({name:'calculus.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.locator('button[value=preview]').click();
    await page.locator('#backToQuizBtn').waitFor();
    assert.equal(await page.locator('h1 .katex').count(),1);
    const questions=[
      [String.raw`Evaluate \(\sum_{n=1}^{10} n^2\).`,'385'],
      [String.raw`Find \(\lim_{x\to 0}\frac{\sin x}{x}\).`,'1'],
      [String.raw`Differentiate \(\frac{d}{dx} x^2\).`,'2x'],
      [String.raw`Identify the product: \[\ce{2H2 + O2 -> 2H2O}\]`,String.raw`\(\ce{H2O}\)`],
      [String.raw`Use \(\vec{F}=m\vec{a}\), with \(a=9.8\,\mathrm{m/s^2}\).`,'Force'],
    ];
    await page.evaluate(questions=>{
      state.previewQuiz=null;state.session.mode='kid';state.quizStep=0;state.quizAnswers={};
      state.missions=[{id:'mission',title:'Math & Science'}];state.selectedQuiz={assignment:{id:'assignment',child_id:'kid',mission_id:'mission'},questions:questions.map(([prompt,answer],i)=>({id:String(i),prompt,answer,choices:[],explanation:'fill_blank'})),startedAt:Date.now(),timeLimitSeconds:0};renderQuiz();
    },questions);
    for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
      await page.setViewportSize(viewport);await page.evaluate(()=>document.fonts.ready);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.locator('.katex-error').count(),0);
      await page.screenshot({path:path.join(os.tmpdir(),`missionnest-math-${viewport.width}.png`),fullPage:true});
    }
    await page.evaluate(()=>{
      state.selectedQuiz.questions=[{id:'flash',prompt:String.raw`Name \(\ce{H2O}\).`,choices:[],answer:'Water',explanation:'flash_card'}];renderQuiz();
    });
    assert.equal(await page.locator('.flash-card .katex').count(),1);await page.locator('#typedQuizAnswer').fill('water');await page.locator('#checkFlashBtn').click();await page.getByText('Correct!',{exact:true}).waitFor();
    const security=await page.evaluate(()=>{
      app.innerHTML=quizRichText(String.raw`<img src=x onerror=alert(1)> \(\href{javascript:alert(1)}{click}\) \(\includegraphics{https://evil.invalid/x}\)`);
      return {images:app.querySelectorAll('img').length,links:app.querySelectorAll('a').length,text:app.textContent};
    });
    assert.equal(security.images,0);assert.equal(security.links,0);assert(security.text.includes('<img'));assert.deepEqual(errors,[]);assert.deepEqual(failedFonts,[]);
    console.log('PASS: 10 equation templates, calculus/physics/mhchem rendering, manual insertion, CSV/paste preservation, preview/back, worksheet/flashcard, symbol-case grading, offline fonts, mobile/desktop screenshots and untrusted-input safety.');
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
