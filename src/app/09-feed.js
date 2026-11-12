/* The feed: posts, comments and reactions. */

function postCard(p, opt = {}){
  const likes = Store.all('reactions').filter(x => x.postId === p.id);
  const mine = likes.some(x => x.pid === Store.myPid);
  const cs = Store.all('comments').filter(c => c.postId === p.id).sort((a, b) => a.ts - b.ts);
  const open = ui.openComments.has(p.id);
  const tr = p.trade ? `<div class="chip"><span class="tag ${p.trade.side === 'buy' ? 'blue' : 'ember'}">${p.trade.side === 'buy' ? 'Bought' : 'Sold'}</span><a href="#/stock/${esc(p.trade.sym)}" class="sym">${esc(p.trade.sym)}</a><span class="num">${shs(p.trade.shares)} @ ${usd(p.trade.price)}</span>${p.groupTrade ? '<span class="muted small">group trade</span>' : ''}</div>` : '';
  const fresh = ui.lastSeenPost && p.ts > ui.lastSeenPost && p.pid !== Store.myPid ? ' fresh' : '';
  return `<article class="post${fresh}"><div class="meta">${avatar(p.pid, 'sm')}<div class="grow">${nameLink(p.pid)}${sampleTag(p.pid)} <span class="muted small">${ago(p.ts)}</span>${opt.showGroup && p.groupId && Store.get('groups', p.groupId) ? ` <span class="muted small">in <a href="#/group/${p.groupId}">${esc(Store.get('groups', p.groupId).name)}</a></span>` : ''}</div></div>
    ${p.text ? `<div class="body">${linkify(p.text)}</div>` : '<div style="height:10px"></div>'}${tr}
    <div class="bar"><button class="${mine ? 'on' : ''}" data-act="like" data-id="${p.id}" aria-pressed="${mine}">${mine ? '♥' : '♡'} ${likes.length || ''}</button><button data-act="comments" data-id="${p.id}">Comments ${cs.length || ''}</button>${(p.pid === Store.myPid || Store.canEdit) && Store.canWrite ? `<button data-act="delpost" data-id="${p.id}" style="margin-left:auto">Delete</button>` : ''}</div>
    ${open ? `<div class="comments">${cs.map(c => `<div class="small">${nameLink(c.pid)} <span class="muted">${ago(c.ts)}</span>${(c.pid === Store.myPid || Store.canEdit) && Store.canWrite ? ` <button class="linkbtn muted" data-act="delcomment" data-id="${c.id}">Delete</button>` : ''}<div>${linkify(c.text)}</div></div>`).join('') || '<div class="muted small">No comments yet.</div>'}
      ${Store.canWrite && Store.get('profiles', Store.myPid) ? `<div style="display:flex;gap:8px"><input class="input" data-draft="c:${p.id}" placeholder="Add a comment" aria-label="Add a comment"><button class="btn sm" data-act="comment" data-id="${p.id}">Post</button></div>` : ''}</div>` : ''}
  </article>`;
}

function composer(key, placeholder, act, extra = ''){
  if (!Store.canWrite || !Store.get('profiles', Store.myPid)) return '';
  return `<div class="composer">${avatar(Store.myPid, 'sm')}<div class="grow"><textarea class="input" data-draft="${key}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}"></textarea>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px"><span class="hint">Tag a stock with $AAPL</span><button class="btn sm" data-act="${act}" ${extra}>Post</button></div></div></div>`;
}

function stockPosts(sym){
  const me = Store.myPid, myGids = new Set(Store.myGroups().map(g => g.id));
  const following = new Set(Store.all('follows').filter(f => f.from === me).map(f => f.to));
  const mates = new Set(Store.all('memberships').filter(m => myGids.has(m.gid)).map(m => m.pid));
  const known = new Set([...following, ...mates]); known.delete(me);
  const re = new RegExp('\\$' + sym.replace('.', '\\.') + '(?![A-Za-z])');
  const about = Store.all('posts').filter(p => (!p.groupId || myGids.has(p.groupId)) && ((p.trade && p.trade.sym === sym) || re.test(p.text || '')));
  const tab = ui.spTab || (known.size ? 'people' : 'latest'), range = POST_RANGES.find(r => r[0] === ui.spRange) || POST_RANGES[4];
  const since = range[2] === Infinity ? 0 : Date.now() - range[2];
  let list = about.filter(p => p.ts >= since);
  if (tab === 'people') list = list.filter(p => known.has(p.pid)).sort((a, b) => b.ts - a.ts);
  else if (tab === 'liked'){ const likes = {}; Store.all('reactions').forEach(x => { likes[x.postId] = (likes[x.postId] || 0) + 1; }); list = list.filter(p => likes[p.id]).sort((a, b) => (likes[b.id] - likes[a.id]) || (b.ts - a.ts)); }
  else list = list.sort((a, b) => b.ts - a.ts);
  const empty = { people: known.size ? `No posts about ${sym} from people you follow or your group mates ${range[0] === 'all' ? 'yet' : 'in this period'}.` : 'Follow investors or join a group to see what people you know say about ' + sym + '.',
    liked: `No liked posts about ${sym} ${range[0] === 'all' ? 'yet' : 'in this period'}.`, latest: `No posts about ${sym} ${range[0] === 'all' ? 'yet' : 'in this period'}.` }[tab];
  return `<section class="block"><header><h2>What investors are saying</h2></header>
    <nav class="tabs" style="margin-bottom:10px">${[['people','People you know'],['liked','Most liked'],['latest','Latest']].map(([k, l]) => `<a href="#/stock/${encodeURIComponent(sym)}" class="${tab === k ? 'on' : ''}" data-act="sptab" data-k="${k}">${l}</a>`).join('')}</nav>
    <div class="chips sm">${POST_RANGES.map(([k, l]) => `<button class="${range[0] === k ? 'on' : ''}" data-act="sprange" data-k="${k}">${l}</button>`).join('')}</div>
    <div class="list">${list.slice(0, ui.feedLimit).map(p => postCard(p, { showGroup: true })).join('') || `<div class="empty">${esc(empty)}</div>`}</div>
    ${list.length > ui.feedLimit ? '<p style="text-align:center;margin-top:14px"><button class="btn ghost" data-act="more">Show more</button></p>' : ''}</section>`;
}

function vFeed(){
  const following = new Set(Store.all('follows').filter(f => f.from === Store.myPid).map(f => f.to));
  let posts = Store.all('posts').filter(p => !p.groupId);
  if (ui.feedTab === 'following') posts = posts.filter(p => following.has(p.pid) || p.pid === Store.myPid);
  posts.sort((a, b) => b.ts - a.ts);
  const myGids = Store.myGroups().map(g => g.id);
  const suggest = Store.all('profiles').filter(p => p.id !== Store.myPid && !following.has(p.id)).slice(0, 4);
  return `<div class="pagehead"><div><h1>Feed</h1><p class="muted">Ideas and trades from the community.</p></div></div>
  <div class="list">${composer('feed', 'Share an idea or a trade', 'post')}</div>
  <nav class="tabs"><a href="#/feed" class="${ui.feedTab === 'everyone' ? 'on' : ''}" data-act="ftab" data-k="everyone">Everyone</a><a href="#/feed" class="${ui.feedTab === 'following' ? 'on' : ''}" data-act="ftab" data-k="following">Following</a><a href="#/feed" class="${ui.feedTab === 'groups' ? 'on' : ''}" data-act="ftab" data-k="groups">Your groups</a></nav>
  ${ui.feedTab === 'following' && !following.size && suggest.length ? `<section style="margin-bottom:16px"><header class="pagehead" style="margin:0 0 10px"><h3>Investors to follow</h3></header><div class="list">${suggest.map(personRow).join('')}</div></section>` : ''}
  ${ui.feedTab === 'groups'
    ? `<div class="list">${myGids.length ? groupItems(myGids).slice(0, ui.feedLimit).map(it => renderItem(it, true)).join('') || '<div class="empty">No activity in your groups yet.</div>' : '<div class="empty">Join a group to see its trades, posts and votes here. <a href="#/groups">Find a group</a></div>'}</div>`
    : `<div class="list">${posts.slice(0, ui.feedLimit).map(postCard).join('') || '<div class="empty">Nothing here yet. Follow a few investors to fill your feed.</div>'}</div>${posts.length > ui.feedLimit ? '<p style="text-align:center;margin-top:14px"><button class="btn ghost" data-act="more">Show more</button></p>' : ''}`}`;
}

function feedbackSheet(){
  const where = location.hash || '#/home';
  openModal(`<header><h2>Send feedback</h2><button class="x" data-close aria-label="Close">×</button></header><p class="muted" style="margin-top:0">What happened, or what would make this better? We'll note that you were on <b>${esc(where)}</b>.</p>
    <div class="field"><label for="fb-t" class="sr">Feedback</label><textarea class="input" id="fb-t" maxlength="4000" style="min-height:130px" placeholder="Describe what you saw, what you expected, or an idea"></textarea></div><button class="btn" id="fb-go" style="width:100%">Send</button>`, sh => {
    sh.querySelector('#fb-go').onclick = async () => { try { await Store.feedback(sh.querySelector('#fb-t').value, where); closeModal(); toast('Thanks. The Pocket team will read this.'); } catch(e){ errToast(e); } };
  });
}
