(() => {
  const byId = id => document.getElementById(id);
  const profile = byId('profile-form'), posts = byId('post-form'), moments = byId('moment-form'), projects = byId('project-form'), about = byId('about-form'), albums = byId('album-form');
  const notice = byId('notice'); let data, avatar = '', coverWallpaper = '', postCover = '', momentImages = [], albumImages = [], uploading = false;
  const params = new URLSearchParams(location.search);
  if (params.get('embedded') === '1') document.body.classList.add('embedded');
  const message = (text,error=false) => { notice.textContent = text; notice.classList.toggle('error',error); };
  const tags = value => value.split(/[,，]/).map(x => x.trim()).filter(Boolean);
  const preview = () => { const el = byId('avatar-preview'); el.replaceChildren(); if (avatar) { const img = document.createElement('img'); img.src = avatar; img.alt = '头像预览'; el.append(img); } else el.textContent = '✳'; };
  function option(select,value,label) { const item = document.createElement('option'); item.value = value; item.textContent = label; select.append(item); }
  function refreshLists() {
    const ps = posts.elements.selection, ms = moments.elements.selection, rs = projects.elements.selection, as = albums.elements.selection;
    const pv = ps.value, mv = ms.value, rv = rs.value, av = as.value; ps.replaceChildren(); ms.replaceChildren(); rs.replaceChildren(); as.replaceChildren();
    option(ps,'','＋ 新建文章'); data.posts.forEach(p => option(ps,p.slug,p.title));
    option(ms,'-1','＋ 新建动态'); data.moments.forEach((m,i) => option(ms,String(i),`${m.date} · ${m.text.slice(0,30)}`));
    option(rs,'-1','＋ 新建项目'); data.projects.forEach((p,i) => option(rs,String(i),p.title));
    option(as,'-1','＋ 新建相册'); data.albums.forEach((a,i) => option(as,String(i),a.title));
    for (const [select,value] of [[ps,pv],[ms,mv],[rs,rv],[as,av]]) if ([...select.options].some(o => o.value === value)) select.value = value;
  }
  function loadPost() { const p = data.posts.find(item => item.slug === posts.elements.selection.value); for (const key of ['slug','title','category','excerpt','body']) posts.elements[key].value = p?.[key] || ''; posts.elements.tags.value = (p?.tags || []).join(', '); posts.elements.section.value = p ? (p.section === 'talk' ? 'talk' : 'posts') : (params.get('section') === 'talk' ? 'talk' : 'posts'); posts.elements.slug.readOnly = !!p; postCover = p?.cover || ''; byId('delete-post').hidden = !p; imagePreviews(); }
  function loadMoment() { const m = data.moments[Number(moments.elements.selection.value)]; moments.elements.text.value = m?.text || ''; moments.elements.mood.value = m?.mood || ''; moments.elements.tags.value = (m?.tags || []).join(', '); momentImages = [...(m?.images || [])]; byId('delete-moment').hidden = !m; imagePreviews(); }
  function loadAlbum() { const a = data.albums[Number(albums.elements.selection.value)]; albums.elements.title.value = a?.title || ''; albums.elements.description.value = a?.description || ''; albumImages = [...(a?.images || [])]; byId('delete-album').hidden = !a; imagePreviews(); }
  function imagePreviews() {
    for (const [id, paths] of [['post-cover-preview', postCover ? [postCover] : []], ['moment-image-preview', momentImages], ['album-image-preview', albumImages]]) {
      const root = byId(id); root.replaceChildren();
      paths.forEach((path,index) => { const item = document.createElement('div'); item.className = 'image-preview'; const img = document.createElement('img'); img.src = path; img.alt = id === 'album-image-preview' ? `查看并旋转照片 ${index + 1}` : '图片预览'; if (id === 'album-image-preview') { img.tabIndex = 0; img.setAttribute('role','button'); img.addEventListener('click', () => openAlbumPhoto(index)); img.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAlbumPhoto(index); } }); } const button = document.createElement('button'); button.type = 'button'; button.textContent = '移除'; button.setAttribute('aria-label', `移除图片 ${index + 1}`); button.addEventListener('click', () => { if (id === 'post-cover-preview') postCover = ''; else if (id === 'moment-image-preview') momentImages.splice(index,1); else albumImages.splice(index,1); imagePreviews(); }); item.append(img,button); root.append(item); });
    }
  }
  async function upload(file) {
    if (!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('请选择不超过 10 MB 的 PNG、JPG、WebP 或 GIF 图片');
    const image = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file); });
    const res = await fetch('/api/image',{method:'POST',headers:{'Content-Type':'application/json','X-Blog-Editor':'1'},body:JSON.stringify({image})}); const result = await res.json(); if (!res.ok) throw new Error(result.error || '图片上传失败'); return result.url;
  }
  async function uploadFiles(input, callback) {
    if (uploading) return; uploading = true; const buttons = document.querySelectorAll('button[type=submit]'); buttons.forEach(button => button.disabled = true); message('正在添加图片…');
    try { for (const file of input.files) await callback(await upload(file)); message('图片已添加，请保存内容。'); } catch(error) { message(error.message,true); } finally { input.value = ''; uploading = false; buttons.forEach(button => button.disabled = button.form === moments && !byId('moment-service-warning').hidden); }
  }
  const postFormatTools = document.querySelector('.post-format-tools');
  postFormatTools.addEventListener('mousedown', event => { if (event.target.closest('button')) event.preventDefault(); });
  postFormatTools.addEventListener('click', event => {
    const button = event.target.closest('button[data-post-format]'); if (!button) return;
    const field = posts.elements.body, position = field.selectionStart;
    const start = position === 0 ? 0 : field.value.lastIndexOf('\n', position - 1) + 1;
    const endAt = field.value.indexOf('\n', position), end = endAt < 0 ? field.value.length : endAt;
    const line = field.value.slice(start, end).replace(/^#{1,3}\s+/, '');
    const level = Number(button.dataset.postFormat), prefix = level ? '#'.repeat(level) + ' ' : '';
    field.setRangeText(prefix + line, start, end, 'end'); field.focus();
  });
  byId('post-cover-file').addEventListener('change', e => uploadFiles(e.target, async url => { postCover = url; imagePreviews(); }));
  byId('remove-post-cover').addEventListener('click', () => { postCover = ''; imagePreviews(); });
  byId('post-image-file').addEventListener('change', e => { const field = posts.elements.body; let position = field.selectionStart; uploadFiles(e.target, async url => { const value = `\n![文章图片](${url})\n`; field.setRangeText(value, position, position, 'end'); position += value.length; }); });
  byId('moment-image-file').addEventListener('change', e => { if (momentImages.length + e.target.files.length > 9) { message('一条动态最多添加 9 张图片',true); e.target.value = ''; return; } uploadFiles(e.target, async url => { momentImages.push(url); imagePreviews(); }); });
  const ALBUM_TARGET_BYTES = 5 * 1024 * 1024;
  function readPhoto(source) {
    return new Promise((resolve,reject) => { const image = new Image(); const temporary = source instanceof Blob ? URL.createObjectURL(source) : ''; image.onload = () => { if (temporary) URL.revokeObjectURL(temporary); resolve(image); }; image.onerror = () => { if (temporary) URL.revokeObjectURL(temporary); reject(new Error('无法读取这张图片，请换用 JPG、PNG 或 WebP')); }; image.src = temporary || source; });
  }
  function canvasBlob(canvas, type, quality) { return new Promise((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片处理失败')),type,quality)); }
  async function encodePhoto(image, type, rotation = 0) {
    let width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height) throw new Error('无法读取图片尺寸');
    const maxPixels = 24000000, maxSide = 10000;
    let scale = Math.min(1, Math.sqrt(maxPixels / (width * height)), maxSide / Math.max(width,height));
    const preserveAlpha = type === 'image/png' || type === 'image/webp';
    const outputType = preserveAlpha ? 'image/webp' : 'image/jpeg';
    const turn = ((rotation % 360) + 360) % 360;
    for (let attempt = 0; attempt < 7; attempt++) {
      const w = Math.max(1,Math.round(width * scale)), h = Math.max(1,Math.round(height * scale));
      const canvas = document.createElement('canvas'); canvas.width = turn % 180 ? h : w; canvas.height = turn % 180 ? w : h;
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('设备无法处理这张图片');
      ctx.translate(canvas.width / 2,canvas.height / 2); ctx.rotate(turn * Math.PI / 180); ctx.drawImage(image,-w / 2,-h / 2,w,h);
      for (const quality of [.92,.85,.78,.7]) { const blob = await canvasBlob(canvas,outputType,quality); if (blob.size && blob.size <= ALBUM_TARGET_BYTES) { canvas.width = 1; canvas.height = 1; return blob; } if (blob.type === 'image/png') break; }
      canvas.width = 1; canvas.height = 1; scale *= .82;
    }
    throw new Error('图片过大，自动压缩失败，请换一张图片');
  }
  async function prepareAlbumPhoto(file) {
    const type = String(file.type || '').toLowerCase();
    if (type === 'image/gif') { if (file.size > ALBUM_TARGET_BYTES) throw new Error('GIF 动图超过 5 MB，暂不支持自动压缩以免丢失动画'); return file; }
    if (!type.startsWith('image/')) throw new Error('请选择图片文件');
    if (file.size <= ALBUM_TARGET_BYTES && ['image/png','image/jpeg','image/webp'].includes(type)) return file;
    return encodePhoto(await readPhoto(file),type);
  }
  function albumBusy(busy) {
    uploading = busy; albums.elements.selection.disabled = busy; byId('album-image-file').disabled = busy;
    albums.querySelectorAll('#album-image-preview button, #delete-album, .album-photo-actions button').forEach(button => button.disabled = busy);
    document.querySelectorAll('button[type=submit]').forEach(button => button.disabled = busy || (button.form === moments && !byId('moment-service-warning').hidden));
  }
  byId('album-image-file').addEventListener('change', async e => {
    const input = e.target, files = Array.from(input.files); input.value = '';
    if (!files.length || uploading) return;
    if (albumImages.length + files.length > 50) { message('每本相册最多添加 50 张照片',true); return; }
    albumBusy(true); const progress = byId('album-upload-progress'); progress.replaceChildren();
    const rows = files.map(file => { const row = document.createElement('div'); row.textContent = `${file.name}：等待上传`; progress.append(row); return row; });
    const results = Array(files.length); let next = 0;
    async function runQueue() { while (next < files.length) { const index = next++, file = files[index]; try { rows[index].textContent = `${file.name}：处理中…`; const prepared = await prepareAlbumPhoto(file); rows[index].textContent = `${file.name}：上传中…`; results[index] = await upload(prepared); rows[index].textContent = `${file.name}：已上传${prepared.size < file.size ? '（已压缩）' : ''}`; } catch(error) { rows[index].textContent = `${file.name}：${error.message || '上传失败'}`; } } }
    try { await Promise.all(Array.from({length:Math.min(2,files.length)},runQueue)); albumImages.push(...results.filter(Boolean)); imagePreviews(); const failed = files.length - results.filter(Boolean).length; message(failed ? `已添加 ${files.length - failed} 张，${failed} 张失败；可继续添加，完成后请保存相册。` : `已添加 ${files.length} 张，请保存相册。`,!!failed); }
    finally { albumBusy(false); }
  });
  let albumPhotoIndex = -1, albumPhotoOriginal = '', albumPhotoRotation = 0;
  function openAlbumPhoto(index) { if (uploading || !albumImages[index]) return; albumPhotoIndex = index; albumPhotoOriginal = albumImages[index]; albumPhotoRotation = 0; byId('album-photo-error').hidden = true; byId('album-photo-error').textContent = ''; const image = byId('album-photo-large'); image.src = albumPhotoOriginal; image.style.transform = ''; byId('album-photo-editor').hidden = false; byId('album-rotate-left').focus(); }
  function closeAlbumPhoto() { byId('album-photo-editor').hidden = true; byId('album-photo-large').removeAttribute('src'); albumPhotoIndex = -1; }
  function rotateAlbumPhoto(delta) { albumPhotoRotation = (albumPhotoRotation + delta + 360) % 360; byId('album-photo-large').style.transform = `rotate(${albumPhotoRotation}deg)`; }
  byId('album-rotate-left').addEventListener('click', () => rotateAlbumPhoto(-90));
  byId('album-rotate-right').addEventListener('click', () => rotateAlbumPhoto(90));
  byId('album-rotate-cancel').addEventListener('click',closeAlbumPhoto);
  byId('album-rotate-save').addEventListener('click', async () => {
    if (!albumPhotoRotation) { closeAlbumPhoto(); return; }
    if (/\.gif(?:$|[?#])/i.test(albumPhotoOriginal)) { message('GIF 动图暂不支持旋转，以免丢失动画',true); closeAlbumPhoto(); return; }
    const index = albumPhotoIndex, original = albumPhotoOriginal, rotation = albumPhotoRotation; albumBusy(true); message('正在处理照片方向…');
    try { const response = await fetch(original); if (!response.ok) throw new Error('无法读取原照片'); const source = await response.blob(); if (source.type === 'image/gif') throw new Error('GIF 动图暂不支持旋转，以免丢失动画'); const result = await encodePhoto(await readPhoto(source),source.type,rotation); const url = await upload(result); if (albumImages[index] !== original) throw new Error('相册已变化，请重新操作'); albumImages[index] = url; closeAlbumPhoto(); imagePreviews(); message('照片已旋转，请保存相册。'); }
    catch(error) { const errorBox = byId('album-photo-error'); errorBox.textContent = error.message || '旋转失败'; errorBox.hidden = false; message(error.message || '旋转失败',true); }
    finally { albumBusy(false); }
  });
  let projectFiles = [];
  function showProjectFiles() { const root = byId('project-file-list'); root.replaceChildren(); projectFiles.forEach((file,index) => { const row = document.createElement('p'); const name = document.createElement('span'); name.textContent = file.name + ' '; const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button'; button.textContent = '移除'; button.addEventListener('click',() => { projectFiles.splice(index,1); showProjectFiles(); }); row.append(name,button); root.append(row); }); }
  function loadProject() { const p = data.projects[Number(projects.elements.selection.value)]; for (const key of ['title','description','category','url','details','instructions']) projects.elements[key].value = p?.[key] || ''; projectFiles = Array.isArray(p?.files) ? p.files.map(file => ({...file})) : []; showProjectFiles(); }
  byId('project-file').addEventListener('change',async event => { const input=event.target; if (uploading) return; if (projectFiles.length + input.files.length > 20) { message('每个项目最多添加 20 个文件',true); input.value=''; return; } uploading=true; const buttons=document.querySelectorAll('button[type=submit]'); buttons.forEach(button => button.disabled=true); message('正在上传项目文件…'); try { for (const file of input.files) { if (!file.size || file.size > 10*1024*1024) throw new Error('文件不能为空且不能超过 10 MB'); const response=await fetch('/api/project-file',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Blog-Editor':'1','X-File-Name':encodeURIComponent(file.name)},body:file}); const result=await response.json(); if (!response.ok) throw new Error(result.error || '上传失败'); projectFiles.push({name:result.name,url:result.url}); showProjectFiles(); } message('文件已上传，请保存项目。'); } catch(error) { message(error.message,true); } finally { input.value=''; uploading=false; buttons.forEach(button => button.disabled=button.form === moments && !byId('moment-service-warning').hidden); } });
  async function load() {
    const capability = await fetch('/api/capabilities').then(res => res.ok ? res.json() : null).catch(() => null);
    const moodReady = capability?.momentMood === true; byId('moment-service-warning').hidden = moodReady; moments.querySelector('button[type=submit]').disabled = !moodReady;
    const res = await fetch('/api/data'); if (!res.ok) throw new Error('无法读取博客数据'); data = await res.json();
    const p = data.profile || {}, settings = data.settings || {};
    profile.elements.name.value = p.name || ''; profile.elements.signature.value = p.signature || ''; profile.elements.tags.value = (p.tags || []).join(', '); avatar = p.avatar || ''; preview();
    profile.elements.title.value = settings.title || ''; profile.elements.description.value = settings.description || '';
    profile.elements.coverQuote.value = settings.coverQuote || ''; profile.elements.coverAuthor.value = settings.coverAuthor || ''; coverWallpaper = settings.coverWallpaper || '';
    about.elements.about.value = settings.about || ''; about.elements.github.value = settings.github || ''; about.elements.interests.value = (settings.interests || []).join(', ');
    about.elements.timeline.value = (settings.timeline || []).map(x => `${x.date} | ${x.title} | ${x.text}`).join('\n'); refreshLists();
  }
  async function save(payload) { const res = await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json','X-Blog-Editor':'1'},body:JSON.stringify(payload)}); const result = await res.json(); if (!res.ok) throw new Error(result.error || '保存失败'); if (window.parent !== window) window.parent.postMessage({type:'blog-editor-saved'}, location.origin); await load(); message('已保存，关闭面板后页面会更新。'); }
  function selectPanel(panel) { document.querySelectorAll('.editor-nav button').forEach(b => b.classList.toggle('selected',b.dataset.panel === panel)); document.querySelectorAll('.editor-panel').forEach(p => p.hidden = p.id !== panel); message(''); }
  document.querySelector('.editor-nav').addEventListener('click', e => { const button = e.target.closest('button'); if (button) selectPanel(button.dataset.panel); });
  byId('avatar-file').addEventListener('change', e => { const file = e.target.files[0]; if (!file) return; if (file.size > 1024*1024 || !['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)) { message('请选择不超过 1 MB 的 PNG、JPG、WebP 或 GIF 图片。',true); e.target.value = ''; return; } const reader = new FileReader(); reader.onload = () => { avatar = reader.result; preview(); }; reader.readAsDataURL(file); });
  byId('remove-avatar').addEventListener('click',() => { avatar = ''; byId('avatar-file').value = ''; preview(); });
  byId('cover-file').addEventListener('change', e => { const file=e.target.files[0]; if (!file) return; if(file.size>3*1024*1024 || !['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)){message('请选择不超过 3 MB 的 PNG、JPG、WebP 或 GIF 图片。',true);e.target.value='';return} const reader=new FileReader(); reader.onload=()=>{coverWallpaper=reader.result}; reader.readAsDataURL(file); });
  byId('remove-cover').addEventListener('click',()=>{coverWallpaper='';byId('cover-file').value='';message('已选择默认壁纸，保存后生效。');});
  profile.addEventListener('submit',async e => { e.preventDefault(); try { await save({kind:'profile',name:profile.elements.name.value,signature:profile.elements.signature.value,tags:tags(profile.elements.tags.value),title:profile.elements.title.value,description:profile.elements.description.value,coverQuote:profile.elements.coverQuote.value,coverAuthor:profile.elements.coverAuthor.value,coverWallpaper,avatar}); } catch(error) { message(error.message,true); } });
  posts.elements.selection.addEventListener('change',loadPost); moments.elements.selection.addEventListener('change',loadMoment); projects.elements.selection.addEventListener('change',loadProject); albums.elements.selection.addEventListener('change',loadAlbum);
  posts.addEventListener('submit',async e => { e.preventDefault(); try { const payload = {kind:'post'}; for (const key of ['slug','title','category','excerpt','body','section']) payload[key] = posts.elements[key].value; payload.tags = tags(posts.elements.tags.value); payload.cover = postCover; await save(payload); posts.elements.selection.value = payload.slug; loadPost(); } catch(error) { message(error.message,true); } });
  moments.addEventListener('submit',async e => { e.preventDefault(); if (!byId('moment-service-warning').hidden) { message('请先重新启动博客编辑器。',true); return; } try { const index = Number(moments.elements.selection.value); await save({kind:'moment',index,text:moments.elements.text.value,mood:moments.elements.mood.value,tags:tags(moments.elements.tags.value),images:momentImages}); moments.elements.selection.value = String(index < 0 ? 0 : index); loadMoment(); } catch(error) { message(error.message,true); } });
  byId('delete-post').addEventListener('click',async () => { const p = data.posts.find(item => item.slug === posts.elements.selection.value); if (!p || !confirm(`确定删除文章“${p.title}”？删除后无法从编辑器恢复。`)) return; try { await save({kind:'delete-post',slug:p.slug}); posts.elements.selection.value = ''; loadPost(); message('文章已删除，上传的图片文件保留在本机。'); } catch(error) { message(error.message,true); } });
  byId('delete-moment').addEventListener('click',async () => { const index = Number(moments.elements.selection.value), m = data.moments[index]; if (!m || !confirm('确定删除这条动态？删除后无法从编辑器恢复。')) return; try { await save({kind:'delete-moment',index,date:m.date,text:m.text}); moments.elements.selection.value = '-1'; loadMoment(); message('动态已删除，上传的图片文件保留在本机。'); } catch(error) { message(error.message,true); } });
  byId('delete-album').addEventListener('click',async () => { const index = Number(albums.elements.selection.value), album = data.albums[index]; if (!album || !confirm(`确定删除相册“${album.title}”？删除后无法从编辑器恢复。`)) return; try { await save({kind:'delete-album',index,album}); albums.elements.selection.value = '-1'; loadAlbum(); message('相册已删除，上传的图片文件保留在本机。'); } catch(error) { message(error.message,true); } });
  albums.addEventListener('submit',async e => { e.preventDefault(); try { const index = Number(albums.elements.selection.value); await save({kind:'album',index,title:albums.elements.title.value,description:albums.elements.description.value,images:albumImages}); albums.elements.selection.value = String(index < 0 ? 0 : index); loadAlbum(); } catch(error) { message(error.message,true); } });
  projects.addEventListener('submit',async e => { e.preventDefault(); try { const index = Number(projects.elements.selection.value), payload = {kind:'project',index}; for (const key of ['title','description','category','url','details','instructions']) payload[key] = projects.elements[key].value; payload.files = projectFiles; await save(payload); projects.elements.selection.value = String(index < 0 ? 0 : index); loadProject(); } catch(error) { message(error.message,true); } });
  about.addEventListener('submit',async e => { e.preventDefault(); try { const timeline = about.elements.timeline.value.split('\n').filter(line => line.trim()).map(line => { const [date='',title='',...rest] = line.split('|'); return {date,title,text:rest.join('|')}; }); await save({kind:'about',about:about.elements.about.value,github:about.elements.github.value,interests:tags(about.elements.interests.value),timeline}); } catch(error) { message(error.message,true); } });
  load().then(() => { if (params.get('slug')) posts.elements.selection.value = params.get('slug'); loadPost(); loadMoment(); loadProject(); loadAlbum(); if (['profile','posts','moments','albums','projects','about'].includes(params.get('panel'))) selectPanel(params.get('panel')); }).catch(error => message(error.message,true));
})();
