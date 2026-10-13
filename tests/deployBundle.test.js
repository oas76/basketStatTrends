/**
 * Vercel only ships files listed in vercel.json `includeFiles`; anything else
 * served by express.static 404s in production. Every local asset a bundled page
 * (or the service worker's precache list) references must be included.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('deploy bundle', () => {
  const includeFiles = new Set(JSON.parse(read('vercel.json')).builds[0].config.includeFiles);

  function referencedAssets() {
    const refs = new Map(); // file -> Set of referrers
    const add = (file, from) => {
      const f = file.replace(/^\//, '');
      if (!refs.has(f)) refs.set(f, new Set());
      refs.get(f).add(from);
    };
    for (const page of includeFiles) {
      if (!page.endsWith('.html')) continue;
      const html = read(page);
      for (const m of html.matchAll(/(?:src|href)="(\/?[\w.\-/]+\.(?:js|css|svg|png|json|webmanifest))"/g)) add(m[1], page);
      if (html.includes("register('/sw.js')")) add('sw.js', page);
    }
    const shell = read('sw.js').match(/const SHELL = \[([\s\S]*?)\]/);
    expect(shell).not.toBeNull();
    for (const m of shell[1].matchAll(/'(\/[\w.\-/]+)'/g)) add(m[1], 'sw.js');
    return refs;
  }

  test('every local asset referenced by a bundled page or sw.js is in includeFiles', () => {
    const missing = [];
    for (const [file, from] of referencedAssets()) {
      const full = path.join(ROOT, file);
      if (fs.existsSync(full) && fs.statSync(full).isFile() && !includeFiles.has(file)) {
        missing.push(`${file} (used by ${[...from].join(', ')})`);
      }
    }
    expect(missing).toEqual([]);
  });
});
