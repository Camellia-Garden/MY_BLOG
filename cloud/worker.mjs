import schedule from '../schedule-core.cjs';
const {materializeDue} = schedule;
import { readState, writeState } from './d1-state.mjs';
import { applyMutation } from './mutate-blog.mjs';
import { verifySession } from './admin-session.mjs';
import { beginGithubLogin, finishGithubLogin } from './github-oauth.mjs';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const SESSION_NAME = '__Host-camellia-session';
const IMAGE_TYPES = {'image/png':'png', 'image/jpeg':'jpg', 'image/gif':'gif', 'image/webp':'webp'};
function json(body, status = 200, extra = {}) { return new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...extra}}); }
function cookie(request, name) {
  const found = (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).filter(x => x.startsWith(`${name}=`));
  return found.length === 1 ? found[0].slice(name.length + 1) : '';
}
async function isAdmin(request, env) { return verifySession(cookie(request, SESSION_NAME), env.SESSION_SECRET, env.ADMIN_GITHUB_ID); }
function trustedOrigin(request, env) { return request.headers.get('Origin') === env.PUBLIC_ORIGIN && request.headers.get('X-Blog-Editor') === '1'; }
function publicImagePath(path) {
  return /^\/personal\/uploads\/[a-f0-9-]{36}\.(png|jpg|webp|gif)$/.test(path)
    || /^\/personal\/wallpapers\/wallpaper-[0-9]{2}\.png$/.test(path)
    || /^\/personal\/character(?:-mask)?\.png$/.test(path);
}
function imageValid(bytes, type) {
  if (!bytes.length) return false;
  if (type === 'image/png') return bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v);
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === 'image/gif') return bytes.length >= 6 && ['GIF87a','GIF89a'].includes(String.fromCharCode(...bytes.slice(0,6)));
  if (type === 'image/webp') return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
  return false;
}
async function readLimited(request, limit) {
  const declared = request.headers.get('Content-Length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new RangeError('请求数据过大');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), chunks = [];
  let total = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); throw new RangeError('请求数据过大'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
async function imageUpload(request, env) {
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES[type]) return json({error:'请选择 PNG、JPG、WebP 或 GIF 图片'}, 400);
  let bytes;
  try { bytes = await readLimited(request, MAX_IMAGE_BYTES); } catch (error) { if (error instanceof RangeError) return json({error:'图片不能超过 10 MB'}, 413); throw error; }
  if (!imageValid(bytes, type)) return json({error:'图片文件内容与格式不符'}, 400);
  const path = `/private/images/${crypto.randomUUID()}.${IMAGE_TYPES[type]}`;
  await env.IMAGES.put(path.slice(1), bytes, {httpMetadata:{contentType:type}});
  return json({url:path});
}
async function projectFileUpload(request, env) {
  let name; try { name = decodeURIComponent(request.headers.get('X-File-Name') || '').replace(/[\/\\\x00-\x1f\x7f]/g,'').trim(); } catch { return json({error:'文件名无效'},400); }
  if (!name || name.length > 150) return json({error:'文件名无效或过长'},400);
  let bytes; try { bytes = await readLimited(request, 10 * 1024 * 1024); } catch (error) { if (error instanceof RangeError) return json({error:'文件不能超过 10 MB'},413); throw error; }
  if (!bytes.length) return json({error:'文件不能为空'},400);
  const path = `/private/files/${crypto.randomUUID()}`;
  await env.IMAGES.put(path.slice(1), bytes, {httpMetadata:{contentType:'application/octet-stream'}});
  return json({url:path,name});
}
async function projectFileRead(path, env) {
  const object = await env.IMAGES.get(path.slice(1)); if (!object) return new Response('Not found',{status:404});
  return new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':'attachment','X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}});
}
async function imageRead(path, env) {
  const object = await env.IMAGES.get(path.slice(1));
  if (!object) return new Response('Not found', {status:404});
  const headers = new Headers({'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff'});
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control','private, no-store'); headers.set('Vary','Cookie');
  return new Response(object.body, {headers});
}

// Public data must be filtered on the server, before any response reaches a visitor.
function publicData(source) {
  const data = materializeDue(structuredClone(source));
  const result = {...data};
  delete result.privateBlockedAssets;
  const privatePosts = new Set((data.posts || []).filter(item => (item?.private || item?.scheduledAt)).map(item => item.slug));
  const privateMoments = new Set((data.moments || []).filter(item => (item?.private || item?.scheduledAt) && item.id).map(item => item.id));
  const privateMomentTitles = new Set((data.moments || []).filter(item => (item?.private || item?.scheduledAt)).map(item => String(item.text || '').slice(0,100)));
  for (const key of ['posts','moments','albums','projects']) if (Array.isArray(data[key])) result[key] = data[key].filter(item => !item?.private && !item?.scheduledAt);
  if (Array.isArray(data.activityLog)) result.activityLog = data.activityLog.filter(entry => !entry?.private && !entry?.privacyHidden && !(entry?.type === 'post' && privatePosts.has(entry.slug)) && !(entry?.type === 'moment' && (privateMoments.has(entry.momentId) || (!entry.momentId && privateMomentTitles.has(entry.title)))));
  return result;
}
const IMAGE_PATH = /^\/(?:personal\/uploads|private\/images|public\/images)\/[a-f0-9-]{36}\.(png|jpg|webp|gif)$/;
const FILE_PATH = /^\/(?:personal\/project-files|private\/files|public\/files)\/[a-f0-9-]{36}$/;
const ASSET_PATTERN = /\/(?:personal\/uploads|private\/images|public\/images)\/[a-f0-9-]{36}\.(?:png|jpg|webp|gif)|\/(?:personal\/project-files|private\/files|public\/files)\/[a-f0-9-]{36}/g;
async function protectContentAssets(env, data, payload) {
  if (!['post','moment','album','project'].includes(payload.kind)) return;
  const list = data[({post:'posts',moment:'moments',album:'albums',project:'projects'})[payload.kind]];
  const item = payload.kind === 'post' ? list.find(p => p.slug === payload.slug) : list[Number(payload.index) < 0 ? 0 : Number(payload.index)];
  if (!item) throw new Error('内容不存在');
  const privateTarget = !!item.private, replacements = new Map();
  const references = JSON.stringify(item).match(ASSET_PATTERN) || [];
  const publicSnapshot = privateTarget ? JSON.stringify(publicData(data)) : '';
  if (item.scheduledAt && references.some(path => path.startsWith('/personal/') && !(data.privateBlockedAssets || []).includes(path))) throw new Error('定时内容不能使用旧公开图片或文件，请重新上传副本');
  const permanentPublic = new Set(['/personal/uploads/2c5872b6-d19f-4cf1-84d9-e807db170772.png','/personal/uploads/965dc668-d762-4bbf-a539-b58766f4f6c2.png']);
  if (privateTarget && references.some(path => (path.startsWith('/personal/') || path.startsWith('/public/')) && (publicSnapshot.includes(path) || permanentPublic.has(path)))) throw new Error('部分图片或文件仍被其他公开内容使用，请先移除共用文件或上传新的副本');
  for (const original of references) {
    const blocked = Array.isArray(data.privateBlockedAssets) && data.privateBlockedAssets.includes(original);
    const alreadyCorrect = privateTarget ? original.startsWith('/private/') : (original.startsWith('/personal/') || original.startsWith('/public/'));
    if (replacements.has(original) || (alreadyCorrect && !(blocked && !privateTarget))) continue;
    const isImage = IMAGE_PATH.test(original), isFile = FILE_PATH.test(original);
    if (!isImage && !isFile) continue;
    const object = await env.IMAGES.get(original.slice(1)); if (!object) throw new Error('引用的图片或文件不存在，请重新上传');
    const ext = isImage ? original.slice(original.lastIndexOf('.')) : '';
    const target = isImage ? (privateTarget ? '/private/images/' : '/public/images/') : (privateTarget ? '/private/files/' : '/public/files/');
    const next = `${target}${crypto.randomUUID()}${ext}`;
    const types = {'.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'};
    await env.IMAGES.put(next.slice(1),object.body,{httpMetadata:{contentType:isImage ? types[ext] : 'application/octet-stream'}});
    replacements.set(original,next);
    if (privateTarget && original.startsWith('/personal/')) { if (!Array.isArray(data.privateBlockedAssets)) data.privateBlockedAssets = []; if (!data.privateBlockedAssets.includes(original)) data.privateBlockedAssets.push(original); }
  }
  function rewrite(value) {
    if (typeof value === 'string') return value.replace(ASSET_PATTERN, path => replacements.get(path) || path);
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,v]) => [key,rewrite(v)]));
    return value;
  }
  const updated = rewrite(item);
  const index = list.indexOf(item); list[index] = updated;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname;
    try {
      const canonical = new URL(env.PUBLIC_ORIGIN);
      if (canonical.protocol === 'https:' && url.protocol === 'http:' && url.host === canonical.host) {
        return Response.redirect(canonical.origin + url.pathname + url.search, 308);
      }
      if (url.origin !== env.PUBLIC_ORIGIN) return new Response('Not found', {status:404});
      if (path === '/auth/login' && request.method === 'GET') return await beginGithubLogin(env);
      if (path === '/auth/callback') return await finishGithubLogin(request, env);
      if (path === '/api/session' && request.method === 'GET') return json({authenticated:await isAdmin(request, env)});
      if (path === '/api/time' && request.method === 'GET') return json({now:Date.now()});
      if (path === '/api/capabilities' && request.method === 'GET') return json({momentMood:true});
      if (path === '/blog-data.js' && request.method === 'GET') {
        const state = await readState(env.DB);
        if (!state) return new Response('/* 博客数据尚未初始化 */', {status:503, headers:{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store'}});
        const visible = await isAdmin(request, env) ? materializeDue(structuredClone(state.data)) : publicData(state.data);
        return new Response(`window.BLOG_DATA = ${JSON.stringify(visible)};`, {headers:{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
      }
      if ((path.startsWith('/public/images/') || path.startsWith('/public/files/')) && request.method === 'GET') {
        if (!IMAGE_PATH.test(path) && !FILE_PATH.test(path)) return new Response('Not found',{status:404});
        const state = await readState(env.DB); if (!state) return new Response('Unavailable',{status:503,headers:{'Cache-Control':'no-store'}});
        if (!JSON.stringify(publicData(state.data)).includes(path) && !(await isAdmin(request, env))) return new Response('Not found',{status:404,headers:{'Cache-Control':'private, no-store'}});
        return IMAGE_PATH.test(path) ? await imageRead(path, env) : await projectFileRead(path, env);
      }
      if ((path.startsWith('/private/images/') || path.startsWith('/private/files/')) && request.method === 'GET') {
        if (!(await isAdmin(request, env))) return new Response('Not found',{status:404,headers:{'Cache-Control':'private, no-store'}});
        if (IMAGE_PATH.test(path)) return await imageRead(path, env);
        if (FILE_PATH.test(path)) return await projectFileRead(path, env);
        return new Response('Not found',{status:404});
      }
      if ((/^\/personal\/project-files\/[a-f0-9-]{36}$/.test(path) || publicImagePath(path)) && request.method === 'GET') {
        const state = await readState(env.DB); if (!state) return new Response('Unavailable',{status:503,headers:{'Cache-Control':'no-store'}});
        if (Array.isArray(state.data.privateBlockedAssets) && state.data.privateBlockedAssets.includes(path) && !(await isAdmin(request, env))) return new Response('Not found',{status:404,headers:{'Cache-Control':'private, no-store'}});
        return FILE_PATH.test(path) ? await projectFileRead(path, env) : await imageRead(path, env);
      }
      if (path === '/editor' || path === '/editor.html') {
        if (request.method !== 'GET') return json({error:'方法不支持'}, 405);
        if (!(await isAdmin(request, env))) return new Response('请先登录管理员账号', {status:401, headers:{'Cache-Control':'no-store'}});
        // The static asset server canonically redirects /editor.html to /editor.
        // Fetch the canonical path internally to avoid a redirect loop.
        return env.ASSETS.fetch(new Request(new URL('/editor', url), request));
      }
      if (path === '/api/data' && request.method === 'GET') {
        if (!(await isAdmin(request, env))) return json({error:'请先登录'}, 401);
        const state = await readState(env.DB);
        return state ? json(materializeDue(structuredClone(state.data)), 200, {'ETag':`"${state.revision}"`,'X-Blog-Revision':state.revision}) : json({error:'博客数据尚未初始化'}, 503);
      }
      if ((path === '/api/save' || path === '/api/image' || path === '/api/project-file') && request.method === 'POST') {
        if (!trustedOrigin(request, env)) return json({error:'请求来源无效'}, 403);
        if (!(await isAdmin(request, env))) return json({error:'请先登录'}, 401);
        if (path === '/api/image') return await imageUpload(request, env);
        if (path === '/api/project-file') return await projectFileUpload(request, env);
        if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) return json({error:'格式不正确'}, 415);
        let raw;
        try { raw = new TextDecoder().decode(await readLimited(request, 8_000_000)); }
        catch (error) { if (error instanceof RangeError) return json({error:'数据过大'}, 413); throw error; }
        let payload;
        try { payload = JSON.parse(raw); } catch { return json({error:'数据格式不正确'}, 400); }
        const state = await readState(env.DB);
        if (!state) return json({error:'博客数据尚未初始化'}, 503);
        const version = request.headers.get('If-Match');
        if (version !== `"${state.revision}"` && version !== `W/"${state.revision}"`) return json({error:'内容已在其他设备更新，请刷新后重试'}, 409);
        try {
          const updated = applyMutation(state.data, payload);
          await protectContentAssets(env, updated, payload);
          await writeState(env.DB, state.revision, updated);
          return json({ok:true});
        } catch (error) { return json({error:error.message || '保存失败'}, 400); }
      }
      if (path === '/auth/logout' && request.method === 'POST') {
        if (!trustedOrigin(request, env)) return json({error:'请求来源无效'}, 403);
        return json({ok:true}, 200, {'Set-Cookie':`${SESSION_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`});
      }
      if (path.startsWith('/api/') || path.startsWith('/auth/') || path.startsWith('/personal/') || path.startsWith('/private/') || path.startsWith('/public/')) return new Response('Not found', {status:404});
      return env.ASSETS.fetch(request);
    } catch { return json({error:'服务暂时不可用，请稍后重试'}, 500); }
  },
};
