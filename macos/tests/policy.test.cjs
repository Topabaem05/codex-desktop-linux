'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {trustedUI,validateProfile,shouldRelease,css}=require('../runtime/policy.cjs');
const profile=require('../profile.json');
test('every implemented feature is enabled by default',()=>{
 assert.equal(validateProfile(profile).name,'all-compatible');
 assert.ok(Object.values(profile.features).every(x=>x===true));
 assert.ok(profile.notPorted.cgroupHardCap);
});
test('only app-local file URLs are eligible, never remote or adjacent paths',()=>{
 const root='/Applications/Community.app/Contents/Resources/app.asar';
 assert.ok(trustedUI(`file://${root}/webview/index.html`,root));
 for(const x of ['https://chatgpt.com','file:///tmp/a.html',`file://${root}-evil/a.html`,`file://${root}/../evil.html`,'file://host/secret','bad'])assert.equal(trustedUI(x,root),false,x);
});
test('release is limited to idle hidden windows under high pressure',()=>{
 assert.ok(shouldRelease('critical',true,31000,0,70000,60000));
 for(const [state,hidden,idle,last] of [['normal',true,40000,0],['critical',false,40000,0],['critical',true,1000,0],['critical',true,40000,20000]])assert.equal(shouldRelease(state,hidden,idle,last,70000,60000),false);
});
test('CSS preserves visible markdown and is not a DOM removal policy',()=>{
 const s=css(profile);assert.ok(s.includes('opacity:1'));assert.ok(s.includes('content-visibility:auto'));assert.ok(!s.includes('display:none'));
});
