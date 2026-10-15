const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {chromium}=require('playwright');
async function main(){
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const assets=path.resolve(__dirname,'../app/src/main/assets/www');
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('http://auth.test/**',route=>{
      const file=new URL(route.request().url()).pathname.slice(1);
      return route.fulfill(file?{contentType:'image/png',body:fs.readFileSync(path.join(assets,file))}:{contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div>'});
    });
    await page.goto('http://auth.test/');
    await page.addStyleTag({path:path.join(assets,'styles.css')});
    await page.addScriptTag({content:fs.readFileSync(path.join(assets,'app.js'),'utf8').replace('init();','')});
    await page.evaluate(()=>{state.session=null;render();});
    assert.equal(await page.locator('#setupForm').isVisible(),false);
    assert.equal(await page.locator('#parentLoginForm').isVisible(),true);
    assert.equal(await page.locator('#kidLoginForm').isVisible(),true);
    await page.locator('#parentLoginForm [name=email]').fill('parent@example.com');
    await page.locator('#toggleSignup').click();
    assert.equal(await page.locator('#toggleSignup').getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('#setupForm').isVisible(),true);
    assert.equal(await page.locator('#parentLoginForm [name=email]').inputValue(),'parent@example.com');
    assert.equal(await page.evaluate(()=>document.activeElement.name),'signup_email');
    await page.locator('#setupForm [name=signup_email]').fill('new@example.com');
    await page.locator('#setupForm [name=signup_password]').fill('password123');
    await page.evaluate(()=>{authSignUp=async()=>{throw new Error('Email rate limit exceeded');};});
    await page.locator('#setupForm button').click();
    await page.getByText('Email rate limit exceeded',{exact:true}).waitFor();
    assert.equal(await page.locator('#setupForm').isVisible(),true);
    await page.locator('#toggleSignup').click();
    assert.equal(await page.locator('#setupForm').isVisible(),false);
    await page.locator('#toggleSignup').focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('#setupForm').isVisible(),true);
    await page.locator('#toggleSignup').click();
    for(const width of [390,1280]){
      await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:path.join(os.tmpdir(),`mykidstask-login-${width}.png`),fullPage:true});
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: sign-up hidden by default, click/keyboard toggle, focus, login field preservation, error recovery, and mobile/desktop layout.');
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
