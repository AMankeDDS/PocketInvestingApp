/* Builds the app from src/ into public/: one version-stamped script and stylesheet, plus index.html.
   Run with `npm run build`. Without esbuild installed it still builds, just without compacting. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const SRC = path.join(__dirname, 'src'), PUB = path.join(__dirname, 'public');
let esbuild = null; try { esbuild = require('esbuild'); } catch (e) {}
const files = fs.readdirSync(path.join(SRC, 'app')).filter(f => f.endsWith('.js')).sort();
/* Loaded on demand: admin, demo controls and statements. Each of their functions gets a small placeholder in the main
   file; the second file replaces them when it loads (about a second after start, or the first time one is needed). */
const LAZY = ['14-statements.js', '18-admin.js', '19-demo.js'], SYNC_NULL = ['tourSample', 'tourReviewSample'];
const read = f => `/* ===== ${f} ===== */\n` + fs.readFileSync(path.join(SRC, 'app', f), 'utf8');
let lazyJs = LAZY.map(read).join('\n');
const lazyNames = [...lazyJs.matchAll(/^(?:async )?function\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
const stubs = `/* ===== on-demand loading ===== */
const __LAZY_SRC = (document.currentScript && document.currentScript.dataset.lazy) || null; let __lazyP = null;
function __loadLazy(){ if (!__lazyP) __lazyP = new Promise((res, rej) => { if (!__LAZY_SRC) return res(); const s = document.createElement('script'); s.src = __LAZY_SRC; s.onload = () => res(); s.onerror = () => { __lazyP = null; rej(new Error('Load failed')); }; document.head.appendChild(s); }); return __lazyP; }
function __lazyCall(name, args, kind){ const p = __loadLazy(); if (kind === 'view'){ p.then(() => render(), () => {}); return '<div class="loading">Loading…</div>'; } if (kind === 'null'){ p.catch(() => {}); return null; } return p.then(() => window[name](...args)); }
${lazyNames.map(n => `function ${n}(...a){ return __lazyCall('${n}', a, '${/^v[A-Z]/.test(n) || /Panel$/.test(n) ? 'view' : SYNC_NULL.includes(n) ? 'null' : 'call'}'); }`).join('\n')}
setTimeout(() => __loadLazy().catch(() => {}), 1200);
`;
let js = files.filter(f => !LAZY.includes(f)).map(read).join('\n') + '\n' + stubs;
let css = fs.readFileSync(path.join(SRC, 'styles', 'app.css'), 'utf8');
if (esbuild){
  js = esbuild.transformSync(js, { loader: 'js', minifyWhitespace: true, minifySyntax: true, target: 'es2019', legalComments: 'none' }).code;
  lazyJs = esbuild.transformSync(lazyJs, { loader: 'js', minifyWhitespace: true, minifySyntax: true, target: 'es2019', legalComments: 'none' }).code;
  css = esbuild.transformSync(css, { loader: 'css', minify: true }).code;
}
const stamp = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);
for (const dir of ['js', 'css']){ fs.mkdirSync(path.join(PUB, dir), { recursive: true }); for (const f of fs.readdirSync(path.join(PUB, dir))) if (/^(app|lazy)\.[0-9a-f]{10}\.(js|css)$/.test(f)) fs.unlinkSync(path.join(PUB, dir, f)); }
const jsName = `/js/app.${stamp(js)}.js`, cssName = `/css/app.${stamp(css)}.css`, lazyName = `/js/lazy.${stamp(lazyJs)}.js`;
fs.writeFileSync(path.join(PUB, jsName), js); fs.writeFileSync(path.join(PUB, lazyName), lazyJs); fs.writeFileSync(path.join(PUB, cssName), css);
fs.writeFileSync(path.join(PUB, 'index.html'), fs.readFileSync(path.join(SRC, 'index.template.html'), 'utf8').replace('{{JS}}', jsName).replace('{{LAZY}}', lazyName).replace('{{CSS}}', cssName));
console.log(`Built ${files.length} files into ${jsName} (${Math.round(js.length / 1024)} KB, plus ${Math.round(lazyJs.length / 1024)} KB loaded on demand) and ${cssName} (${Math.round(css.length / 1024)} KB)${esbuild ? '' : ' without compacting (esbuild not installed)'}.`);
