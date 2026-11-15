import test from 'node:test';
import assert from 'node:assert/strict';
import { ageOn, hashPassword, verifyPassword } from './auth.mjs';
import { jobRoles } from './db.mjs';

test('adult age calculation and malformed dates',()=>{
  const today=new Date();
  const adult=new Date(Date.UTC(today.getUTCFullYear()-20,today.getUTCMonth(),today.getUTCDate())).toISOString().slice(0,10);
  const child=new Date(Date.UTC(today.getUTCFullYear()-17,today.getUTCMonth(),today.getUTCDate())).toISOString().slice(0,10);
  assert.ok(ageOn(adult)>=18);
  assert.ok(ageOn(child)<18);
  assert.equal(ageOn('2001-02-31'),-1);
  assert.equal(ageOn('not-a-date'),-1);
});
test('password hashes use unique salts',()=>{
  const a=hashPassword('strong password 123');
  const b=hashPassword('strong password 123');
  assert.notEqual(a,b);
  assert.equal(verifyPassword('strong password 123',a),true);
  assert.equal(verifyPassword('wrong one',a),false);
});
test('core job roles are available',()=>{
  assert.ok(jobRoles.includes('Serving'));
  assert.ok(jobRoles.includes('Host'));
  assert.equal(jobRoles.length,9);
});
