const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {PGlite}=require('@electric-sql/pglite');
const {chromium}=require('playwright');
async function main(){
  const db=new PGlite(),browser=await chromium.launch({channel:'msedge',headless:true});
  const sql=path.resolve(__dirname,'../../supabase'),assets=path.resolve(__dirname,'../app/src/main/assets/www');
  const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const owner=uid(1),other=uid(2),tutor=uid(3),family=uid(4),child=uid(5),secondChild=uid(6),mission=uid(7),oldTask=uid(8),task=uid(9),secondTask=uid(10);
  const as=async(id,role='authenticated')=>{await db.exec(`reset role;set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);};
  let queue=Promise.resolve();const errors=[];
  try{
    await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
    await db.exec(fs.readFileSync(path.join(sql,'missionnest_mobile.sql'),'utf8').replace('create extension if not exists pgcrypto;',''));
    await db.query("insert into auth.users values($1,'owner@test.local'),($2,'other@test.local'),($3,'tutor@test.local')",[owner,other,tutor]);
    await db.query("insert into mn_families(id,owner_user_id,name,family_code) values($1,$2,'Stars Family','STARS')",[family,owner]);
    await db.query("insert into mn_children(id,family_id,display_name,stars) values($1,$2,'Xilia',100),($3,$2,'Second Child',0)",[child,family,secondChild]);
    await db.query("insert into mn_adults(family_id,user_id,display_name,role) values($1,$2,'Tutor','tutor')",[family,tutor]);
    await db.query("insert into mn_missions(id,family_id,title,reward_stars) values($1,$2,'Practice',25)",[mission,family]);
    await db.query("insert into mn_assignments(id,family_id,mission_id,child_id,status,approved_at) values($1,$2,$3,$4,'approved',now()-interval '1 day')",[oldTask,family,mission,child]);
    // Different missions satisfy the existing unique assignment constraint.
    const mission2=uid(11),mission3=uid(12);
    await db.query("insert into mn_missions(id,family_id,title,reward_stars) values($1,$2,'Quiz',50),($3,$2,'Another Mission',10)",[mission2,family,mission3]);
    await db.query("insert into mn_assignments(id,family_id,mission_id,child_id,status) values($1,$2,$3,$4,'submitted'),($5,$2,$6,$4,'submitted')",[task,family,mission2,child,secondTask,mission3]);
    for(const file of ['family_invitations.sql','direct_invitations_and_tutors.sql','tutor_work_ownership.sql','subscriptions.sql','star_history.sql','star_history.sql'])await db.exec(fs.readFileSync(path.join(sql,file),'utf8'));
    await as(owner);
    assert.equal((await db.query('select stars from mn_children where id=$1',[child])).rows[0].stars,100);
    assert.equal((await db.query('select * from mn_star_events')).rows.length,1);
    await db.query('select mn_approve_assignment($1)',[task]);await db.query('select mn_approve_assignment($1)',[task]);
    assert.equal((await db.query('select stars from mn_children where id=$1',[child])).rows[0].stars,150);
    assert.equal((await db.query("select * from mn_star_events where kind='award'")).rows.length,2);
    await assert.rejects(()=>db.query('update mn_children set stars=999 where id=$1',[child]),/approval or reset/);
    await as(other);assert.equal((await db.query('select * from mn_star_events')).rows.length,0);
    await assert.rejects(()=>db.query('select mn_reset_child_stars($1)',[child]),/Parent access/);
    await as(tutor);assert.equal((await db.query('select * from mn_star_events')).rows.length,0);
    await assert.rejects(()=>db.query('select mn_approve_assignment($1)',[secondTask]),/Parent access/);
    await assert.rejects(()=>db.query('select mn_reset_child_stars($1)',[child]),/Parent access/);
    await as(null,'anon');await assert.rejects(()=>db.query('select * from mn_star_events'),/permission denied/);
    await assert.rejects(()=>db.query('select mn_reset_child_stars($1)',[child]),/permission denied/);
    await assert.rejects(()=>db.query('update mn_children set stars=0 where id=$1',[child]),/approval or reset/);
    await assert.rejects(()=>db.query("update mn_assignments set status='approved' where id=$1",[secondTask]),/Only a parent/);
    await as(owner);
    await db.query('select mn_reset_child_stars($1)',[child]);await db.query('select mn_reset_child_stars($1)',[child]);
    assert.equal((await db.query('select stars from mn_children where id=$1',[child])).rows[0].stars,0);
    assert.equal((await db.query("select * from mn_star_events where kind='reset'")).rows.length,1);
    assert.equal((await db.query("select sum(amount) total from mn_star_events where kind='award'")).rows[0].total,75);
    await db.query('select mn_approve_assignment($1)',[secondTask]);
    assert.equal((await db.query('select stars from mn_children where id=$1',[child])).rows[0].stars,10);
    await db.query('delete from mn_assignments where id=$1',[task]);
    assert.equal((await db.query("select sum(amount) total from mn_star_events where kind='award'")).rows[0].total,85);
    await assert.rejects(()=>db.query("insert into mn_star_events(family_id,child_id,kind,amount) values($1,$2,'reset',0)",[family,child]),/permission denied/);
    const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));
    await page.route('http://stars.test/**',route=>new URL(route.request().url()).pathname==='/app-icon.png'?route.fulfill({contentType:'image/png',body:fs.readFileSync(path.join(assets,'app-icon.png'))}):route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div>'}));
    await page.route('**/rest/v1/**',route=>{
      queue=queue.then(async()=>{
        try{
          await as(owner);const request=route.request(),url=new URL(request.url()),endpoint=url.pathname.replace('/rest/v1/','');let result;
          if(endpoint==='rpc/mn_reset_child_stars'){
            await db.query('select mn_reset_child_stars($1)',[request.postDataJSON().p_child_id]);result=null;
          }else{
            assert.equal(endpoint,'mn_star_events');const query=url.searchParams;
            const dates=query.getAll('created_at');
            result=(await db.query("select * from mn_star_events where family_id=$1 and child_id=$2 and kind='award' and created_at>=$3 and created_at<$4 order by created_at,id limit 500 offset $5",[query.get('family_id').slice(3),query.get('child_id').slice(3),dates.find(d=>d.startsWith('gte.')).slice(4),dates.find(d=>d.startsWith('lt.')).slice(3),Number(query.get('offset'))])).rows;
          }
          await route.fulfill({json:result});
        }catch(e){await route.fulfill({status:400,json:{message:e.message}});}
      });return queue;
    });
    await page.goto('http://stars.test/');for(const file of ['styles.css','stars.css'])await page.addStyleTag({path:path.join(assets,file)});
    for(const file of ['billing.js','stars.js'])await page.addScriptTag({content:fs.readFileSync(path.join(assets,file),'utf8')});
    await page.addScriptTag({content:fs.readFileSync(path.join(assets,'app.js'),'utf8').replace('init();','')});
    const children=(await db.query('select * from mn_children order by display_name')).rows;
    await page.evaluate(({family,owner,children,child})=>{
      state.session={mode:'parent',userId:owner};state.family={id:family,name:'Stars Family'};state.children=children;state.view='kids';render();
      // Keep refresh local; network and SQL mutations still use the real RPC adapter.
      refreshData=async()=>{state.children.find(c=>c.id===child).stars=0;render();};
    },{family,owner,children,child});
    await page.locator('.kid-tile-card').filter({hasText:'Xilia'}).locator('summary').click();
    await page.locator(`[data-star-stats="${child}"]`).click();
    await page.locator('.star-bars li').first().waitFor();assert.equal(await page.locator('.star-bars li').count(),7);
    const weekSum=await page.locator('.star-bars li>strong').allTextContents();assert(weekSum.map(Number).reduce((a,b)=>a+b,0)>=10);
    await page.locator('[data-star-period=month]').click();await page.locator('.star-bars-month li').first().waitFor();
    assert.equal((await page.locator('.star-bars li>strong').allTextContents()).map(Number).reduce((a,b)=>a+b,0),85);
    for(const width of [390,1280]){
      await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:path.join(os.tmpdir(),`mykidstask-stars-${width}.png`),fullPage:true});
    }
    await page.locator('#starStatsChild').selectOption(secondChild);await page.getByText('No stars earned during this period.',{exact:true}).waitFor();
    await page.locator('#starStatsChild').selectOption(child);await page.locator('.star-bars li').first().waitFor();
    page.once('dialog',dialog=>dialog.dismiss());await page.locator('[data-reset-stars]').click();assert.equal((await db.query('select stars from mn_children where id=$1',[child])).rows[0].stars,10);
    page.once('dialog',dialog=>dialog.accept());await page.locator('[data-reset-stars]').click();
    await page.waitForFunction(()=>state.children.some(c=>c.display_name==='Xilia'&&c.stars===0));
    await page.locator('.star-bars li').first().waitFor();assert.equal((await page.locator('.star-bars li>strong').allTextContents()).map(Number).reduce((a,b)=>a+b,0),85);
    await page.locator('[data-star-shift="-1"]').click();await page.getByText('No stars earned during this period.',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    // Reset is also blocked when the family's subscription expires.
    await queue;await db.exec('reset role');await db.query("update mn_subscriptions set status='suspended' where family_id=$1",[family]);await as(owner);
    assert.equal((await db.query('select * from mn_star_events')).rows.length,0);
    await assert.rejects(()=>db.query('select mn_reset_child_stars($1)',[child]),/Parent access/);
    console.log('PASS: legacy backfill, atomic/idempotent rewards, balance protection, parent-only reset, preserved history after reset/deletion, subscription gates, weekly/monthly graphs, child switching, cancel/confirm and responsive screenshots.');
  }finally{await browser.close();await db.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
