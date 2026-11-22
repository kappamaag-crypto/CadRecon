import {describe,it,expect} from 'vitest';
import {planOcrTiles,sameOcrLine,unrotateOcrBox} from './ocrTiles';

describe('browser-only large OCR tiling',()=>{
  it('keeps ordinary small drawings as one exact full-resolution tile',()=>{
    expect(planOcrTiles(900,600)).toEqual([{x:0,y:0,width:900,height:600}]);
  });
  it('covers a large A0-like scan fully without generating an oversized tile',()=>{
    const width=6800,height=4700,tiles=planOcrTiles(width,height);
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles.length).toBeLessThanOrEqual(100);
    expect(tiles.every(t=>t.width<=1600&&t.height<=1600)).toBe(true);
    for(let y=0;y<height;y+=113){
      for(let x=0;x<width;x+=97){
        expect(tiles.some(t=>x>=t.x&&x<t.x+t.width&&y>=t.y&&y<t.y+t.height)).toBe(true);
      }
    }
    expect(tiles.some(t=>t.x===0&&t.y===0)).toBe(true);
    expect(tiles.some(t=>t.x+t.width===width&&t.y+t.height===height)).toBe(true);
  });
  it('maps both vertical OCR rotations back to the original pixel rectangle',()=>{
    const original={text:'Позиция 6',x0:40,y0:15,x1:55,y1:80};
    // Original W=200 H=100. +90: X=H-y,Y=x.
    const plus={...original,x0:20,x1:85,y0:40,y1:55};
    const minus={...original,x0:15,x1:80,y0:145,y1:160};
    expect(unrotateOcrBox(plus,200,100,90)).toEqual(original);
    expect(unrotateOcrBox(minus,200,100,-90)).toEqual(original);
  });
  it('rejects unreasonable decompression sizes instead of freezing a phone',()=>{
    expect(()=>planOcrTiles(50000,50000)).toThrow(/100/);
    expect(()=>planOcrTiles(0,100)).toThrow();
  });
  it('keeps distinct nearby engineering labels; deduplicates real tile overlaps',()=>{
    const box={text:'6000',x0:100,y0:90,x1:160,y1:110};
    expect(sameOcrLine(box,{...box,x0:102,y0:90,x1:162,y1:110})).toBe(true);
    expect(sameOcrLine(box,{...box,x0:164,x1:224})).toBe(false);
    expect(sameOcrLine(box,{...box,text:'8000'})).toBe(false);
  });
});
