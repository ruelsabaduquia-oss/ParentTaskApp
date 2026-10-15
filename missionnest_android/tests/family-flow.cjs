const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { chromium } = require('playwright');

async function main() {
  const db = new PGlite();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const mother = '00000000-0000-4000-8000-000000000001';
  const father = '00000000-0000-4000-8000-000000000002';
  const guardian = '00000000-0000-4000-8000-000000000003';
  const family = '00000000-0000-4000-8000-000000000004';
  const fatherFamily = '00000000-0000-4000-8000-000000000005';
  const sqlRoot = path.resolve(__dirname, '../../supabase');
  const assets = path.resolve(__dirname, '../app/src/main/assets/www');
  const errors = [];
  let queue = Promise.resolve();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to authenticated;`);
    await db.exec(fs.readFileSync(path.join(sqlRoot, 'missionnest_mobile.sql'), 'utf8').replace('create extension if not exists pgcrypto;', ''));
    await db.query('insert into auth.users values($1,$2),($3,$4)', [mother,'mom@example.com',father,'dad@example.com']);
    await db.query('insert into auth.users values($1,$2)', [guardian,'guardian@example.com']);
    await db.query('insert into mn_families(id,owner_user_id,name,family_code) values($1,$2,$3,$4),($5,$6,$7,$8)', [family,mother,'Shared Family','KIDCODE',fatherFamily,father,'Dad Original Family','DADCODE']);
    await db.query("insert into mn_adults(family_id,user_id,display_name,role) values($1,$2,'Mother','owner'),($3,$4,'Father','owner')", [family,mother,fatherFamily,father]);
    await db.query("insert into mn_children(family_id,display_name) values($1,'Child')", [family]);
    await db.exec(fs.readFileSync(path.join(sqlRoot, 'family_invitations.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(sqlRoot, 'direct_invitations_and_tutors.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(sqlRoot, 'tutor_work_ownership.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(sqlRoot, 'subscriptions.sql'), 'utf8'));
    const lessonCategory = (await db.query("insert into mn_categories(family_id,name) values($1,'Lessons') returning id",[family])).rows[0].id;
    const choreCategory = (await db.query("insert into mn_categories(family_id,name) values($1,'House chores') returning id",[family])).rows[0].id;
    await db.query("insert into mn_missions(family_id,category_id,title,instructions) values($1,$2,'Read a story','Read page 1'),($1,$3,'Private chore','Wash dishes')",[family,lessonCategory,choreCategory]);
    await db.query("insert into mn_assignments(family_id,mission_id,child_id) select $1,m.id,c.id from mn_missions m join mn_children c on c.family_id=m.family_id where m.family_id=$1",[family]);

    async function openParent(id) {
      const context = await browser.newContext({ viewport: { width: 768, height: 1024 } });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.route('http://family.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }));
      await page.route('**/rest/v1/**', route => {
        queue = queue.then(async () => {
          let result;
          try {
            await db.exec('reset role; set role authenticated');
            await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
            const url = new URL(route.request().url());
            const endpoint = url.pathname.replace('/rest/v1/', '');
            if (endpoint.startsWith('rpc/')) {
              const body = route.request().postDataJSON();
              const name = endpoint.slice(4);
              const keys = {
                mn_create_parent_invite: ['p_family_id','p_role'],
                mn_request_family_join: ['p_code','p_display_name'],
                mn_decide_family_join: ['p_request_id','p_approve'],
                mn_list_my_families: [],
                mn_my_family_invitations: [],
                mn_set_username: ['p_username'],
                mn_send_family_invitation: ['p_family_id','p_recipient','p_role'],
                mn_respond_family_invitation: ['p_invite_id','p_accept'],
                mn_disconnect_family_member: ['p_adult_id'],
                mn_tutor_children: ['p_family_id'],
                mn_my_subscription: ['p_family_id'],
              }[name];
              assert(keys);
              result = (await db.query(`select * from ${name}(${keys.map((_,i) => `$${i+1}`).join(',')})`, keys.map(key => body[key]))).rows;
              if (['mn_respond_family_invitation','mn_my_subscription'].includes(name)) result = result[0][name];
            } else {
              assert(/^mn_[a-z_]+$/.test(endpoint));
              if (route.request().method() === 'POST') {
                const body = route.request().postDataJSON();
                const columns = Object.keys(body);
                assert(columns.every(key => /^[a-z_]+$/.test(key)));
                result = (await db.query(`insert into ${endpoint}(${columns.join(',')}) values(${columns.map((_,i)=>`$${i+1}`).join(',')}) returning *`, Object.values(body))).rows;
                await route.fulfill({ status: 201, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(result) });
                return;
              }
              const conditions = [], values = [];
              let order = '', limit = '';
              for (const [key, value] of url.searchParams) {
                if (key === 'order') {
                  const [col, direction] = value.split('.');
                  assert(/^[a-z_]+$/.test(col) && ['asc','desc'].includes(direction));
                  order = ` order by ${col} ${direction}`;
                } else if (key === 'limit') { limit = ` limit ${Number(value)}`; }
                else {
                  assert(/^[a-z_]+$/.test(key));
                  if (value === 'is.null') conditions.push(`${key} is null`);
                  else if (value.startsWith('not.in.(')) {
                    const items = value.slice(8,-1).split(',');
                    conditions.push(`${key} not in (${items.map(item => { values.push(item); return `$${values.length}`; }).join(',')})`);
                  }
                  else if (value.startsWith('in.(')) {
                    const ids = value.slice(4,-1).split(',');
                    conditions.push(`${key} in (${ids.map(item => { values.push(item); return `$${values.length}`; }).join(',')})`);
                  } else {
                    const op = value.slice(0,3);
                    assert(['eq.','gt.'].includes(op));
                    values.push(value.slice(3));
                    conditions.push(`${key}${op === 'eq.' ? '=' : '>'}$${values.length}`);
                  }
                }
              }
              result = (await db.query(`select * from ${endpoint}${conditions.length ? ' where '+conditions.join(' and ') : ''}${order}${limit}`, values)).rows;
            }
            await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(result) });
          } catch (error) {
            await route.fulfill({ status: 400, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ message: error.message }) });
          }
        });
        return queue;
      });
      await page.goto('http://family.test/');
      await page.addStyleTag({ path: path.join(assets,'styles.css') });
      await page.addScriptTag({ content: fs.readFileSync(path.join(assets,'billing.js'),'utf8') });
      await page.addScriptTag({ content: fs.readFileSync(path.join(assets,'app.js'),'utf8').replace('init();','') });
      await page.evaluate(async id => {
        state.session = { mode: 'parent', userId: id, accessToken: 'test' };
        await refreshData();
        setView('family');
      }, id);
      return page;
    }

    const mom = await openParent(mother);
    const dad = await openParent(father);
    await mom.locator('#inviteRecipient').fill('dad@example.com');
    await mom.locator('#parentInviteForm button').click();
    await mom.waitForFunction(() => state.outgoingInvites.length === 1);
    await dad.evaluate(() => pollFamilyInvitations());
    await dad.locator('#familyInviteDialog').waitFor();
    await dad.setViewportSize({ width: 390, height: 844 });
    assert(await dad.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await dad.screenshot({ path: path.join(require('node:os').tmpdir(), 'missionnest-direct-invitation.png'), fullPage: true });
    await dad.setViewportSize({ width: 768, height: 1024 });
    assert.equal(await dad.evaluate(() => state.family.id), fatherFamily);
    assert.equal(await dad.evaluate(() => state.children.length), 0);
    await dad.locator('#familyInviteDialog [data-accept-invitation]').click();
    await dad.waitForFunction(id => state.family?.id === id && state.children.length === 1, family);
    assert.equal(await dad.evaluate(() => state.children[0].display_name), 'Child');
    await dad.evaluate(() => setView('family'));
    assert.equal(await dad.locator('#parentInviteForm').count(), 0);
    assert.equal(await dad.locator('#activeFamilySelect option').count(), 2);
    await dad.locator('#activeFamilySelect').selectOption(fatherFamily);
    await dad.waitForFunction(id => state.family.id === id && state.children.length === 0, fatherFamily);
    assert.equal(await dad.evaluate(() => state.children.length), 0);
    await dad.locator('#activeFamilySelect').selectOption(family);
    await dad.waitForFunction(id => state.family.id === id && state.children.length === 1, family);
    assert.equal(await dad.evaluate(() => state.children.length), 1);
    const joiningAdult = await openParent(guardian);
    assert(await joiningAdult.locator('#joinFamilyForm').isVisible());
    assert.equal(await joiningAdult.evaluate(() => state.family), null);
    await joiningAdult.locator('#familyUsername').fill('test_tutor');
    await joiningAdult.locator('#usernameForm button').click();
    await joiningAdult.waitForFunction(() => state.username === 'test_tutor');
    await mom.locator('#inviteRecipient').fill('TEST_TUTOR');
    await mom.locator('#inviteRole').selectOption('tutor');
    await mom.locator('#parentInviteForm button').click();
    await mom.waitForFunction(() => state.outgoingInvites.some(i=>i.role === 'tutor'));
    await joiningAdult.evaluate(() => pollFamilyInvitations());
    await joiningAdult.locator('#familyInviteDialog [data-decline-invitation]').click();
    await joiningAdult.waitForFunction(() => state.incomingInvites.length === 0);
    assert.equal(await joiningAdult.evaluate(() => state.children.length), 0);
    await mom.locator('#inviteRecipient').fill('test_tutor');
    await mom.locator('#inviteRole').selectOption('tutor');
    await mom.locator('#parentInviteForm button').click();
    await mom.waitForFunction(() => state.outgoingInvites.some(i=>i.role === 'tutor'));
    await joiningAdult.evaluate(() => pollFamilyInvitations());
    await joiningAdult.locator('#familyInviteDialog [data-accept-invitation]').click();
    await joiningAdult.waitForFunction(() => state.familyRole === 'tutor' && state.children.length === 1);
    assert.equal(await joiningAdult.evaluate(() => state.family.id), family);
    assert.equal(await joiningAdult.evaluate(() => state.children[0].kid_pin), undefined);
    assert.equal(await joiningAdult.evaluate(() => state.missions.some(m=>m.title === 'Private chore')), false);
    assert.equal(await joiningAdult.locator('[data-tab=kids]').count(), 0);
    await joiningAdult.locator('[data-tab=mission]').click();
    assert.equal(await joiningAdult.locator('[name=category_id] option').count(), 1);
    assert.equal(await joiningAdult.locator('[name=category_id]').innerText(), 'Lessons');
    await joiningAdult.locator('[name=title]').fill('Tutor-created lesson');
    await joiningAdult.locator('[name=instruction_row]').first().fill('Read another page');
    await joiningAdult.locator('#missionForm button[type=submit]').click();
    await joiningAdult.waitForFunction(() => state.missions.some(m=>m.title === 'Tutor-created lesson'));
    await joiningAdult.locator('[data-tab=quiz]').click();
    assert.equal(await joiningAdult.locator('#quizForm').count(), 1);
    await joiningAdult.locator('[name=title]').fill('Tutor-owned quiz');
    await joiningAdult.locator('[name=mc_source][value=manual]').check();
    await joiningAdult.locator('[name=mc_question]').fill('Choose the answer');
    await joiningAdult.locator('[name=mc_choice_A]').fill('One');
    await joiningAdult.locator('[name=mc_choice_B]').fill('Two');
    await joiningAdult.locator('[name=mc_answer]').selectOption('B');
    await joiningAdult.locator('button[value=launch]').click();
    await joiningAdult.waitForFunction(() => state.missions.some(m=>m.title==='Tutor-owned quiz'));
    assert(await joiningAdult.evaluate(() => state.missions.every(m=>m.created_by===state.session.userId)));
    await mom.evaluate(() => refreshData());
    const tutorMembership = await mom.evaluate(id => state.familyAdults.find(a=>a.user_id===id).id,guardian);
    mom.once('dialog', dialog => dialog.accept());
    await mom.locator(`[data-disconnect-member="${tutorMembership}"]`).click();
    await mom.waitForFunction(id => !state.familyAdults.some(a=>a.user_id===id),guardian);
    await joiningAdult.evaluate(() => pollFamilyInvitations());
    assert.equal(await joiningAdult.evaluate(() => state.family), null);
    assert.equal(await joiningAdult.evaluate(() => state.children.length), 0);
    await mom.setViewportSize({ width: 390, height: 844 });
    assert(await mom.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await mom.screenshot({ path: path.join(require('node:os').tmpdir(), 'missionnest-family-invites.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('Browser + PostgreSQL: invitations, family switching, own Lessons/quiz creation, creator filtering, hidden PINs/chores, owner disconnect and access removal passed');
  } finally { await browser.close(); await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
