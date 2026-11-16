import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import vm from 'node:vm';

function loadEmoji() {
 const window={},document={}; vm.runInNewContext(readFileSync(new URL('../emoji.js',import.meta.url),'utf8'),{window,document,Map,Set,Array}); return window.BlogEmoji;
}
test('every selectable emoji has a local pinned graphic',()=>{
 const emoji=loadEmoji(); assert.ok(emoji.symbols.length>=40);
 for(const symbol of emoji.symbols) { const path=emoji.asset(symbol); assert.match(path,/^\/assets\/emoji\/[a-f0-9-]+\.svg$/); assert.ok(existsSync(new URL('..'+path,import.meta.url)),path); }
 assert.equal(emoji.asset('☺️'),'/assets/emoji/263a.svg');
});

test('renders supported emoji as local images without breaking joined sequences or code',()=>{
 const window={}, made=[];
 const document={createElement(){const e={addEventListener(){}};made.push(e);return e},createTextNode(value){return {text:value}},createDocumentFragment(){return {items:[],append(item){this.items.push(item)}}}};
 vm.runInNewContext(readFileSync(new URL('../emoji.js',import.meta.url),'utf8'),{window,document,Map,Set,Array,Node:{TEXT_NODE:3},NodeFilter:{SHOW_TEXT:4}});
 let replacement;
 const node={nodeType:3,nodeValue:'标题😊和👧🏽与☺️',parentElement:{closest(){return null}},replaceWith(value){replacement=value}};
 window.BlogEmoji.render(node);
 assert.equal(replacement.items.filter(item=>item.className==='blog-emoji').length,2);
 assert.ok(replacement.items.some(item=>item.text?.includes('👧🏽')));
 assert.ok(replacement.items.some(item=>item.alt==='😊'));
 assert.ok(replacement.items.some(item=>item.alt==='☺️'));
 let touched=false; window.BlogEmoji.render({nodeType:3,nodeValue:'😊',parentElement:{closest(){return {}}},replaceWith(){touched=true}}); assert.equal(touched,false);
});

test('picker inserts at the chosen cursor and respects the text limit',()=>{
 const docListeners={},created=[]; function node(tag){const e={tagName:tag.toUpperCase(),children:[],listeners:{},hidden:false,attributes:{},isConnected:true,append(...items){this.children.push(...items)},setAttribute(k,v){this.attributes[k]=v},addEventListener(k,fn){this.listeners[k]=fn},closest(){return null},focus(){},dispatchEvent(){}};created.push(e);return e}
 const notice=node('div'); notice.classList={add(){}};
 const document={body:node('body'),createElement:node,addEventListener(k,fn){docListeners[k]=fn},getElementById:()=>notice,activeElement:null};
 const window={BlogEmoji:{symbols:['😊'],icon:()=>node('img')}};
 const target=node('input'); Object.assign(target,{type:'text',name:'title',value:'前后',selectionStart:1,selectionEnd:1,maxLength:10});
 target.setRangeText=function(value,start,end){this.value=this.value.slice(0,start)+value+this.value.slice(end);this.selectionStart=this.selectionEnd=start+value.length};
 const context={window,document,Event:class{},console}; vm.runInNewContext(readFileSync(new URL('../emoji-picker.js',import.meta.url),'utf8'),context);
 docListeners.focusin({target}); const toggle=created.find(e=>e.className==='emoji-picker-toggle'); toggle.listeners.click();
 const grid=created.find(e=>e.className==='emoji-picker-grid'); grid.children[0].listeners.click(); assert.equal(target.value,'前😊后');
 target.maxLength=target.value.length; grid.children[0].listeners.click(); assert.equal(target.value,'前😊后'); assert.match(notice.textContent,/长度上限/);
 const body=node('textarea'); Object.assign(body,{name:'body',value:'正文',selectionStart:2,selectionEnd:2,maxLength:-1});
 body.setRangeText=target.setRangeText; docListeners.focusin({target:body}); grid.children[0].listeners.click(); assert.equal(body.value,'正文😊');
});
