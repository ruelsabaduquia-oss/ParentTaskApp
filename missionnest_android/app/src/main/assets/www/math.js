// KaTeX is local to the APK; untrusted quiz text never becomes raw HTML.
window.MissionMath = (() => {
  const presets = [
    ['fraction', 'Fraction', String.raw`\frac{1}{2}`],
    ['sum', 'Summation', String.raw`\sum_{n=1}^{10} n^2`],
    ['algebra', 'Algebra', String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`],
    ['integral', 'Integral', String.raw`\int_0^1 x^2\,dx`],
    ['derivative', 'Derivative', String.raw`\frac{d}{dx}(x^2)=2x`],
    ['limit', 'Limit', String.raw`\lim_{x\to 0}\frac{\sin x}{x}=1`],
    ['physics', 'Physics', String.raw`\vec{F}=m\vec{a}`],
    ['units', 'Units', String.raw`9.8\,\mathrm{m/s^2}`],
    ['chemistry', 'Chemical Reaction', String.raw`\ce{2H2 + O2 -> 2H2O}`],
    ['ion', 'Chemical Ion', String.raw`\ce{SO4^2-}`],
  ];
  function render(value) {
    const element = document.createElement('span');
    element.className = 'quiz-rich-text';
    element.textContent = String(value ?? '');
    if (window.renderMathInElement) {
      window.renderMathInElement(element, {
        delimiters: [
          {left:'$$',right:'$$',display:true},
          {left:'\\[',right:'\\]',display:true},
          {left:'\\(',right:'\\)',display:false},
        ],
        trust:false, strict:'ignore', throwOnError:false, maxSize:12, maxExpand:500,
        errorCallback:()=>{},
      });
    }
    return element.outerHTML;
  }
  function editorHtml() {
    return `<details class="equation-editor"><summary>Math &amp; Science</summary>
      <div class="equation-controls"><div class="field"><label for="equationTemplate">Equation</label><select id="equationTemplate">${presets.map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select></div>
      <div class="field"><label for="equationSource">Formula</label><textarea id="equationSource" spellcheck="false" aria-label="Formula"></textarea></div>
      <div class="equation-preview" id="equationPreview" aria-live="polite"></div>
      <button class="btn btn-primary" type="button" id="insertEquation">Insert Equation</button></div></details>`;
  }
  function bind(form) {
    if (!form || form.dataset.mathBound) return;
    form.dataset.mathBound='true';
    const source=form.querySelector('#equationSource'),preview=form.querySelector('#equationPreview');
    if (!source) return;
    let target=null;
    form.addEventListener('focusin',event=>{
      if (event.target.matches('textarea') && event.target!==source) target=event.target;
    });
    const update=()=>{preview.innerHTML=render('\\['+source.value+'\\]');};
    const template=form.querySelector('#equationTemplate');
    template.onchange=()=>{source.value=presets.find(p=>p[0]===template.value)[2];update();};
    template.onchange();source.addEventListener('input',update);
    form.querySelector('#insertEquation').onclick=()=>{
      if (!target || !target.isConnected || !target.getClientRects().length) {
        target=Array.from(form.querySelectorAll('textarea')).find(input=>input!==source && input.getClientRects().length);
      }
      if (!target) return;
      const start=target.selectionStart,end=target.selectionEnd;
      target.setRangeText('\\('+source.value+'\\)',start,end,'end');
      target.dispatchEvent(new Event('input',{bubbles:true}));target.focus();
    };
  }
  return {render,editorHtml,bind};
})();
