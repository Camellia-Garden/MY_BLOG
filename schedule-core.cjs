// Schedule projection is deterministic: reading never writes the database.
function materializeDue(data, now = Date.now()) {
  for (const [key, type] of [['posts','post'],['moments','moment'],['albums','album'],['projects','project']]) {
    for (const item of data[key] || []) {
      if (!item || !item.scheduledAt) continue;
      const when = Date.parse(item.scheduledAt);
      if (!Number.isFinite(when) || when > now) continue;
      const shifted = new Date(when + 8 * 3600000).toISOString();
      const at = shifted.slice(0,10) + ' ' + shifted.slice(11,16);
      item.date = type === 'album' ? at.slice(0,10) : at;
      const id = item.scheduledId;
      delete item.scheduledAt; delete item.scheduledId;
      if (item.private) continue;
      data.activity ||= {}; data.activityLog ||= [];
      data.activity[at.slice(0,10)] = (Number(data.activity[at.slice(0,10)]) || 0) + 1;
      const event = {id,at,type,action:'create',title:type === 'moment' ? String(item.text || '').slice(0,100) : item.title};
      if (type === 'post') { event.slug = item.slug; event.section = item.section; }
      if (type === 'moment') event.momentId = item.id;
      if (type === 'project') event.projectId = item.id;
      if (type === 'album') event.albumId = item.id;
      data.activityLog.unshift(event);
    }
  }
  return data;
}
module.exports = {materializeDue};
