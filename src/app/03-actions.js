/* The click handler: every data-act button in the app routes through act(). */


/* ---------- actions ---------- */
async function act(el, ev){ /* eslint-disable-line */
  const a = el.dataset.act, id = el.dataset.id;
  const busy = async fn => { el.disabled = true; try { await fn(); } catch(e){ errToast(e); } finally { el.disabled = false; } };
  switch (a){
    case 'start': return authSheet('signup');
    case 'usage-refresh': ui.usage = null; return render();
    case 'watch': return busy(async () => { const r = await Store.toggleWatch(el.dataset.k); toast(r.watching ? `Added ${el.dataset.k} to your watchlist.` : `Removed ${el.dataset.k} from your watchlist.`); });
    case 'starteroff': try { localStorage.setItem('pi_starter_off', '1'); } catch(e){} return render();
    case 'explainoff': { let d = []; try { d = JSON.parse(localStorage.getItem('pi_explain_off') || '[]'); } catch(e){} d.push(el.dataset.k); try { localStorage.setItem('pi_explain_off', JSON.stringify(d)); } catch(e){} return render(); }
    case 'gcat': ui.groupCat = el.dataset.k; return render();
    case 'gtag': ui.groupCat = el.dataset.k; location.hash = '#/groups'; return;
    case 'addsample': return busy(async () => { if (!confirm('Add the new sample investors, groups and history? Nothing will be deleted.')) return; const r = await Store.addSampleData(); toast(r && r.added ? `Added ${r.added} sample items and refreshed the sample investors.` : 'Sample data is already up to date.'); });
    case 'more': ui.feedLimit += 30; return render();
    case 'gofeedgroups': ui.feedTab = 'groups'; location.hash = '#/feed'; return;
    case 'feature': return busy(async () => { await Store.featureGroup(id, el.dataset.k === '1'); toast(el.dataset.k === '1' ? 'Featured in Discover.' : 'Removed from Featured.'); });
    case 'pin': return pinSheet(id);
    case 'tags': return tagsSheet();
    case 'sampleact': return busy(async () => { const cur = Store.settings.sampleActivity || {}; const next = Object.assign({}, cur, { [el.dataset.k]: !cur[el.dataset.k] }); await Store.setSampleActivity(next); toast('Sample activity updated.'); });
    case 'hometab': ui.homeTab = el.dataset.k; if (ui.homeTab === 'real') ui.real = null; return render();
    case 'realrefresh': ui.real = null; return render();
    case 'rtrade': return rTradeSheet();
    case 'rdeposit': return rTransferSheet('in');
    case 'rwithdraw': return rTransferSheet('out');
    case 'rbank': return rBankSheet();
    case 'runbank': return busy(async () => { if (!confirm('Remove this bank account? You can link it again later.')) return; await Store.real.unbank(id); toast('Bank removed.'); loadReal(); });
    case 'rcancel': return busy(async () => { await Store.real.cancel(id); toast('Cancel requested.'); loadReal(); });
    case 'oftest': { if (Store.site.alpacaEnv !== 'sandbox') return; const n = Math.floor(1000 + Math.random() * 8999), me = Store.displayName(Store.myPid).split(' ');
      ui.openForm = { givenName: me[0] || 'Test', familyName: (me.slice(1).join(' ') || 'Investor'), dob: '1990-01-15', ssn: '123-45-' + n, citizenship: 'USA', email: `test+${n}@example.com`, phone: '555-555-' + n,
        street: '20 N San Mateo Dr', unit: '', city: 'San Mateo', state: 'CA', postal: '94401', employment: 'employed', employer: 'Test Company', position: 'Analyst', funding: ['employment_income'],
        controlPerson: false, finraAffiliated: false, politicallyExposed: false, familyExposed: false, agree: false };
      ui.openStep = 3; toast('Test details filled in. Review them, accept the agreements, and submit.'); return render(); }
    case 'ofyn': readOpenForm(); ui.openForm[el.dataset.k] = el.dataset.v === '1'; return render();
    case 'ofback': readOpenForm(); ui.openStep = Math.max(0, (ui.openStep || 0) - 1); return render();
    case 'ofnext': { const f = readOpenForm(), st = ui.openStep || 0, err = m => { $('#o-err').textContent = m; };
      if (st === 0){ if (!f.givenName || !f.familyName) return err('Add your legal first and last name.'); if (!f.dob) return err('Add your date of birth.'); if (String(f.ssn || '').replace(/\D/g, '').length !== 9) return err('Enter your 9-digit Social Security number.'); }
      if (st === 1){ if (!f.email || !f.phone || !f.street || !f.city) return err('Fill in your contact details.'); if (!/^[A-Za-z]{2}$/.test(f.state || '')) return err('Use the two-letter state code, like CT.'); if (!/^\d{5}(-\d{4})?$/.test(f.postal || '')) return err('Enter a valid ZIP code.'); }
      if (st === 2 && !(f.funding || []).length) return err('Choose at least one source of money.');
      ui.openStep = st + 1; return render(); }
    case 'ofsubmit': return busy(async () => { const f = readOpenForm(); if (!f.agree){ $('#o-err').textContent = 'Please accept the agreements to continue.'; return; }
      const r = await Store.real.open(f); ui.openForm = null; ui.openStep = 0; ui.real = null; ui.homeTab = 'real'; toast('Application submitted: ' + r.label + '.'); location.hash = '#/portfolio'; });
    case 'tfsetup': return busy(async () => { ui.sec = await Store.twofaSetup(); render(); });
    case 'tfenable': return busy(async () => { const r = await Store.twofaEnable($('#tf-code').value); ui.sec = null; ui.real = null; render(); if (r && r.backupCodes) backupCodesSheet(r.backupCodes, true); else toast('Two-step sign-in is on.'); });
    case 'tfbackup': return busy(async () => { const r = await Store.http('POST', '/api/2fa/backup', { code: ($('#tf-bk') || {}).value }); backupCodesSheet(r.backupCodes, false); ui.bkLeft = null; });
    case 'tfoff': return busy(async () => { await Store.twofaDisable($('#tf-off').value); toast('Two-step sign-in is off.'); render(); });
    case 'amdreload': ui.amd = null; return render();
    case 'amdcheck': ui.amdCheck = 'loading'; render(); return Store.http('POST', '/api/admin/marketdata/check').then(r => { ui.amdCheck = r.steps; ui.amd = null; render(); }, e => { ui.amdCheck = [{ name: 'Check', ok: false, ms: 0, detail: e.message }]; render(); });
    case 'amdfetch': return busy(async () => { const r = await Store.http('POST', '/api/admin/marketdata/fetch'); toast(r.status && r.status.error && !r.status.received ? 'News fetch failed. See the error below.' : `Fetched news: ${r.added} new headline${r.added === 1 ? '' : 's'}.`); ui.amd = null; render(); });
    case 'recon': ui.recon = 'loading'; render(); return Store.http('GET', '/api/admin/real/reconcile').then(r => { ui.recon = r; render(); }, e => { ui.recon = { error: e.message }; render(); });
    case 'reconfix': return busy(async () => { if (!confirm('Copy statuses from Alpaca into the app for the flagged items? Nothing is created, deleted or moved.')) return; const r = await Store.http('POST', '/api/admin/real/reconcile/apply'); toast(`Updated ${r.fixed} record${r.fixed === 1 ? '' : 's'} from Alpaca.`); ui.recon = 'loading'; render(); ui.recon = await Store.http('GET', '/api/admin/real/reconcile'); render(); });
    case 'anchor': return busy(async () => { if (!confirm('Update simulated prices to start from real closing prices? Prices that have drifted far will jump, which changes everyone’s gains and losses in the demo.')) return; const r = await Store.http('POST', '/api/admin/prices/anchor'); toast(`Updated ${r.count} prices to real closes${r.sample ? ' (' + r.sample + ')' : ''}.`); ui.amd = null; ui.anchorInfo = null; });
    case 'anchorauto': return busy(async () => { await Store.http('POST', '/api/admin/prices/auto', { on: el.dataset.k === '1' }); toast(el.dataset.k === '1' ? 'Prices will update to real closes each morning.' : 'Automatic price updates are off.'); ui.anchorInfo = null; render(); });
    case 'amdfilings': return busy(async () => { const r = await Store.http('POST', '/api/admin/marketdata/filings'); toast(r.status && r.status.error && !r.status.checked ? 'SEC request failed. See the error below.' : `Fetched SEC filings: ${r.added} new.`); ui.amd = null; render(); });
    case 'arpause': return busy(async () => { await Store.http('POST', '/api/admin/real/pause', { paused: el.dataset.k === '1' }); ui.areal = null; toast(el.dataset.k === '1' ? 'Real-money trading paused.' : 'Real-money trading running.'); render(); });
    case 'annoff': try { localStorage.setItem('pi_ann_off', el.dataset.k); } catch(e){} return render();
    case 'feedback': return feedbackSheet();
    case 'chpw': return pwSheet();
    case 'delacct': return deleteSheet();
    case 'suggest': return suggestSheet(id);
    case 'sgyes': return busy(async () => { const r = await Store.decideSuggestion(id, true); toast(r && r.held ? 'Approved and traded. Held for Risk Manager review.' : `Approved and traded. ${r ? r.sent : 0} member${r && r.sent === 1 ? '' : 's'} asked to approve.`); });
    case 'sgno': return busy(async () => { await Store.decideSuggestion(id, false); toast('Suggestion declined.'); });
    case 'rvrelease': return busy(async () => { const n = await Store.releaseReview(id); toast(`Released. ${n} member${n === 1 ? '' : 's'} asked to approve.`); });
    case 'rvpause': return busy(async () => { const reason = prompt('Why pause this trade? Members will see this with the vote.', 'Position looks large for current volatility.'); if (reason === null) return; await Store.pauseReview(id, reason); toast('Paused. The group votes on whether to copy it.'); });
    case 'editrules': return rulesSheet(id);
    case 'rmmember': return busy(async () => { if (!confirm('Remove ' + Store.displayName(el.dataset.pid) + ' from the group?')) return; await Store.removeMember(el.dataset.gid, el.dataset.pid); toast('Member removed.'); });
    case 'xfer': return busy(async () => { const pid = $('#xfer').value; if (!confirm('Make ' + Store.displayName(pid) + ' the Owner? You will become an Admin.')) return; await Store.transferOwnership(el.dataset.gid, pid); toast('Ownership transferred.'); });
    case 'pushon': return busy(async () => { await pushOn(); ui.pushState = 'on'; toast('Notifications are on for this device.'); render(); });
    case 'pushoff': return busy(async () => { await pushOff(); ui.pushState = 'off'; toast('Notifications are off for this device.'); render(); });
    case 'pushtest': return busy(async () => { const r = await Store.http('POST', '/api/push/test'); toast(r.sent ? 'Test sent. It should arrive in a few seconds.' : 'No devices are set up for alerts yet.'); });
    case 'savenotif': return busy(async () => {
      const c = id => { const e = document.getElementById(id); return e ? e.checked : true; };
      const muted = Store.myGroups().filter(g => !c('n-g-' + g.id)).map(g => g.id);
      await Store.setNotifPrefs({ weeklyRecap: $('#n-wr') ? c('n-wr') : true, approvals: c('n-ap'), votes: c('n-vo'), social: c('n-so'), news: $('#n-nw') ? c('n-nw') : false, approvalsInQuiet: c('n-aq'), mutedGroups: muted, quiet: { on: c('n-qon'), start: $('#n-qs').value, end: $('#n-qe').value }, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
      toast('Notification settings saved.');
    });
    case 'adm-spend': return busy(async () => { const m = document.getElementById('ms-m').value, amt = Number(document.getElementById('ms-a').value); await Store.http('POST', '/api/admin/metrics/adspend', { month: m, amount: amt }); ui.ametrics = null; toast('Ad spend saved.'); render(); });
    case 'adm-utm': { const s = (document.getElementById('mu-s').value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''); if (!s){ toast('Name the source first, like instagram.'); return; }
      const link = location.origin + '/?utm_source=' + s + '&utm_medium=' + (document.getElementById('mu-p').checked ? 'paid' : 'referral') + '&utm_campaign=beta'; document.getElementById('mu-l').value = link; try { navigator.clipboard.writeText(link); toast('Link copied.'); } catch(e){} return; }
    case 'adm-tab': ev.preventDefault(); ui.adminTab = el.dataset.k; ui.ametrics = null; ui.adocs = null; ui.areq = null; ui.alog = null; ui.atest = null; ui.arepl = null; ui.areal = null; ui.amd = null; ui.amdCheck = null; return render();
    case 'adm-refresh': ui.admin = null; ui.ametrics = null; return render();
    case 'adm': return busy(async () => {
      const op = el.dataset.op;
      if (op === 'disable' && !confirm('Turn off this account? They will be signed out and unable to sign in.')) return;
      if (op === 'reset2fa' && !confirm(`Reset two-step sign-in for @${el.dataset.n}?\n\nFirst confirm it's really them: a video call, or matching their name, email and account details, through a channel you already know is theirs.\n\nTheir withdrawals and bank changes will be paused for 48 hours, and they'll get a security alert.`)) return;
      const r = await Store.http('POST', '/api/admin/user', { userId: id, op });
      if (op === 'reset'){ openModal(`<header><h2>Reset code</h2><button class="x" data-close aria-label="Close">×</button></header><p>Give this code to <b>@${esc(el.dataset.n)}</b>. It works once, for 24 hours. They choose "Forgot your password?" on the sign-in screen.</p><div class="est"><b class="num" style="font-size:24px;letter-spacing:2px">${esc(r.code)}</b></div>`); }
      else toast(op === 'reset2fa' ? 'Two-step reset. They set it up again at next sign-in; money moves are paused 48 hours.' : 'Updated.');
      await loadAdmin();
    });
    case 'adm-newinv': return newInviteSheet();
    case 'adm-invtoggle': return busy(async () => { await Store.http('POST', '/api/admin/invite', { code: el.dataset.k, op: 'toggle' }); await loadAdmin(); });
    case 'rcopy': return busy(async () => { const k = el.dataset.k; const r = await Store.real.decideCopy(el.dataset.id, k === 'decline' ? 'decline' : 'approve', k === 'half' ? 'half' : 'full'); ui.realReq = null; ui.real = null; toast(k === 'decline' ? 'Declined.' : 'Order placed in your brokerage account.'); render(); });
    case 'actstop': return busy(async () => { await Store.http('POST', '/api/act-as/stop', {}); location.hash = '#/admin'; location.reload(); });
    case 'adm-actas': return busy(async () => { await Store.http('POST', '/api/admin/act-as', { userId: el.dataset.id }); location.hash = '#/portfolio'; location.reload(); });
    case 'adm-mktest': return busy(async () => { const r = await Store.http('POST', '/api/admin/test-accounts', { count: +$('#tt-n').value, deposit: +$('#tt-d').value }); ui.atest = null; toast(`Created ${r.made.length} test account${r.made.length === 1 ? '' : 's'}. Brokerage approval, bank and deposit finish in the background.`); render(); });
    case 'navexplore': ui.exploreTab = 'market'; if (location.hash === '#/explore') return render(); location.hash = '#/explore'; return;
    case 'search': return searchSheet();
    case 'alertsheet': return alertSheet(el.dataset.k);
    case 'alertdel': return busy(async () => { await Store.http('POST', '/api/alerts', { remove: el.dataset.id }); ui.alerts = null; render(); });
    case 'alertprefs': return busy(async () => { await Store.http('POST', '/api/alerts', { prefs: true, watchMoves: $('#al-w').checked, threshold: +$('#al-t').value }); ui.alerts = null; toast('Saved.'); render(); });
    case 'startover': if (!confirm('Start over with $100,000 in practice cash? Your practice positions are cleared and your track record restarts today. Posts, groups and follows stay.')) return; return busy(async () => { await Store.startOver(); toast('Your practice account is back to $100,000.'); location.hash = '#/portfolio'; });
    case 'copystop': return copyStopSheet({ gid: el.dataset.gid || null, pid: el.dataset.id || null });
    case 'extab': ui.exploreTab = el.dataset.k; if (location.hash !== '#/explore') location.hash = '#/explore'; return render();
    case 'exmovers': ui.exMovers = el.dataset.k; return render();
    case 'exsector': ui.exSector = el.dataset.k && ui.exSector !== el.dataset.k ? el.dataset.k : null; return render();
    case 'adm-event': return busy(async () => { await Store.http('POST', '/api/admin/market-events', { date: $('#ev-d').value, title: $('#ev-t').value, syms: $('#ev-s').value, note: $('#ev-n').value }); ui.exploreTs = 0; toast('Event added to Explore.'); render(); });
    case 'adm-evdel': return busy(async () => { await Store.http('POST', '/api/admin/market-events', { remove: el.dataset.id }); ui.exploreTs = 0; render(); });
    case 'adm-ro': { const on = el.dataset.k === '1'; if (on && !confirm('Turn on read-only mode for everyone?')) return; return busy(async () => { await Store.http('POST', '/api/admin/maintenance', { on, message: on ? (document.getElementById('adm-ro-m') || {}).value : '' }); await Store.refreshMe(); toast(on ? 'Read-only mode is on.' : 'Read-only mode is off.'); render(); }); }
    case 'onboff': try { localStorage.setItem('pi_onb_off', Store.myPid); } catch(e){} return render();
    case 'adm-reqinvite': return busy(async () => { const r = ui.areq.find(x => String(x.id) === String(id)); const inv = await Store.http('POST', '/api/admin/invite', { label: ('Website: ' + (r.name || r.email)).slice(0, 60), maxUses: 1 });
      const code = inv.code || (inv.invite || {}).code; await Store.http('POST', '/api/admin/waitlist/invited', { id: r.id, code }); r.invited_code = code; r.invited_at = new Date().toISOString(); ui.admin = null; toast('Invite created. Copy the message to send it.'); render(); });
    case 'adm-reqcopy': { const r = ui.areq.find(x => String(x.id) === String(id)), link = location.origin + '/#/signup/' + r.invited_code;
      const text = `Hi ${(r.name || '').split(' ')[0] || 'there'},\n\nHere's your invite to the Pocket Investing beta: ${link}\n\nThe beta uses practice money, so you can try everything with nothing at risk. Reply to this email with any questions.\n\nAndrew`;
      try { await navigator.clipboard.writeText(text); toast('Invite message copied.'); } catch(e){ prompt('Copy this message:', text); } return; }
    case 'adm-copylink': { const link = location.origin + '/#/signup/' + el.dataset.k; try { await navigator.clipboard.writeText(link); toast('Sign-up link copied.'); } catch(e){ prompt('Copy this sign-up link:', link); } return; }
    case 'adm-fb': return busy(async () => { await Store.http('POST', '/api/admin/feedback', { id }); await loadAdmin(); });
    case 'adm-errclear': return busy(async () => { if (!confirm('Clear all error reports?')) return; await Store.http('POST', '/api/admin/errors/clear'); await loadAdmin(); });
    case 'adm-io': return busy(async () => { await Store.http('POST', '/api/admin/settings', { inviteOnly: el.dataset.k === '1' }); await loadAdmin(); toast('Saved.'); });
    case 'adm-ann': return busy(async () => { await Store.http('POST', '/api/admin/settings', { announcement: $('#adm-ann').value }); await loadAdmin(); toast('Announcement posted.'); });
    case 'adm-annclear': return busy(async () => { await Store.http('POST', '/api/admin/settings', { announcement: '' }); await loadAdmin(); toast('Announcement removed.'); });
    case 'demorelease': return busy(async () => { const r = await Store.demoReview(el.dataset.gid, 'release'); toast(`Risk Manager released the trade. ${r.sent} member${r.sent === 1 ? '' : 's'} asked to approve.`); });
    case 'demopause': return busy(async () => { await Store.demoReview(el.dataset.gid, 'pause'); toast('Risk Manager paused the trade. The group is voting.'); });
    case 'signin': ev.preventDefault(); return authSheet('login');
    case 'invsignup': case 'invsignin': try { sessionStorage.setItem('pi_after_auth', el.dataset.k); } catch(e){} return authSheet(a === 'invsignup' ? 'signup' : 'login');
    case 'signout': return busy(async () => { await Store.logout(); ui.seenReqs = null; toast('Signed out.'); location.hash = '#/home'; });
    case 'delpost': return busy(async () => { if (!confirm('Delete this post?')) return; await Store.deletePost(id); toast('Post deleted.'); });
    case 'delcomment': return busy(async () => { if (!confirm('Delete this comment?')) return; await Store.deleteComment(id); toast('Comment deleted.'); });
    case 'trade': ev.preventDefault();
      if (Store.site.realMoney){ const R = ui.real;
        if (R && R.account && R.account.status === 'ACTIVE' && R.balances) return rTradeSheet(el.dataset.sym || 'AAPL', el.dataset.side || 'buy');
        if (R && !R.account){ toast('Open your brokerage account first.'); location.hash = '#/portfolio'; return; }
        toast('Loading your brokerage account…'); location.hash = '#/portfolio'; if (!R) loadReal(); return; }
      if (!Store.get('portfolios', Store.myPid)) return toast('Create your demo account first.'); return tradeSheet({ sym: el.dataset.sym, side: el.dataset.side, gid: el.dataset.gid });
    case 'cfrac': ui.copyFrac[id] = +el.dataset.k; return render();
    case 'cancelq': return busy(async () => { if (!confirm('Cancel this order before the open?')) return; await Store.cancelQueued(id); toast('Order cancelled. Nothing will fill at the open.'); });
    case 'approve': return busy(async () => { const r = await Store.approve(id, ui.copyFrac[id] || 1); toast(r.queued ? 'Approved. It fills at the next market open.' : r.trade ? (r.trade.frac < 0.995 && !r.trade.partial ? `Copied ${fracWord(r.trade.frac)}: ${r.trade.side === 'buy' ? 'bought' : 'sold'} ${shs(r.trade.shares)} ${r.trade.sym} at ${usd(r.trade.price)}.` : r.trade.partial ? `Partly copied: ${r.trade.side === 'buy' ? 'bought' : 'sold'} ${shs(r.trade.shares)} of ${shs(r.trade.requested)} ${r.trade.sym}. Not enough ${r.trade.side === 'buy' ? 'cash' : 'shares'} for the full amount.` : `Copied: ${r.trade.side === 'buy' ? 'bought' : 'sold'} ${shs(r.trade.shares)} ${r.trade.sym} at ${usd(r.trade.price)}.`) : 'Not enough cash or shares to copy this trade.'); });
    case 'decline': return busy(async () => { await Store.decline(id); toast('Declined. Nothing changed in your account.'); });
    case 'like': return busy(() => Store.toggleLike(id));
    case 'comments': ui.openComments.has(id) ? ui.openComments.delete(id) : ui.openComments.add(id); return render();
    case 'comment': return busy(async () => { await Store.comment(id, ui.drafts['c:' + id]); ui.drafts['c:' + id] = ''; });
    case 'post': return busy(async () => { await Store.post(ui.drafts.feed); ui.drafts.feed = ''; toast('Posted.'); });
    case 'gpost': return busy(async () => { const k = 'g:' + el.dataset.gid; await Store.post(ui.drafts[k], el.dataset.gid); ui.drafts[k] = ''; });
    case 'ftab': ev.preventDefault(); ui.feedTab = el.dataset.k; return render();
    case 'span': ui.chartSpan = el.dataset.k; ui.ichSel = {}; return render();
    case 'pfspan': ui.pfSpan = el.dataset.k; ui.ichSel = {}; return render();
    case 'ichclear': delete ui.ichSel[el.dataset.k]; return ichRestore();
    case 'sptab': ev.preventDefault(); ui.spTab = el.dataset.k; ui.feedLimit = 30; return render();
    case 'sprange': ui.spRange = el.dataset.k; ui.feedLimit = 30; return render();
    case 'follow': return busy(() => Store.follow(id));
    case 'unfollow': return busy(() => Store.unfollow(id));
    case 'join': if (!Store.isPro() || (!Store.membership(id) && Store.rulesOf(Store.get('groups', id)).rulesText)) return joinSheet(id); return busy(async () => { await Store.join(id, 'member', { code: ui.inviteFor === id ? ui.inviteCode : undefined, by: ui.inviteFor === id ? ui.inviteBy : undefined }); toast('You joined as a member. Group trades will ask for your approval.'); });
    case 'upgrade': return upgradeSheet();
    case 'cancelpro': return busy(async () => { if (!confirm('Cancel Pro? Group memberships become observer and copying stops.')) return; await Store.cancelPro(); toast('Pro cancelled. You are on the free plan.'); });
    case 'copyonce': { const o = el.dataset.gid ? { gid: el.dataset.gid } : { pid: id }; if (!Store.isPro()) return upgradeSheet(() => copyOnceSheet(o)); return copyOnceSheet(o); }
    case 'cbsetup': return busy(async () => { const gid = el.dataset.gid; ui.club[gid] = await Store.http('POST', `/api/club/${gid}/setup`, { startDate: document.getElementById('cb-d').value, dues: document.getElementById('cb-u').value }); ui.club[gid].canEdit = true; toast('Club books started.'); render(); });
    case 'cbentry': return clubEntrySheet(el.dataset.gid, el.dataset.k);
    case 'taxup': return taxUploadSheet(el.dataset.gid);
    case 'taxsummary': return busy(async () => { const y = el.dataset.k, qy = `kind=personal&from=${y}-01-01&to=${y}-12-31&label=${encodeURIComponent('Year-end summary ' + y + ' (practice)')}`; const r = await Store.http('GET', '/api/statements/build?' + qy); ui.stShown = { data: r.statement, links: { pdf: '/api/statements/build.pdf?' + qy, csv: '/api/statements/build.csv?' + qy } }; render(); window.scrollTo(0, 0); });
    case 'stbuild': { const v = id2 => (document.getElementById(id2) || {}).value; ui.stAcc = +v('st-acc') || 0; const P = ui.stP; P.type = v('st-type') || P.type;
      if (v('st-m')) P.month = v('st-m'); if (v('st-q')) P.q = v('st-q'); if (v('st-y')) P.year = v('st-y'); if (v('st-d')) P.asof = v('st-d'); if (v('st-f') != null) P.from = v('st-f') || P.from; if (v('st-t') != null) P.to = v('st-t') || P.to;
      const per = stPeriod(), acc = ui.stList.accounts[ui.stAcc]; if (!per.from || !per.to) { toast('Pick the dates.'); return; }
      return busy(async () => { const qy = stQuery(acc, per); const r = await Store.http('GET', '/api/statements/build?' + qy); ui.stShown = { data: r.statement, links: { pdf: '/api/statements/build.pdf?' + qy, csv: '/api/statements/build.csv?' + qy } }; render(); }); }
    case 'stopen': return busy(async () => { const r = await Store.http('GET', '/api/statements/' + id); ui.stShown = { data: r.statement, links: { pdf: '/api/statements/' + id + '.pdf', csv: '/api/statements/' + id + '.csv' } }; render(); });
    case 'cbupload': return uploadSheet(el.dataset.gid, el.dataset.k);
    case 'cbreview': return reviewSheet(el.dataset.gid, id, el.dataset.k, el.dataset.v);
    case 'potadd': return potSheet(el.dataset.gid, 'add');
    case 'potexit': { const other = el.dataset.pid && el.dataset.pid !== Store.myPid; if (!confirm(other ? `Start an exit payout for ${Store.displayName(el.dataset.pid)}? Their full share is paid out after two approvals, and they leave the club.` : 'Leave the club? Your full share is paid to your portfolio after two approvals, and then you leave.')) return;
      return busy(async () => { const r = await Store.clubRequestExit(el.dataset.gid, el.dataset.pid || undefined); ui.club = {}; ui.cwait = null; toast(r && r.left ? 'Done.' : 'Exit payout requested. Two approvals are needed.'); render(); }); }
    case 'potsellall': if (!confirm('Sell every holding in the club account at market price?')) return; return busy(async () => { const r = await Store.clubLiquidate(el.dataset.gid); ui.club = {}; toast(`Sold ${r.sold} holding${r.sold === 1 ? '' : 's'}.`); render(); });
    case 'potdistribute': return busy(async () => { await Store.clubDistribute(el.dataset.gid); ui.club = {}; toast('Final payout started. It needs two approvals.'); render(); });
    case 'potwd': return potSheet(el.dataset.gid, 'withdraw');
    case 'gwadd': return busy(async () => { const s = (document.getElementById('gw-s').value || '').trim().toUpperCase(); if (!s) throw Object.assign(new Error('Enter a stock symbol.'), { userFacing: true }); if (!Market.MAP[s]) await Store.ensureStock(s); await Store.addGroupWatch(el.dataset.gid, s, document.getElementById('gw-r').value); toast(s + ' added to the group watchlist.'); });
    case 'gwdel': return busy(async () => { await Store.removeGroupWatch(id); });
    case 'study': return studySheet(el.dataset.gid, el.dataset.k, id);
    case 'propsym': return proposalSheet(el.dataset.gid, el.dataset.k);
    case 'newmeeting': return busy(async () => { const d = document.getElementById('mt-d').value; if (!d) throw Object.assign(new Error('Pick a date and time.'), { userFacing: true }); ui.meetingId = await Store.createMeeting({ gid: el.dataset.gid, title: document.getElementById('mt-t').value, ts: new Date(d).getTime() }); toast('Meeting scheduled.'); });
    case 'openmeeting': ui.meetingId = id; return render();
    case 'checkin': return busy(async () => { await Store.meetingCheckIn(id); toast("You're checked in."); });
    case 'meetstart': return busy(async () => { await Store.meetingStatus({ id, status: 'live' }); toast('Meeting started.'); });
    case 'meetend': if (!confirm('End the meeting? You can still edit the minutes afterwards.')) return; return busy(async () => { const t = document.getElementById('mm-t'); await Store.meetingStatus({ id, status: 'ended', minutes: t ? t.value : undefined }); toast('Meeting ended.'); });
    case 'meetsave': return busy(async () => { await Store.meetingStatus({ id, minutes: document.getElementById('mm-t').value }); toast('Minutes saved.'); });
    case 'meetnote': return busy(async () => { await Store.meetingNote(id, document.getElementById('mn-t').value); });
    case 'recurring': if (!Store.get('profiles', Store.myPid)) return authSheet('signup'); return recurringSheet(el.dataset.k);
    case 'recpause': return busy(async () => { await Store.pauseRecurring(el.dataset.k, el.dataset.v === '1'); });
    case 'recdel': if (!confirm('Stop this recurring investment?')) return; return busy(async () => { await Store.deleteRecurring(el.dataset.k); toast('Stopped.'); });
    case 'adm-docreview': { const dec = el.dataset.k; const note = dec === 'declined' ? prompt('What needs to change? The club will see this note.') : (prompt('Note to the club (optional)') || ''); if (dec === 'declined' && !note) return;
      return busy(async () => { await Store.http('POST', '/api/admin/club-docs/review', { id, decision: dec, note }); ui.adocs = null; toast(dec === 'confirmed' ? 'Marked verified.' : 'Sent back with your note.'); render(); }); }
    case 'cbvoid': { const reason = prompt('Why is this entry being voided? Members will see this.'); if (!reason) return; return busy(async () => { const gid = el.dataset.gid; ui.club[gid] = await Store.http('POST', `/api/club/${gid}/void`, { id, reason }); toast('Entry voided. It stays on the ledger, marked as not counted.'); render(); }); }
    case 'cbclose': { const note = prompt('Checked the books against the account statement? Add a note (optional).') ; if (note === null) return; return busy(async () => { const gid = el.dataset.gid; ui.club[gid] = await Store.http('POST', `/api/club/${gid}/close`, { month: el.dataset.k, note }); toast('Month closed. Another officer signs off to lock it.'); render(); }); }
    case 'cbsign': return busy(async () => { const gid = el.dataset.gid; ui.club[gid] = await Store.http('POST', `/api/club/${gid}/signoff`, { month: el.dataset.k }); toast('Signed off. The month is locked.'); render(); });
    case 'cbyrrev': { const note = prompt('Anything to note from your review? (optional)'); if (note === null) return; return busy(async () => { const gid = el.dataset.gid; ui.club[gid] = await Store.http('POST', `/api/club/${gid}/review-year`, { year: el.dataset.k, note }); toast('Thanks. The review is recorded.'); render(); }); }
    case 'cblogall': ui.clubLogAll = true; return render();
    case 'cbyear': ui.clubYear = el.dataset.k; return render();
    case 'copy': if (!Store.isPro()) return upgradeSheet(() => Store.copyInvestor(id).then(() => toast(`You copy ${Store.displayName(id)}. Their trades will ask for your approval.`))); return busy(async () => { await Store.copyInvestor(id); toast(`You copy ${Store.displayName(id)}. Their trades will ask for your approval.`); });
    case 'uncopy': return busy(async () => { await Store.stopCopying(id); toast('Stopped copying.'); });
    case 'report': return reportSheet(id);
    case 'resolvereport': return busy(async () => { await Store.resolveReport(id); toast('Marked as reviewed.'); });
    case 'onb': ui.onb = +el.dataset.k; return render();
    case 'risk': ui.risk = el.dataset.k; return render();
    case 'tipoff': try { localStorage.setItem('pi_install_tip', 'off'); } catch(e){} return render();
    case 'reqjoin': if (Store.rulesOf(Store.get('groups', id)).rulesText) return reqJoinSheet(id); return busy(async () => { await Store.requestJoin(id, true); toast('Request sent. The owner decides who joins.'); });
    case 'joinyes': return busy(async () => { await Store.decideJoin(id, true); toast('Request approved.'); });
    case 'joinno': return busy(async () => { await Store.decideJoin(id, false); toast('Request declined.'); });
    case 'invite': return inviteSheet(id);
    case 'execprop': return busy(async () => { const g = Store.get('groups', Store.get('proposals', id).gid); const role = (Store.membership(g.id) || {}).role; const res = await Store.executeProposal(id, Store.canTradeFor(role) ? Store.myPid : g.leadPid); if (res.role){ toast(`${Store.displayName(res.pid)} is now ${Store.ROLE_LABEL[res.role]}.`); return; } if (res.windDown){ toast('The club is closing. Next: sell holdings, then pay everyone out.'); return; } toast(`Decision executed: ${res.trade.side === 'buy' ? 'bought' : 'sold'} ${shs(res.trade.shares)} ${res.trade.sym}${g.pooled ? ' for the club.' : `. ${res.sent} member${res.sent === 1 ? '' : 's'} asked to approve.`}`); });
    case 'demoexec': return busy(async () => { const res = await Store.executeProposal(id); toast(`${Store.displayName(res.trade.pid)} executed the decision. ${res.sent} member${res.sent === 1 ? '' : 's'} asked to approve.`); });
    case 'demojoins': return busy(async () => { const n = await Store.simulateJoinDecisions(); toast(n ? `${n} request${n === 1 ? '' : 's'} approved by sample owners.` : 'No pending requests to sample-owned groups.'); });
    case 'demoinvites': return busy(async () => { const gid = $('#v-g').value; const n = await Store.simulateInviteJoins(gid, 2); toast(n ? `${n} friend${n === 1 ? '' : 's'} joined from your invite.` : 'All sample friends have already joined.'); });
    case 'resetall': return busy(async () => {
      if (!confirm('Reset the whole demo? Sample data is restored and every account, including yours, starts over with fresh cash. Everyone stays signed in.')) return;
      toast('Resetting the demo…', { ms: 2500 });
      const n = await Store.resetAll(); ui.seenReqs = null; ui.onb = 0; ui.presenter = null; renderPresenter();
      toast(`Demo reset. ${n} sample records restored.`); location.hash = '#/home';
    });
    case 'indtrade': return busy(async () => {
      const pid = $('#i-p').value, sym = $('#i-s').value, side = $('#i-side').value, amt = parseFloat($('#i-amt').value) || 0;
      const shares = Math.floor(amt / Market.price(sym) * 1000) / 1000;
      const t = await Store.personalTrade(pid, sym, side, shares, { share: true, note: $('#i-note').value });
      toast(`${Store.displayName(pid)} ${side === 'buy' ? 'bought' : 'sold'} ${shs(t.shares)} ${sym}. ${t.sent} copier${t.sent === 1 ? '' : 's'} asked to approve.`);
    });
    case 'tour': ui.presenter = null; renderPresenter(); return tourGo(0);
    case 'tnext': return tourGo(ui.tour + 1);
    case 'tback': return tourGo(ui.tour - 1);
    case 'texit': return tourGo(-1);
    case 'presenter': ui.presenter = 0; return presenterGo(0);
    case 'pnext': return presenterGo(ui.presenter + 1);
    case 'pback': return presenterGo(ui.presenter - 1);
    case 'pexit': ui.presenter = null; return renderPresenter();
    case 'leave': return busy(async () => { await Store.leave(id); toast('You left the group.'); });
    case 'copypct': return busy(() => Store.setCopyPct(el.dataset.gid, +el.dataset.k));
    case 'newgroup': return groupSheet(el.dataset.k || null);
    case 'gohome': closeModal(); if (!location.hash || location.hash === '#/home' || location.hash === '#/'){ window.scrollTo({ top: 0, behavior: 'smooth' }); return; } location.hash = '#/home'; return;
    case 'theme': try { localStorage.setItem('pi_theme', el.dataset.k); } catch(e){} applyTheme(); return render();
    case 'exjump': { const k = el.dataset.k; if (k === 'feed'){ ui.exploreTab = 'feed'; render(); window.scrollTo({ top: 0 }); return; }
      const was = ui.exploreTab; ui.exploreTab = 'market'; ui.exActive = k; if (was === 'feed') render(); requestAnimationFrame(() => { const t = document.getElementById('ex-' + k); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); exSpy(true); }); return; }
    case 'badgeinfo': return toast(el.dataset.k);
    case 'badgefounding': return busy(async () => { await Store.http('POST', '/api/admin/badges', { op: 'founding', cutoff: $('#bd-cut').value || null }); toast('Founding member cutoff saved.'); });
    case 'badgecreate': return busy(async () => { await Store.http('POST', '/api/admin/badges', { op: 'create', name: $('#bd-n').value, color: $('#bd-c').value, desc: $('#bd-d').value }); toast('Badge created.'); });
    case 'badgeaward': return busy(async () => { const u = ($('#bd-u-' + el.dataset.id) || {}).value || ''; await Store.http('POST', '/api/admin/badges/award', { id: el.dataset.id, username: u, remove: el.dataset.k === 'remove' }); toast(el.dataset.k === 'remove' ? 'Badge removed.' : 'Badge awarded.'); });
    case 'badgebulk': return busy(async () => { const d = ($('#bd-b-' + el.dataset.id) || {}).value; const r = await Store.http('POST', '/api/admin/badges/bulk', { id: el.dataset.id, joinedBefore: d }); toast(`Awarded to ${r.awarded} member${r.awarded === 1 ? '' : 's'}.`); });
    case 'badgeretire': return busy(async () => { await Store.http('POST', '/api/admin/badges', { op: 'retire', id: el.dataset.id, retired: el.dataset.k === 'retire' }); });
    case 'vacation': return vacationSheet(el.dataset.gid);
    case 'vacationend': if (!confirm('End vacation mode now?')) return; return busy(async () => { await Store.http('POST', '/api/action/endVacation', { gid: el.dataset.gid }); toast('Vacation mode ended.'); });
    case 'awaypropose': return awaySheet(el.dataset.gid, el.dataset.k);
    case 'adminrole': return busy(async () => { const pid = ($('#ar-' + el.dataset.gid) || {}).value; await Store.http('POST', '/api/action/adminSetRole', { gid: el.dataset.gid, role: el.dataset.k, pid }); toast('Role updated.'); });
    case 'leaderrule': return busy(async () => { await Store.http('POST', '/api/admin/badges', { op: 'leader', copiers: +$('#lr-c').value, members: +$('#lr-m').value }); toast('Milestone saved.'); });
    case 'shareleader': { const url = location.origin + '/#/u/' + Store.myPid; if (navigator.share) return navigator.share({ title: 'Pocket Leader', text: "I'm a Pocket Leader on Pocket Investing.", url }).catch(() => {}); try { navigator.clipboard.writeText(url); toast('Profile link copied.'); } catch(e){} return; }
    case 'sharelink': { const url = el.dataset.k; if (navigator.share) return navigator.share({ title: 'Join me on Pocket', url }).catch(() => {}); try { navigator.clipboard.writeText(url); toast('Invite link copied.'); } catch(e){} return; }
    case 'ciscore': ui.ciScore = +el.dataset.k; return render();
    case 'cisend': return busy(async () => { await Store.http('POST', '/api/checkin', { score: ui.ciScore, comment: ($('#ci-t') || {}).value || '' }); ui.checkinHidden = true; toast('Thanks for the feedback.'); render(); });
    case 'ciskip': ui.checkinHidden = true; Store.http('POST', '/api/checkin', { skip: true }).catch(() => {}); return render();
    case 'a2hs': if (a2hsEvent){ a2hsEvent.prompt(); a2hsEvent = null; } return render();
    case 'a2hsoff': try { localStorage.setItem('pi_a2hs_off', '1'); } catch(e){} return render();
    case 'reportsheet': return reportSheet(el.dataset.k, el.dataset.id);
    case 'showblocked': ui.showBlocked = ui.showBlocked || new Set(); ui.showBlocked.add(el.dataset.id); return render();
    case 'block': if (!confirm(`Block ${Store.displayName(el.dataset.id)}? Their posts and comments will be hidden from you, and they won't be able to follow, copy or reply to you. They won't be told.`)) return; return busy(async () => { await Store.http('POST', '/api/action/block', { pid: el.dataset.id }); toast('Blocked.'); });
    case 'unblock': return busy(async () => { await Store.http('POST', '/api/action/unblock', { pid: el.dataset.id }); toast('Unblocked.'); });
    case 'modact': { const a = el.dataset.k; if (a === 'remove' && !confirm('Remove this content? The author will be told why.')) return; const note = ['remove', 'warn', 'mute7', 'mute30'].includes(a) ? (prompt('Short note for the author (optional):') || '') : ''; return busy(async () => { await Store.http('POST', '/api/action/moderate', { reportId: el.dataset.id, action: a, note }); toast('Done.'); }); }
    case 'badgepop': return badgePop(el);
    case 'featuredbadges': return featuredSheet();
    case 'badgeidea': return busy(async () => { try { await Store.http('POST', '/api/badge-ideas', { name: $('#bi-n').value, why: $('#bi-w').value, earn: $('#bi-e').value }); ['#bi-n', '#bi-w', '#bi-e'].forEach(s => $(s).value = ''); $('#bi-x').textContent = ''; ui.myIdeas = null; toast('Thanks. The Pocket team will review it.'); } catch(e){ $('#bi-x').textContent = e.message; } });
    case 'ovote': return busy(async () => { await Store.http('POST', '/api/outlook/' + el.dataset.k, { dir: el.dataset.d, gid: el.dataset.gid || '' }); delete ui.outlook[el.dataset.k + ':' + (el.dataset.gid || '')]; render(); });
    case 'opeek': if (!confirm(`See results? You won't be able to vote on ${el.dataset.k} this week.`)) return; return busy(async () => { await Store.http('POST', '/api/outlook/' + el.dataset.k + '/peek', { gid: el.dataset.gid || '' }); delete ui.outlook[el.dataset.k + ':' + (el.dataset.gid || '')]; render(); });
    case 'opublic': return busy(async () => { await Store.http('POST', '/api/outlook-public', { on: el.checked }); delete ui.outlook['rec:' + Store.myPid]; render(); });
    case 'support': return supportSheet();
    case 'supreply': return busy(async () => { const v = ($('#sr-' + el.dataset.id) || {}).value || ''; await Store.http('POST', '/api/support/' + el.dataset.id + '/reply', { body: v }); ui.mySupport = null; toast('Sent.'); render(); });
    case 'walkthrough': return walkthrough();
    case 'admsup': return busy(async () => { const id = el.dataset.id; await Store.http('POST', '/api/admin/support/' + id, { reply: ($('#as-r-' + id) || {}).value || '', status: el.dataset.k, complaint: !!($('#as-c-' + id) || {}).checked, outcome: ($('#as-o-' + id) || {}).value || '' }); ui.admSupport = null; toast('Saved.'); render(); });
    case 'inccreate': return busy(async () => { await Store.http('POST', '/api/admin/incident', { op: 'create', title: $('#in-t').value, body: $('#in-b').value }); ui.admStatus = undefined; ui.status = undefined; toast('Posted.'); render(); });
    case 'incupdate': return busy(async () => { const id = el.dataset.id; await Store.http('POST', '/api/admin/incident', { op: 'update', id, status: $('#in-s-' + id).value, body: $('#in-b-' + id).value }); ui.admStatus = undefined; ui.status = undefined; toast('Updated.'); render(); });
    case 'ideastatus': return busy(async () => { const id = el.dataset.id; await Store.http('POST', '/api/admin/idea-status', { id, status: $('#fs-' + id).value, note: $('#fn-' + id).value }); await loadAdmin(); toast('Saved. The member was notified.'); });
    case 'ideatobadge': { const f = ((ui.admin || {}).feedback || []).find(x => x.id === el.dataset.id); try { const b = JSON.parse(f.body); $('#bd-n').value = b.name; $('#bd-d').value = b.why; $('#bd-n').scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('Badge form filled in. Pick a color and create it.'); } catch(e){} return; }
    case 'outlookrule': return busy(async () => { const v = id => +$('#' + id).value; await Store.http('POST', '/api/admin/badges', { op: 'outlook', weeklyRun: v('ob-wr'), regular: v('ob-rg'), groupCalls: v('ob-gc'), streak: v('ob-st'), sharpPct: v('ob-sp'), sharpMin: v('ob-sm'), sectorPct: v('ob-xp'), sectorMin: v('ob-xm'), sectorRegular: v('ob-xr'), accuracyOn: $('#ob-acc').checked }); toast('Saved.'); });
    case 'exall': ui.exAll = Object.assign({}, ui.exAll, { [el.dataset.k]: !(ui.exAll || {})[el.dataset.k] }); return render();
    case 'photo': return photoSheet({ target: el.dataset.k || 'me', gid: el.dataset.gid || null });
    case 'reportphoto': if (!confirm('Report this profile photo to the Pocket team?')) return; return busy(async () => { await Store.http('POST', '/api/action/report', { kind: 'photo', pid: el.dataset.id, reason: 'photo' }); toast('Thanks. The Pocket team will review it.'); });
    case 'rmphoto': if (!confirm('Remove this photo?')) return; return busy(async () => { await Store.http('POST', '/api/admin/photo-remove', { key: el.dataset.k }); toast('Photo removed.'); });
    case 'newprop': return proposalSheet(el.dataset.gid);
    case 'vote': return busy(async () => { await Store.vote(id, el.dataset.k); toast('Vote recorded.'); });
    case 'closeprop': return busy(async () => { await Store.closeProposal(id); toast('Voting closed.'); });
    case 'bio': return bioSheet();
    case 'clock': return busy(async () => { await Store.setClock(el.dataset.k); toast(el.dataset.k === 'live' ? 'Using real market hours.' : 'Demo clock set for everyone.'); });
    case 'demotrade': return busy(async () => {
      const gid = $('#d-g').value, g = Store.get('groups', gid), sym = $('#d-s').value, side = $('#d-side').value, amt = parseFloat($('#d-amt').value) || 0;
      const shares = Math.floor(amt / Market.price(sym) * 1000) / 1000;
      const res = await Store.groupTrade(gid, g.leadPid, sym, side, shares, $('#d-note').value);
      toast(`${Store.displayName(g.leadPid)} ${side === 'buy' ? 'bought' : 'sold'} ${shs(res.trade.shares)} ${sym}. ${res.sent} approval request${res.sent === 1 ? '' : 's'} sent.`);
    });
    case 'demoapprove': return busy(async () => { const n = await Store.simulateApprovals(el.dataset.gid); toast(n ? `${n} sample member${n === 1 ? '' : 's'} responded.` : 'No sample members have pending requests in that group.'); });
    case 'demovote': return busy(async () => { const n = await Store.simulateVotes(id); toast(n ? `${n} sample member${n === 1 ? '' : 's'} voted.` : 'All sample members have already voted.'); });
    case 'reset': return busy(async () => { if (!confirm('Reset your demo account to $100,000 cash?')) return; await Store.resetMe(); toast('Account reset.'); });
  }
}
