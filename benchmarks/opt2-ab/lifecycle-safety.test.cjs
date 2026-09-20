'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {same}=require('./lifecycle.cjs');
test('an absent start identity cannot identify a process for cleanup',()=>{
 assert.equal(same({pid:4,uid:500},{pid:4,uid:500}),false);
});
test('PID reuse is not the original child',()=>{
 assert.equal(same({pid:4,uid:500,startId:'a'},{pid:4,uid:500,startId:'b'}),false);
 assert.equal(same({pid:4,uid:500,startId:'a'},{pid:4,uid:500,startId:'a'}),true);
});
