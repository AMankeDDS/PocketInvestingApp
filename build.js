/* Builds the app from src/ into public/: one version-stamped script and stylesheet, plus index.html.
   Run with `npm run build`. Without esbuild installed it still builds, just without compacting. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const SRC = path.join(__dirname, 'src'), PUB = path.join(__dirname, 'public');
let esbuild = null; try { esbuild = require('esbuild'); } catch (e) {}
const files = fs.readdirSync(path.join(SRC, 'app')).filter(f => f.endsWith('.js')).sort();
let js = files.map(f => `/* ===== ${f} ===== */\n` + fs.readFileSync(path.join(SRC, 'app', f), 'utf8')).join('\n');
let css = fs.readFileSync(path.join(SRC, 'styles', 'app.css'), 'utf8');
if (esbuild){
  js = esbuild.transformSync(js, { loader: 'js', minifyWhitespace: true, minifySyntax: true, target: 'es2019', legalComments: 'none' }).code;
  css = esbuild.transformSync(css, { loader: 'css', minify: true }).code;
}
const stamp = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);
for (const dir of ['js', 'css']){ fs.mkdirSync(path.join(PUB, dir), { recursive: true }); for (const f of fs.readdirSync(path.join(PUB, dir))) if (/^app\.[0-9a-f]{10}\.(js|css)$/.test(f)) fs.unlinkSync(path.join(PUB, dir, f)); }
const jsName = `/js/app.${stamp(js)}.js`, cssName = `/css/app.${stamp(css)}.css`;
fs.writeFileSync(path.join(PUB, jsName), js); fs.writeFileSync(path.join(PUB, cssName), css);
fs.writeFileSync(path.join(PUB, 'index.html'), fs.readFileSync(path.join(SRC, 'index.template.html'), 'utf8').replace('{{JS}}', jsName).replace('{{CSS}}', cssName));
console.log(`Built ${files.length} files into ${jsName} (${Math.round(js.length / 1024)} KB) and ${cssName} (${Math.round(css.length / 1024)} KB)${esbuild ? '' : ' without compacting (esbuild not installed)'}.`);
