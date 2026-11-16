(() => {
  // Graphics: Twemoji v16.0.1, CC BY 4.0; see assets/emoji/ATTRIBUTION.md.
  const symbols = ['😊','😌','😚','😓','😰','😝','😁','😜','☺️','😍','😔','😏','😒','😳','😘','😭','😱','😂','💪','👊','👍','👏','👎','🙏','👌','☝️','👀','🍜','🍨','🍞','🍺','🍻','☕','🍎','🍓','🍉','🚬','🌹','🎉','💝','💣','✨','💨','💦','🔥','💤','💩','💉','📫','🐎','👧','👦','🐵','🐷'];
  const supported = new Map(symbols.map(symbol => [Array.from(symbol)[0],symbol]));
  const failed = new Set();
  function asset(symbol) { return '/assets/emoji/' + Array.from(symbol).filter(char => char !== '\ufe0f').map(char => char.codePointAt(0).toString(16)).join('-') + '.svg'; }
  function icon(symbol) {
    const img = document.createElement('img'); img.className = 'blog-emoji'; img.alt = symbol; img.draggable = false; img.src = asset(symbol);
    img.addEventListener('error', () => { failed.add(Array.from(symbol)[0]); img.replaceWith(document.createTextNode(symbol)); }, {once:true});
    return img;
  }
  function render(root) {
    if (!root) return;
    const nodes = [];
    if (root.nodeType === Node.TEXT_NODE) nodes.push(root);
    else { const walker = document.createTreeWalker(root,NodeFilter.SHOW_TEXT); while (walker.nextNode()) nodes.push(walker.currentNode); }
    for (const node of nodes) {
      const parent = node.parentElement;
      if (!parent || parent.closest('script,style,textarea,input,pre,code,[contenteditable="true"]')) continue;
      const chars = Array.from(node.nodeValue), fragment = document.createDocumentFragment(); let buffer = '', changed = false;
      const flush = () => { if (buffer) { fragment.append(document.createTextNode(buffer)); buffer = ''; } };
      for (let i=0; i<chars.length; i++) {
        const char = chars[i], next = chars[i+1], after = next === '\ufe0f' ? chars[i+2] : next;
        const joined = chars[i-1] === '\u200d' || after === '\u200d' || (after && after.codePointAt(0) >= 0x1f3fb && after.codePointAt(0) <= 0x1f3ff);
        if (supported.has(char) && !failed.has(char) && !joined) { flush(); const value = char + (next === '\ufe0f' ? chars[++i] : ''); fragment.append(icon(value)); changed = true; }
        else buffer += char;
      }
      if (changed) { flush(); node.replaceWith(fragment); }
    }
  }
  function observe(root) {
    render(root);
    const observer = new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) { if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.ELEMENT_NODE) render(node); } });
    observer.observe(root,{childList:true,subtree:true,characterData:false});
    return observer;
  }
  window.BlogEmoji = {symbols,asset,icon,render,observe};
})();
