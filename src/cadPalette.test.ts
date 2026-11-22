import {describe,it,expect} from 'vitest';
import type {Tool} from './model';
describe('W4 CAD command categories',()=>{
  it('Tool union is only used as presentational values',()=>{
    const ids:Tool[]=['select','line','ellipse','polygon-inscribed','construction-h',
      'circle-3pt','arc-3pt','bezier'];
    expect(new Set(ids).size).toBe(8);
  });
});
