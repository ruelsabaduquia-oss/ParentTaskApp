window.StarStats = (() => {
  let childId='', period='week', anchor=new Date(), cacheKey='', loadingKey='', events=[], error='';
  const dayKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  function range() {
    const start=new Date(anchor.getFullYear(),anchor.getMonth(),anchor.getDate());
    if(period==='week') start.setDate(start.getDate()-((start.getDay()+6)%7)); else start.setDate(1);
    const end=new Date(start);
    if(period==='week')end.setDate(end.getDate()+7);else end.setMonth(end.getMonth()+1);
    return {start,end};
  }
  function context(){
    if(!state.children.some(child=>child.id===childId))childId=state.children[0]?.id||'';
    const dates=range(),child=state.children.find(child=>child.id===childId);
    return {...dates,child,key:`${state.family?.id}:${childId}:${period}:${dayKey(dates.start)}:${child?.stars}`};
  }
  function profileButtons(child){
    if(isTutor())return '';
    return `<div class="action-row"><button class="btn" type="button" data-star-stats="${escapeAttr(child.id)}">Star Stats</button><button class="btn btn-danger" type="button" data-reset-stars="${escapeAttr(child.id)}" ${Number(child.stars)===0?'disabled':''}>Reset Stars</button></div>`;
  }
  function buckets(rows,start,end){
    const days=[];
    for(let date=new Date(start);date<end;date.setDate(date.getDate()+1))days.push({date:new Date(date),key:dayKey(date),value:0});
    for(const row of rows){
      if(row.kind!=='award')continue;
      const bucket=days.find(day=>day.key===dayKey(new Date(row.created_at)));
      if(bucket)bucket.value+=Math.max(0,Number(row.amount)||0);
    }
    return days;
  }
  function renderPage(){
    if(isTutor())return '<p>Parent access required.</p>';
    const {child,start,end,key}=context(),last=new Date(end);last.setDate(last.getDate()-1);
    const title=period==='month'?start.toLocaleDateString(undefined,{month:'long',year:'numeric'}):`${start.toLocaleDateString(undefined,{month:'short',day:'numeric'})} - ${last.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}`;
    const ready=cacheKey===key,days=buckets(ready?events:[],start,end),total=days.reduce((sum,day)=>sum+day.value,0),max=Math.max(1,...days.map(day=>day.value));
    return `<section class="star-stats-page"><div class="section-title"><h1>Star Stats</h1><button class="btn" id="refreshStars" type="button">Refresh</button></div>
      ${!child?'<p>No child profiles yet.</p>':`
      <div class="star-stats-toolbar"><div class="field"><label for="starStatsChild">Child</label><select id="starStatsChild">${state.children.map(item=>`<option value="${escapeAttr(item.id)}" ${item.id===childId?'selected':''}>${escapeHtml(item.display_name)}</option>`).join('')}</select></div>
      <div class="star-period-control" role="group" aria-label="Star stats period"><button class="btn ${period==='week'?'btn-primary':''}" type="button" data-star-period="week" aria-pressed="${period==='week'}">Week</button><button class="btn ${period==='month'?'btn-primary':''}" type="button" data-star-period="month" aria-pressed="${period==='month'}">Month</button></div></div>
      <div class="star-period-nav"><button class="btn star-period-arrow" type="button" data-star-shift="-1" title="Previous period" aria-label="Previous period">&#8249;</button><h2>${escapeHtml(title)}</h2><button class="btn star-period-arrow" type="button" data-star-shift="1" title="Next period" aria-label="Next period">&#8250;</button></div>
      <div class="star-summary"><div><span>Current Balance</span><strong>${Number(child.stars)||0}</strong></div><div><span>Earned This ${period==='week'?'Week':'Month'}</span><strong>${ready&&!error?total:'-'}</strong></div></div>
      ${!ready?'<p role="status">Loading star history...</p>':error?`<p class="error" role="alert">${escapeHtml(error)}</p>`:`
      <figure class="star-chart" aria-label="Daily stars earned"><figcaption>${escapeHtml(child.display_name)} &middot; Stars Earned</figcaption>
        <div class="star-chart-scroll" tabindex="0" aria-label="Daily star chart"><ol class="star-bars ${period==='month'?'star-bars-month':''}">${days.map(day=>`<li title="${escapeAttr(day.date.toLocaleDateString())}: ${day.value} stars"><strong>${day.value}</strong><div class="star-bar-track"><span class="star-bar ${day.value?'':'star-bar-zero'}" style="height:${day.value/max*100}%"></span></div><small>${period==='week'?day.date.toLocaleDateString(undefined,{weekday:'short'}):day.date.getDate()}</small></li>`).join('')}</ol></div>
      </figure>${total===0?'<p class="muted">No stars earned during this period.</p>':''}`}
      <div class="action-row"><button class="btn btn-danger" type="button" data-reset-stars="${escapeAttr(child.id)}" ${Number(child.stars)===0?'disabled':''}>Reset Stars</button></div>`}</section>`;
  }
  async function load(){
    const {key,child,start,end}=context();if(!child||cacheKey===key||loadingKey===key)return;
    loadingKey=key;error='';
    try{
      const all=[];
      for(let offset=0;;offset+=500){
        const query=`family_id=eq.${encodeURIComponent(state.family.id)}&child_id=eq.${encodeURIComponent(child.id)}&kind=eq.award&created_at=gte.${encodeURIComponent(start.toISOString())}&created_at=lt.${encodeURIComponent(end.toISOString())}&order=created_at.asc,id.asc&limit=500&offset=${offset}`;
        const rows=await supabaseGet('mn_star_events',query);all.push(...rows);if(rows.length<500)break;
      }
      if(context().key!==key)return;events=all;cacheKey=key;
    }catch(problem){
      if(context().key!==key)return;
      events=[];cacheKey=key;error=/PGRST205|42P01/.test(problem.message)?'Star history is unavailable. The star-history database update is required.': 'Could not load star history. Please try Refresh.';
    }finally{
      if(loadingKey===key)loadingKey='';
      if(state.session?.mode==='parent'&&state.view==='stars'&&context().key===key)render();
    }
  }
  async function reset(id,button){
    if(isTutor())return;
    const child=state.children.find(item=>item.id===id);if(!child)return;
    if(!confirm(`Reset ${child.display_name}'s star balance to 0?\n\nEarned-star history and graphs will be kept.`))return;
    button.disabled=true;
    try{
      await supabaseRequest('/rest/v1/rpc/mn_reset_child_stars',{method:'POST',body:JSON.stringify({p_child_id:id})});
      cacheKey='';state.notice=`${child.display_name}'s stars were reset. Earning history was kept.`;await refreshData();
    }catch(problem){showError(/PGRST202/.test(problem.message)?'Please apply the star-history database update before resetting stars.':problem.message);}
    finally{button.disabled=false;}
  }
  function bind(){
    document.querySelectorAll('[data-star-stats]').forEach(button=>button.onclick=()=>{childId=button.dataset.starStats;cacheKey='';setView('stars');});
    document.querySelectorAll('[data-reset-stars]').forEach(button=>button.onclick=()=>reset(button.dataset.resetStars,button));
    if(state.view!=='stars'||isTutor())return;
    const select=byId('starStatsChild');if(select)select.onchange=()=>{childId=select.value;render();};
    document.querySelectorAll('[data-star-period]').forEach(button=>button.onclick=()=>{period=button.dataset.starPeriod;render();});
    document.querySelectorAll('[data-star-shift]').forEach(button=>button.onclick=()=>{anchor=range().start;if(period==='week')anchor.setDate(anchor.getDate()+7*Number(button.dataset.starShift));else anchor.setMonth(anchor.getMonth()+Number(button.dataset.starShift));render();});
    byId('refreshStars').onclick=()=>{cacheKey='';render();};
    const scroll=document.querySelector('.star-chart-scroll');
    const earned=scroll?.querySelector('.star-bar:not(.star-bar-zero)')?.closest('li');
    if(scroll && earned && scroll.scrollWidth>scroll.clientWidth)scroll.scrollLeft=Math.max(0,earned.offsetLeft-scroll.offsetLeft-scroll.clientWidth/3);
    load();
  }
  return {render:renderPage,bind,profileButtons,buckets};
})();
