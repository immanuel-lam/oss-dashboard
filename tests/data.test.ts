import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateImport} from '../src/data.ts';
const row={source:'app-store',date:'2026-10-01',metric:'first_downloads',value:0,unit:'count',timezone:'Europe/Lisbon',provenance:'Sales report'};
test('preserves a real zero and reporting metadata',()=>assert.deepEqual(validateImport([row]),[row]));
test('rejects invalid and overflowing dates',()=>{for(const date of ['2026-02-30','2026-13-01','today'])assert.throws(()=>validateImport([{...row,date}]));});
test('rejects values that would corrupt totals',()=>{for(const value of [-1,NaN,Infinity,'5'])assert.throws(()=>validateImport([{...row,value}]));});
test('rejects unknown source, missing provenance, invalid timezone and duplicate keys',()=>{for(const patch of [{source:'unknown'},{provenance:''},{timezone:'invalid'}])assert.throws(()=>validateImport([{...row,...patch}]));assert.throws(()=>validateImport([row,row]));});
test('rejects oversized imports',()=>assert.throws(()=>validateImport(Array(5001).fill(row))));
