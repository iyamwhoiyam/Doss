import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCsv, toCsv } from './csv.js';

test('parses a simple sheet into keyed rows', () => {
  const { headers, rows } = parseCsv('name,email\nJane Bradfield,jbradfield@enovascience.com\n');
  assert.deepEqual(headers, ['name', 'email']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, 'jbradfield@enovascience.com');
});

test('handles quoted commas, escaped quotes and embedded newlines', () => {
  const csv = 'name,notes\r\n"Acme, Inc.","He said ""hi""\nsecond line"\r\n';
  const { rows } = parseCsv(csv);
  assert.equal(rows[0].name, 'Acme, Inc.');
  assert.equal(rows[0].notes, 'He said "hi"\nsecond line');
});

test('strips a UTF-8 BOM and skips blank lines', () => {
  const { rows } = parseCsv('﻿code,name\n\nC-001,Acme\n\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, 'C-001');
});

test('pads short rows and ignores extra cells', () => {
  const { rows } = parseCsv('a,b,c\n1\n1,2,3,4\n');
  assert.equal(rows[0].b, '');
  assert.equal(rows[0].c, '');
  assert.equal(rows[1].c, '3');
});

test('an empty sheet yields no rows', () => {
  assert.deepEqual(parseCsv('').rows, []);
  assert.deepEqual(parseCsv('\n\n').rows, []);
});

test('round-trips through toCsv, quoting only what needs it', () => {
  const headers = ['code', 'name', 'notes'];
  const rows = [{ code: 'C-1', name: 'Acme, Inc.', notes: 'line\nbreak' }];
  const csv = toCsv(headers, rows);
  assert.match(csv, /"Acme, Inc\."/);
  const back = parseCsv(csv);
  assert.equal(back.rows[0].name, 'Acme, Inc.');
  assert.equal(back.rows[0].notes, 'line\nbreak');
  assert.equal(back.rows[0].code, 'C-1');
});

test('toCsv writes just the header for an empty row set', () => {
  assert.equal(toCsv(['a', 'b']), 'a,b\r\n');
});
