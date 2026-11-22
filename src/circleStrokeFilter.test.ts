import {describe,it,expect} from 'vitest';
import {isRedundantCircleStroke,suppressRedundantCircleStrokes,type InkCircle,type InkLine} from './circleStrokeFilter';

const circle:InkCircle={x:100,y:100,radius:80,confidence:.87};
const line=(x0:number,y0:number,x1:number,y1:number):InkLine=>({a:{x:x0,y:y0},b:{x:x1,y:y1},confidence:.8});

describe('P0 circular-stroke candidate suppression',()=>{
  it('removes short high-confidence circular rim chords already represented by circle',()=>{
    // Top arc of radius 80, chord from x=90 to 110 lies <1px off rim.
    const chord=line(90,20.63,110,20.63);
    expect(isRedundantCircleStroke(chord,circle)).toBe(true);
    const result=suppressRedundantCircleStrokes([chord], [circle]);
    expect(result.removed).toBe(1);
    expect(result.lines).toHaveLength(0);
  });
  it('retains a long tangent, radial dimension, crossing line and unrelated neighbour',()=>{
    const others=[
      line(5,20,195,20),  // tangent extends beyond ring
      line(100,15,100,185), // central vertical crossing
      line(100,20,100,60), // radial from the rim
      line(10,50,190,50), // unrelated straight
      line(0,100,200,100), // crosses circle and continues
    ];
    expect(suppressRedundantCircleStrokes(others,[circle]).lines).toHaveLength(others.length);
  });
  it('does not suppress any geometry without a reliable native circle',()=>{
    const chord=line(90,20.63,110,20.63);
    expect(suppressRedundantCircleStrokes([chord],[{...circle,confidence:.5}]).removed).toBe(0);
    expect(suppressRedundantCircleStrokes([chord],[]).removed).toBe(0);
  });
  it('does not assume all tangents near an unrelated or shifted circle are duplicates',()=>{
    const stroke=line(90,20.63,110,20.63);
    expect(isRedundantCircleStroke(stroke,{...circle,y:107})).toBe(false);
    expect(isRedundantCircleStroke(stroke,{...circle,x:190})).toBe(false);
  });
});