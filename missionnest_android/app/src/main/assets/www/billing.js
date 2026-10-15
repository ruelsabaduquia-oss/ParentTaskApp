let subscriptionPollBusy = false;
function subscriptionBlocked() { return state.subscription && state.subscription.status !== 'active'; }
async function loadSubscription() {
  if (!state.family || !state.session) { state.subscription = null; return; }
  const familyId=state.family.id, session=state.session;
  let subscription;
  try {
    if (state.session.mode === 'parent') {
      subscription = await supabaseRequest('/rest/v1/rpc/mn_my_subscription', {method:'POST',body:JSON.stringify({p_family_id:familyId})});
      // Older databases do not have billing yet. Family creation still requires the new RPC.
      if (Array.isArray(subscription)) subscription = null;
    } else {
      const active = await supabaseRequest('/rest/v1/rpc/mn_subscription_active', {method:'POST',body:JSON.stringify({p_family_id:familyId})});
      subscription = typeof active === 'boolean' ? {status:active?'active':'suspended',is_owner:false} : null;
    }
    if (state.family?.id===familyId && state.session===session) state.subscription=subscription;
  } catch (error) {
    if (/PGRST202/.test(error.message)) { if(state.family?.id===familyId && state.session===session) state.subscription=null; return; }
    throw error;
  }
}
async function pollSubscription() {
  if (subscriptionPollBusy) return;
  subscriptionPollBusy = true;
  const old = state.subscription;
  try {
    await loadSubscription();
    if (state.subscription?.is_owner && old && old.message !== state.subscription.message && state.subscription.message) {
      const message = byId('subscriptionOwnerMessage');
      if (message) { message.textContent=state.subscription.message; message.hidden=false; }
      showBillingNotification(state.subscription.message);
    }
    if (subscriptionBlocked()) {
      if (old?.status !== state.subscription.status) {
        if (quizClockInterval) clearInterval(quizClockInterval);
        resetFamilyViews();
        state.selectedQuiz = null;
        render();
      }
    } else if (old && old.status !== 'active') await refreshData();
    else if (state.view === 'subscription' && !isEditingField() && JSON.stringify(old) !== JSON.stringify(state.subscription)) render();
    showSubscriptionReminder();
  } catch (_) { /* Keep unsaved work during temporary network failures; RLS still gates writes. */ }
  finally { subscriptionPollBusy = false; }
}
function billingDate(value) { return value ? new Date(value).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}) : 'No expiry'; }
function subscriptionPage() {
  const s = state.subscription;
  if (!s) return '<h1>Subscription</h1><p>Subscription setup has not been installed in Supabase yet.</p>';
  const owner = s.is_owner;
  const settings = s.settings || {};
  const payments = s.payments || [];
  const pending = payments.some(p => p.status === 'pending');
  return `<section class="billing-page"><p class="tiny">${escapeHtml(state.family.name)}</p><h1>Subscription</h1>
    <div class="billing-status"><strong>${escapeHtml(s.status === 'pending' ? 'Awaiting activation' : s.status === 'suspended' ? 'Access suspended' : 'Active')}</strong><span>${escapeHtml(s.plan?.replace('_',' ') || '')} &middot; ${billingDate(s.expires_at)}</span></div>
    <p id="subscriptionOwnerMessage" class="billing-message" role="status" ${s.message?'':'hidden'}>${escapeHtml(s.message || '')}</p>
    ${!owner ? '<p>Please contact your family owner about activation or renewal.</p>' : `
    <section class="family-section"><h2>GCash Payment</h2><strong class="gcash-number">${escapeHtml(settings.gcash_number || 'Awaiting payment instructions')}</strong>
    ${settings.account_name ? `<p>${escapeHtml(settings.account_name)}</p>` : ''}
    <p>${escapeHtml(settings.instructions || '')}</p>
    <p>Monthly: ${billingPrice(settings.monthly_price)} &middot; Quarterly: ${billingPrice(settings.quarterly_price)} &middot; Annual: ${billingPrice(settings.annual_price)}</p>
    ${pending ? '<p class="billing-message">Your payment is awaiting manual verification.</p>' : `
    <form id="subscriptionPaymentForm"><div class="field"><label for="paymentPlan">Plan</label><select id="paymentPlan" name="plan"><option value="monthly" ${s.plan==='monthly'?'selected':''}>Monthly</option><option value="quarterly" ${s.plan==='quarterly'?'selected':''}>Quarterly</option><option value="annual" ${s.plan==='annual'?'selected':''}>Annual</option></select></div>
    <div class="field"><label for="gcashReference">GCash reference number</label><input id="gcashReference" name="reference" minlength="6" maxlength="64" required autocomplete="off"></div>
    <div class="field"><label for="paymentAmount">Amount Paid (PHP)</label><input id="paymentAmount" name="amount" type="number" min="0.01" step="0.01" required></div>
    <button class="btn btn-primary" type="submit">I Paid &middot; Submit for Verification</button><p id="paymentFeedback" role="status"></p></form>`}</section>
    <section class="family-section"><h2>Payment History</h2>${payments.length ? payments.map(p=>`<article class="family-request-row"><div><strong>${escapeHtml(p.plan)} &middot; PHP ${Number(p.amount).toFixed(2)}</strong><p>Reference: ${escapeHtml(p.reference)} &middot; ${billingDate(p.created_at)}</p>${p.admin_note ? `<p>${escapeHtml(p.admin_note)}</p>`:''}</div><span class="pill">${escapeHtml(p.status)}</span></article>`).join('') : '<p>No payments submitted.</p>'}</section>`}</section>`;
}
function billingPrice(value) { return Number(value)>0 ? `PHP ${Number(value).toFixed(2)}` : 'Contact administrator'; }
function renderSubscriptionGate() {
  app.className = 'app';
  app.innerHTML = `<header class="topbar"><div class="topbar-inner">${brand()}<button class="btn" id="billingLogout">Logout</button></div></header><main class="shell">${messageHtml()}${subscriptionPage()}${state.session.mode==='parent' && state.availableFamilies.length>1 ? `<div class="field"><label for="billingFamily">Switch Family</label><select id="billingFamily">${state.availableFamilies.map(f=>`<option value="${escapeAttr(f.id)}" ${f.id===state.family.id?'selected':''}>${escapeHtml(f.name)}</option>`).join('')}</select></div>`:''}<button class="btn" id="billingRefresh">Check Activation Status</button></main>`;
  byId('billingLogout').onclick = clearSession;
  byId('billingRefresh').onclick = () => refreshData();
  const select = byId('billingFamily');
  if (select) select.onchange = async () => { state.session.familyId=select.value; setSession(state.session); await refreshData(); };
  bindSubscriptionHandlers();
}
function bindSubscriptionHandlers() {
  const form = byId('subscriptionPaymentForm');
  if (!form) return;
  form.onsubmit = async event => {
    event.preventDefault();
    const data = new FormData(form);
    const button = form.querySelector('button'); button.disabled=true;
    try {
      await supabaseRequest('/rest/v1/rpc/mn_submit_payment',{method:'POST',body:JSON.stringify({p_family_id:state.family.id,p_plan:data.get('plan'),p_reference:String(data.get('reference')).trim(),p_amount:Number(data.get('amount'))})});
      state.notice='Payment submitted. Activation follows administrator verification.';
      await loadSubscription(); render();
    } catch(error) { byId('paymentFeedback').textContent=/23505/.test(error.message)?'This reference was already submitted, or a payment is awaiting verification.':error.message; }
    finally { button.disabled=false; }
  };
}
function showSubscriptionReminder() {
  const s=state.subscription;
  if (!s?.is_owner || s.status!=='active' || !s.expires_at || byId('subscriptionReminder')) return;
  const remaining=new Date(s.expires_at)-new Date(s.server_now || Date.now());
  if (remaining<=0 || remaining>5*86400000) return;
  const key=`mn_expiry_reminder_${state.family.id}_${s.expires_at}_${new Date().toISOString().slice(0,10)}`;
  if (localStorage.getItem(key)) return;
  const dialog=document.createElement('dialog');dialog.id='subscriptionReminder';dialog.className='billing-dialog';
  dialog.innerHTML=`<h2>Subscription Expiring</h2><p>Your family subscription expires on ${billingDate(s.expires_at)}. Renew to avoid interruption.</p><div class="action-row"><button class="btn" data-remind-later>Later</button><button class="btn btn-primary" data-renew>Renew</button></div>`;
  const close=()=>{localStorage.setItem(key,'1');dialog.close();dialog.remove();};
  dialog.querySelector('[data-remind-later]').onclick=close;
  dialog.querySelector('[data-renew]').onclick=()=>{close();setView('subscription');};
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  document.body.appendChild(dialog);dialog.showModal();
}
function showBillingNotification(message) {
  if (byId('billingNotification')) return;
  const dialog=document.createElement('dialog');dialog.id='billingNotification';dialog.className='billing-dialog';
  dialog.innerHTML=`<h2>Subscription Update</h2><p>${escapeHtml(message)}</p><button class="btn btn-primary">OK</button>`;
  dialog.querySelector('button').onclick=()=>dialog.remove();
  dialog.addEventListener('cancel',()=>dialog.remove());document.body.appendChild(dialog);dialog.showModal();
}
