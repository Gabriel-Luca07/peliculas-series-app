// Runs automatically after `npm run dist` (see the "postdist" script in
// package.json). electron-builder's own release/latest.yml always references
// the installer/portable/.blockmap filenames with spaces replaced by hyphens
// (that's electron-builder's internal convention), but the actual files it
// writes to release/ keep the spaces from productName in package.json.
//
// If you upload the space-named files as-is to a GitHub Release, GitHub's
// asset-upload sanitizer replaces spaces with DOTS (not hyphens), which then
// don't match what latest.yml expects — electron-updater can't find the
// asset, downloads silently fail, and users get stuck on "Descargando..."
// forever. This happened for real in v1.9.0's first upload. This script
// creates hyphenated copies up front so that never happens again: just
// upload the *-hyphenated files (and latest.yml) to the release as-is.
const fs = require('fs');
const path = require('path');

const releaseDir = path.join(__dirname, '..', 'release');

if (!fs.existsSync(releaseDir)) {
  console.log('No release/ directory found, skipping asset renaming.');
  process.exit(0);
}

const targetExtensions = ['.exe', '.blockmap'];
const files = fs.readdirSync(releaseDir);
let copied = 0;

for (const file of files) {
  if (!targetExtensions.some((ext) => file.endsWith(ext))) continue;
  if (!file.includes(' ')) continue; // already hyphenated (or nothing to rename)

  const hyphenated = file.replace(/ /g, '-');
  fs.copyFileSync(path.join(releaseDir, file), path.join(releaseDir, hyphenated));
  console.log(`Copied "${file}" -> "${hyphenated}"`);
  copied += 1;
}

if (copied === 0) {
  console.log('Nothing to rename (no space-named .exe/.blockmap files in release/).');
} else {
  console.log(`\nDone. Upload the hyphenated files above (and latest.yml) to the GitHub Release — not the original space-named ones.`);
}
