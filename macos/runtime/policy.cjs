'use strict';
const path = require('node:path');
const { fileURLToPath } = require('node:url');
function trustedUI(value, appPath) {
  try {
    const url = new URL(value);
    // Audited source/real boot 35480330932 serves packaged UI at app://-/.
    if (url.protocol === 'app:') return url.hostname === '-' && !url.port && !url.username && !url.password;
    if (url.protocol !== 'file:' || url.host) return false;
    const relative = path.relative(appPath, fileURLToPath(url));
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  } catch { return false; }
}
function validateProfile(profile) {
  if (profile.name !== 'all-compatible' || !Number.isInteger(profile.heapMiB) || profile.heapMiB < 256 || profile.heapMiB > 768 ||
    !Number.isInteger(profile.sampleMs) || profile.sampleMs < 1000 || !Number.isInteger(profile.cacheCooldownMs) || profile.cacheCooldownMs < 60000) throw new Error('Invalid macOS profile');
  for (const value of Object.values(profile.features)) if (typeof value !== 'boolean') throw new Error('Invalid feature switch');
  return profile;
}
function shouldRelease(state, hidden, idleMs, lastReleaseMs, now, cooldownMs) {
  return ['critical', 'over-budget'].includes(state) && hidden === true && idleMs >= 30000 && now - lastReleaseMs >= cooldownMs;
}
function css(profile) {
  let out = '';
  if (profile.features.reducedMarkdownMotion) out += `
[class*="_MarkdownRoot_"][data-markdown-animated] :is([class*="_FadeIn_"],[class*="_HorizontalRule_"],[class*="_ListItem_"],[class*="_TableRow_"],[class*="_Blockquote_"]) { opacity:1!important; animation:none!important; }
[class*="_MarkdownRoot_"][data-markdown-animated] [class*="_FadeListDecoration_"]::marker { animation:none!important; }
.vertical-scroll-fade-mask { animation:none!important; }
`;
  if (profile.features.offscreenPaintSkipping) out += `
[class*="_MarkdownRoot_"] > :is(p,pre,table,blockquote,ul,ol) { content-visibility:auto; contain-intrinsic-size:auto 100px; }
`;
  return out;
}
module.exports = { trustedUI, validateProfile, shouldRelease, css };
