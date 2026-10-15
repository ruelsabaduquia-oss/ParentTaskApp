const ADMIN_URL='https://nzgdfygljemhapabbsnf.supabase.co';
const ADMIN_KEY='sb_publishable__aqcIKiTLJeuNr9dFCDUXg_-LeRw44M';
const ADMIN_SESSION='missionnest_admin_session_v1';
let adminSession=null, dashboard=null, adminBusy=false, refreshingToken=null;
try { adminSession=JSON.parse(localStorage.getItem(ADMIN_SESSION)); } catch (_) { localStorage.removeItem(ADMIN_SESSION); }
const adminApp=document.getElementById('adminApp');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value?new Date(value).toLocaleString():'No expiry';
const api=async(name,args={})=>adminRequest(`/rest/v1/rpc/${name}`,args);
async function adminRequest(path,body,retry=true) {
  const response=await fetch(ADMIN_URL+path,{method:'POST',headers:{apikey:ADMIN_KEY,'Content-Type':'application/json',Authorization:`Bearer ${adminSession?.access_token || ADMIN_KEY}`},body:JSON.stringify(body)});
  if(response.status===401 && retry && adminSession?.refresh_token) {
    if(!refreshingToken) refreshingToken=fetch(ADMIN_URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:ADMIN_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:adminSession.refresh_token})}).then(async r=>{if(!r.ok)throw Error('Session expired. Please sign in again.');adminSession=await r.json();localStorage.setItem(ADMIN_SESSION,JSON.stringify(adminSession));}).finally(()=>{refreshingToken=null;});
    await refreshingToken;return adminRequest(path,body,false);
  }
  const raw=await response.text();let result;try{result=raw?JSON.parse(raw):null;}catch(_){result=raw;}
  if(!response.ok) throw Error(result?.message || 'Unable to connect. Please try again.');
  return result;
}
function feedback(message,id='adminFeedback'){const el=document.getElementById(id);if(el)el.textContent=message;}
function loginScreen(message='') {
  adminApp.innerHTML=`<main class="admin-login"><p class="tiny">MyKidsTask Admin</p><h1>Sign In</h1><form id="adminLogin"><div class="field"><label for="adminEmail">Email</label><input id="adminEmail" name="email" type="email" autocomplete="username" required></div><div class="field"><label for="adminPassword">Password</label><input id="adminPassword" name="password" type="password" autocomplete="current-password" required></div><button class="btn btn-primary btn-wide" type="submit">Sign In</button><p class="admin-feedback" id="adminFeedback" role="status">${esc(message)}</p></form></main>`;
  document.getElementById('adminLogin').onsubmit=async e=>{e.preventDefault();const form=e.target,data=new FormData(form),button=form.querySelector('button');button.disabled=true;try{adminSession=await adminRequest('/auth/v1/token?grant_type=password',{email:String(data.get('email')).trim(),password:data.get('password')},false);localStorage.setItem(ADMIN_SESSION,JSON.stringify(adminSession));await loadDashboard();}catch(error){feedback(error.message);}finally{button.disabled=false;}};
}
function logout(){adminSession=null;dashboard=null;localStorage.removeItem(ADMIN_SESSION);document.querySelectorAll('dialog').forEach(d=>d.remove());loginScreen();}
async function loadDashboard(silent=false) {
  if(adminBusy || !adminSession)return;adminBusy=true;
  try {
    const previous=dashboard;dashboard=await api('mn_admin_dashboard');
    if(!silent || !document.getElementById('familySearch')) renderDashboard();
    else {
      updateFamilyList();updateOverview();
      if(previous && dashboard.events[0]?.id!==previous.events[0]?.id) feedback('New subscription activity received. Open the family to review.');
    }
  } catch(error){if(!dashboard){loginScreen(error.message);}else feedback(error.message);}
  finally{adminBusy=false;}
}
function renderDashboard() {
  adminApp.innerHTML=`<header class="topbar"><div class="topbar-inner"><strong class="brand">MyKidsTask Admin</strong><button class="btn" id="adminLogout">Logout</button></div></header><main class="admin-shell"><h1>Subscriptions</h1><div class="admin-overview" id="adminOverview"></div><div class="admin-toolbar"><div class="field"><label for="familySearch">Find Family</label><input id="familySearch" type="search" placeholder="Family name or owner email"></div><div class="action-row"><button class="btn" id="adminSettings">Payment Settings</button><button class="btn" id="adminRefresh">Refresh</button></div></div><p id="adminFeedback" class="admin-feedback" role="status"></p><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Family / Owner</th><th>Status</th><th>Plan</th><th>Expiry</th><th>Payment</th><th></th></tr></thead><tbody id="adminFamilies"></tbody></table></div><section class="family-section"><h2>Recent Activity</h2><div id="adminEvents"></div></section></main>`;
  document.getElementById('adminLogout').onclick=logout;
  document.getElementById('adminSettings').onclick=openSettings;
  document.getElementById('adminRefresh').onclick=()=>loadDashboard();
  document.getElementById('familySearch').oninput=updateFamilyList;
  updateOverview();updateFamilyList();
}
function updateOverview(){document.getElementById('adminOverview').innerHTML=[['Active',dashboard.families.filter(f=>f.effective_status==='active').length],['Awaiting Activation',dashboard.families.filter(f=>f.effective_status==='pending').length],['Payments to Verify',dashboard.payments.filter(p=>p.status==='pending').length],['Suspended',dashboard.families.filter(f=>f.effective_status==='suspended').length]].map(([label,n])=>`<div><strong>${n}</strong><span>${label}</span></div>`).join('');}
function updateFamilyList(){
  const search=(document.getElementById('familySearch')?.value || '').toLowerCase();
  document.getElementById('adminFamilies').innerHTML=dashboard.families.filter(f=>`${f.name} ${f.owner_email}`.toLowerCase().includes(search)).map(f=>`<tr><td><strong>${esc(f.name)}</strong><small>${esc(f.owner_email)}</small></td><td><span class="pill admin-status-${esc(f.effective_status)}">${esc(f.effective_status)}</span></td><td>${esc(f.plan.replace('_',' '))}</td><td>${date(f.expires_at)}</td><td>${dashboard.payments.some(p=>p.family_id===f.family_id&&p.status==='pending')?'Needs Verification':'&mdash;'}</td><td><button class="btn" data-family="${esc(f.family_id)}">Open</button></td></tr>`).join('') || '<tr><td colspan="6">No families found.</td></tr>';
  document.querySelectorAll('[data-family]').forEach(b=>b.onclick=()=>openFamily(b.dataset.family));
  document.getElementById('adminEvents').innerHTML=dashboard.events.slice(0,15).map(e=>`<div class="admin-event"><strong>${esc(dashboard.families.find(f=>f.family_id===e.family_id)?.name || 'Platform')}</strong> &middot; ${esc(e.event.replaceAll('_',' '))}<small> &middot; ${date(e.created_at)}</small></div>`).join('') || '<p>No activity yet.</p>';
}
function dialog(content) {
  document.querySelectorAll('dialog').forEach(d=>d.remove());const d=document.createElement('dialog');d.className='admin-dialog';
  d.innerHTML=`<div class="action-row"><button class="btn" data-close>Close</button></div>${content}<p id="dialogFeedback" class="admin-feedback" role="status"></p>`;
  document.body.appendChild(d);d.querySelector('[data-close]').onclick=()=>d.remove();d.addEventListener('cancel',()=>d.remove());d.showModal();return d;
}
async function action(button,work){button.disabled=true;try{await work();await loadDashboard(true);}catch(error){feedback(error.message,'dialogFeedback');}finally{button.disabled=false;}}
function openFamily(id){
  const f=dashboard.families.find(x=>x.family_id===id),settings=dashboard.settings;
  const payments=dashboard.payments.filter(p=>p.family_id===id);
  const d=dialog(`<h2>${esc(f.name)}</h2><p>${esc(f.owner_email)}</p><p><strong>${esc(f.effective_status)}</strong> &middot; ${esc(f.plan)} &middot; ${date(f.expires_at)}</p>
    <form id="adminMessage"><h3>Payment Instructions</h3><div class="field"><label for="ownerMessage">Message to Owner</label><textarea id="ownerMessage" name="message" required>${esc(f.message || `Please send your subscription payment to GCash ${settings.gcash_number}${settings.account_name?' ('+settings.account_name+')':''}. Submit your reference number after payment.`)}</textarea></div><button class="btn btn-primary" type="submit">Send Notification</button></form>
    <section class="family-section"><h3>Payments</h3>${payments.map(p=>`<article class="admin-event"><strong>PHP ${Number(p.amount).toFixed(2)} &middot; ${esc(p.plan)}</strong><p>GCash Reference: ${esc(p.reference)}</p><p>${date(p.created_at)} &middot; ${esc(p.status)}</p>${p.admin_note?`<p>${esc(p.admin_note)}</p>`:''}${p.status==='pending'?`<div class="field"><label for="note-${p.id}">Verification Note</label><input id="note-${p.id}" maxlength="500"></div><div class="action-row"><button class="btn btn-danger" data-reject="${p.id}">Reject</button><button class="btn btn-primary" data-approve="${p.id}">Verify &amp; Approve</button></div>`:''}</article>`).join('') || '<p>No payments submitted.</p>'}</section>
    <form id="adminAccess"><h3>Access Override</h3><div class="field"><label for="accessStatus">Status</label><select id="accessStatus" name="status"><option value="active">Active</option><option value="suspended" ${f.effective_status==='suspended'?'selected':''}>Suspended</option></select></div><div class="field"><label for="accessPlan">Plan</label><select id="accessPlan" name="plan">${['monthly','quarterly','annual','no_expiry','custom'].map(p=>`<option value="${p}" ${f.plan===p?'selected':''}>${p.replace('_',' ')}</option>`).join('')}</select></div><div class="field" id="expiryField"><label for="accessExpiry">Expiry</label><input id="accessExpiry" name="expiry" type="datetime-local"></div><div class="field"><label for="accessNote">Note to Owner</label><input id="accessNote" name="note" maxlength="500"></div><button class="btn btn-primary" type="submit">Save Access</button></form>`);
  d.querySelector('#adminMessage').onsubmit=e=>{e.preventDefault();action(e.target.querySelector('button'),async()=>{await api('mn_admin_message',{p_family_id:id,p_message:new FormData(e.target).get('message')});feedback('Notification sent to the family owner.','dialogFeedback');});};
  d.querySelectorAll('[data-approve],[data-reject]').forEach(button=>button.onclick=()=>{
    const approved=Boolean(button.dataset.approve),paymentId=button.dataset.approve||button.dataset.reject;
    if(!confirm(approved?'Have you checked your GCash account and verified the reference number and full amount? Approval activates the selected plan.':'Reject this payment submission?'))return;
    action(button,async()=>{await api('mn_admin_payment',{p_payment_id:paymentId,p_approve:approved,p_note:document.getElementById('note-'+paymentId).value});await loadDashboard(true);openFamily(id);});
  });
  const plan=d.querySelector('#accessPlan'),expiry=d.querySelector('#accessExpiry');
  const setExpiry=()=>{
    d.querySelector('#expiryField').hidden=plan.value==='no_expiry';expiry.required=plan.value!=='no_expiry';
    if(plan.value!=='no_expiry'){
      const next=new Date(Math.max(Date.now(),new Date(f.expires_at||0).getTime()));
      if(plan.value!=='custom')next.setMonth(next.getMonth()+({monthly:1,quarterly:3,annual:12}[plan.value]));
      const local=new Date(next.getTime()-next.getTimezoneOffset()*60000);expiry.value=local.toISOString().slice(0,16);
    }
  };plan.onchange=setExpiry;setExpiry();
  d.querySelector('#adminAccess').onsubmit=e=>{e.preventDefault();if(!confirm('Apply this manual access override?'))return;const data=new FormData(e.target);action(e.target.querySelector('button'),async()=>{await api('mn_admin_access',{p_family_id:id,p_status:data.get('status'),p_plan:data.get('plan'),p_expires_at:data.get('plan')==='no_expiry'?null:new Date(data.get('expiry')).toISOString(),p_note:data.get('note')});await loadDashboard(true);openFamily(id);});};
}
function openSettings(){
  const s=dashboard.settings;
  const d=dialog(`<h2>Payment Settings</h2><form id="settingsForm"><div class="field"><label for="settingNumber">GCash Number</label><input id="settingNumber" name="number" value="${esc(s.gcash_number)}" required></div><div class="field"><label for="settingName">GCash Account Name</label><input id="settingName" name="name" value="${esc(s.account_name)}"></div><div class="field"><label for="settingInstructions">Instructions</label><textarea id="settingInstructions" name="instructions">${esc(s.instructions)}</textarea></div>${['monthly','quarterly','annual'].map(p=>`<div class="field"><label for="price-${p}">${p[0].toUpperCase()+p.slice(1)} Price (PHP)</label><input id="price-${p}" name="${p}" type="number" min="0" step="0.01" value="${Number(s[p+'_price'])}" required></div>`).join('')}<button class="btn btn-primary" type="submit">Save Settings</button></form>`);
  d.querySelector('form').onsubmit=e=>{e.preventDefault();const data=new FormData(e.target);action(e.target.querySelector('button'),async()=>{await api('mn_admin_settings',{p_number:data.get('number'),p_name:data.get('name'),p_instructions:data.get('instructions'),p_monthly:Number(data.get('monthly')),p_quarterly:Number(data.get('quarterly')),p_annual:Number(data.get('annual'))});feedback('Settings saved.','dialogFeedback');});};
}
if(adminSession)loadDashboard();else loginScreen();
setInterval(()=>{if(adminSession && dashboard && !document.querySelector('dialog'))loadDashboard(true);},10000);
