(() => {
  if (!window.BlogEmoji) return;
  const button=document.createElement('button'), panel=document.createElement('section'), header=document.createElement('div'), title=document.createElement('strong'), close=document.createElement('button'), grid=document.createElement('div');
  button.type='button'; button.className='emoji-picker-toggle'; button.textContent='😊 表情'; button.setAttribute('aria-expanded','false'); button.setAttribute('aria-controls','emoji-picker');
  panel.id='emoji-picker'; panel.className='emoji-picker'; panel.hidden=true; panel.setAttribute('aria-label','选择表情');
  header.className='emoji-picker-header'; title.textContent='常用表情'; close.type='button'; close.textContent='关闭'; close.setAttribute('aria-label','关闭表情面板');
  grid.className='emoji-picker-grid'; header.append(title,close); panel.append(header,grid); document.body.append(button,panel);
  let target=null, start=0, end=0;
  function accepts(el) { return el && !el.disabled && !el.readOnly && (el.tagName==='TEXTAREA' || (el.tagName==='INPUT' && ['text','search'].includes(el.type) && el.name!=='slug')); }
  function remember(el) { if (!accepts(el)) return; target=el; start=el.selectionStart ?? el.value.length; end=el.selectionEnd ?? start; }
  document.addEventListener('focusin', event => remember(event.target));
  document.addEventListener('focusout', event => remember(event.target));
  document.addEventListener('selectionchange', () => remember(document.activeElement));
  function hide(){panel.hidden=true;button.setAttribute('aria-expanded','false')}
  button.addEventListener('mousedown',event=>event.preventDefault());
  button.addEventListener('click',()=>{ if (!target || !target.isConnected || target.closest('[hidden]') || !accepts(target)) { const notice=document.getElementById('notice'); if(notice) {notice.textContent='请先点击想输入表情的文字框。';notice.classList.add('error')} return; } panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden)); });
  close.addEventListener('click',hide);
  panel.addEventListener('keydown',event=>{if(event.key==='Escape'){hide();button.focus()}});
  for (const symbol of window.BlogEmoji.symbols) {
    const item=document.createElement('button'); item.type='button'; item.setAttribute('aria-label',`插入 ${symbol}`); item.title=symbol; item.append(window.BlogEmoji.icon(symbol));
    item.addEventListener('mousedown',event=>event.preventDefault());
    item.addEventListener('click',()=>{
      if(!accepts(target) || !target.isConnected || target.closest('[hidden]')) {hide();return}
      const begin=Math.min(start,target.value.length), finish=Math.min(end,target.value.length);
      if(target.maxLength>=0 && target.value.length-(finish-begin)+symbol.length>target.maxLength) { const notice=document.getElementById('notice'); if(notice){notice.textContent='文字已达到长度上限，无法再插入表情。';notice.classList.add('error')} return; }
      target.focus();
      if(typeof target.setRangeText==='function') target.setRangeText(symbol,begin,finish,'end');
      else {target.value=target.value.slice(0,begin)+symbol+target.value.slice(finish);target.setSelectionRange(begin+symbol.length,begin+symbol.length)}
      start=end=begin+symbol.length;target.dispatchEvent(new Event('input',{bubbles:true}));
    });
    grid.append(item);
  }
})();
