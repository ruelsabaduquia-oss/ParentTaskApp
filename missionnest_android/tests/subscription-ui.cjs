const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {PGlite}=require('@electric-sql/pglite');
const {chromium}=require('playwright');
async function main(){
  const db=new PGlite(),browser=await chromium.launch({channel:'msedge',headless:true});
  const assets=path.resolve(__dirname,'../app/src/main/assets/www'),sql=path.resolve(__dirname,'../../supabase');
  const admin='00000000-0000-4000-8000-000000000001',owner='00000000-0000-4000-8000-000000000002';
  const errors=[];let queue=Promise.resolve();
  try{
    await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
    await db.exec(fs.readFileSync(path.join(sql,'missionnest_mobile.sql'),'utf8').replace('create extension if not exists pgcrypto;',''));
    await db.query('insert into auth.users values($1,$2),($3,$4)',[admin,'ruelsabaduquia@gmail.com',owner,'mom@test.local']);
    for(const file of ['family_invitations.sql','direct_invitations_and_tutors.sql','tutor_work_ownership.sql','subscriptions.sql','subscription_admin_setup.sql'])await db.exec(fs.readFileSync(path.join(sql,file),'utf8'));
    async function pageFor(isAdmin){
      const context=await browser.newContext({viewport:{width:768,height:1024}}),page=await context.newPage();
      page.on('pageerror',e=>errors.push(e.message));
      await context.addInitScript(({admin,owner,isAdmin})=>{
        if(!isAdmin)localStorage.setItem('missionnest_mobile_session_v1',JSON.stringify({mode:'parent',userId:owner,accessToken:owner}));
      },{admin,owner,isAdmin});
      await page.route('http://billing.test/**',route=>{
        const file=new URL(route.request().url()).pathname.slice(1)||'index.html';assert(/^[a-z.-]+$/.test(file));
        return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(path.join(assets,file),'utf8')});
      });
      await page.route('https://nzgdfygljemhapabbsnf.supabase.co/**',route=>{
        queue=queue.then(async()=>{
          try{
            const request=route.request(),url=new URL(request.url());
            if(url.pathname.startsWith('/auth/v1/token')){
              return route.fulfill({json:{access_token:admin,refresh_token:'refresh',user:{id:admin,email:'ruelsabaduquia@gmail.com'}}});
            }
            const id=(request.headers().authorization||'').replace('Bearer ','');
            assert([admin,owner].includes(id));
            await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
            const endpoint=url.pathname.replace('/rest/v1/','');let result;
            if(endpoint.startsWith('rpc/')){
              const name=endpoint.slice(4),args=request.postDataJSON()||{};
              assert(/^mn_[a-z_]+$/.test(name));assert(Object.keys(args).every(k=>/^p_[a-z_]+$/.test(k)));
              const rows=(await db.query(`select * from ${name}(${Object.keys(args).map((key,i)=>`${key}=>$${i+1}`).join(',')})`,Object.values(args))).rows;
              result=['mn_list_my_families','mn_my_family_invitations','mn_tutor_children'].includes(name)?rows:rows[0]?.[name]??null;
            }else{
              assert(/^mn_[a-z_]+$/.test(endpoint));const conditions=[],values=[];let order='',limit='';
              for(const [key,value]of url.searchParams){
                if(key==='order'){const [column,direction]=value.split('.');assert(/^[a-z_]+$/.test(column)&&['asc','desc'].includes(direction));order=` order by ${column} ${direction}`;}
                else if(key==='limit')limit=` limit ${Number(value)}`;
                else{assert(/^[a-z_]+$/.test(key));if(value==='is.null')conditions.push(`${key} is null`);else{const op=value.slice(0,3);assert(['eq.','gt.'].includes(op));values.push(value.slice(3));conditions.push(`${key}${op==='eq.'?'=':'>'}$${values.length}`);}}
              }
              result=(await db.query(`select * from ${endpoint}${conditions.length?' where '+conditions.join(' and '):''}${order}${limit}`,values)).rows;
            }
            await route.fulfill({json:result});
          }catch(error){await route.fulfill({status:400,json:{message:error.message}});}
        });return queue;
      });
      await page.goto('http://billing.test/'+(isAdmin?'admin.html':''));return page;
    }
    const mom=await pageFor(false);
    await mom.locator('#familySetupForm').waitFor();
    await mom.locator('#familySetupForm [name=family_name]').fill('Test Family');await mom.locator('#familySetupForm [name=parent_name]').fill('Mom');await mom.locator('#familySetupForm [name=child_name]').fill('Child');await mom.locator('#familySetupForm [name=kid_pin]').fill('1234');
    await mom.locator('#familySetupForm button').click();
    await mom.getByText('Awaiting activation',{exact:true}).waitFor();
    assert.equal(await mom.locator('.tabs').count(),0);
    const family=await mom.evaluate(()=>state.family.id);
    const staff=await pageFor(true);
    await staff.locator('#adminEmail').fill('ruelsabaduquia@gmail.com');await staff.locator('#adminPassword').fill('testpassword');await staff.locator('#adminLogin button').click();
    await staff.locator('[data-family]').waitFor();
    await staff.locator('#adminSettings').click();await staff.locator('#settingName').fill('GCash Name');await staff.locator('#price-monthly').fill('100');await staff.locator('#price-quarterly').fill('280');await staff.locator('#price-annual').fill('1000');await staff.locator('#settingsForm button').click();
    await staff.getByText('Settings saved.',{exact:true}).waitFor();await staff.locator('[data-close]').click();
    await staff.locator('[data-family]').click();await staff.locator('#ownerMessage').fill('Send PHP 100 to GCash 09995063999.');await staff.locator('#adminMessage button').click();
    await staff.getByText('Notification sent to the family owner.',{exact:true}).waitFor();
    await mom.evaluate(()=>pollSubscription());await mom.locator('#billingNotification').waitFor();await mom.locator('#billingNotification button').click();
    await mom.locator('#gcashReference').fill('GCASH123456789');await mom.locator('#paymentAmount').fill('100');await mom.locator('#subscriptionPaymentForm button').click();
    await mom.getByText('Your payment is awaiting manual verification.',{exact:true}).waitFor();
    await staff.locator('[data-close]').click();await staff.locator('#adminRefresh').click();await staff.locator('[data-family]').click();
    staff.on('dialog',d=>d.accept());await staff.locator('[data-approve]').click();
    await staff.waitForFunction(()=>document.querySelector('dialog')?.textContent.includes('Verified') || !document.querySelector('[data-approve]'));
    await mom.evaluate(()=>pollSubscription());await mom.locator('.tabs').waitFor();
    assert.equal(await mom.evaluate(()=>state.children.length),1);
    // Upcoming expiry reminder survives a parent page refresh and links to renewal.
    await queue;await db.exec('reset role');await db.query("update mn_subscriptions set expires_at=now()+interval '4 days' where family_id=$1",[family]);
    await mom.evaluate(()=>pollSubscription());await mom.locator('#subscriptionReminder').waitFor();await mom.locator('[data-renew]').click();await mom.locator('#subscriptionPaymentForm').waitFor();
    assert.equal(await mom.locator('#subscriptionReminder').count(),0);
    await mom.setViewportSize({width:390,height:844});assert(await mom.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await mom.screenshot({path:path.join(os.tmpdir(),'missionnest-subscription-owner.png'),fullPage:true});
    await staff.locator('[data-close]').click();await staff.setViewportSize({width:390,height:844});
    assert(await staff.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await staff.screenshot({path:path.join(os.tmpdir(),'missionnest-admin-mobile.png'),fullPage:true});
    await staff.setViewportSize({width:1280,height:900});await staff.screenshot({path:path.join(os.tmpdir(),'missionnest-admin-desktop.png'),fullPage:true});
    await queue;await db.exec('reset role');await db.query("update mn_subscriptions set expires_at=now()-interval '1 second' where family_id=$1",[family]);
    await mom.evaluate(()=>pollSubscription());await mom.getByText('Access suspended',{exact:true}).waitFor();assert.equal(await mom.locator('.tabs').count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS: Browser + PostgreSQL family request, admin login/settings/notification, payment, approval, activation, expiry reminder, renewal route, automatic suspension, desktop/mobile screenshots.');
  }finally{await browser.close();await db.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
