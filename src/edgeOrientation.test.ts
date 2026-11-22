import {describe,it,expect} from 'vitest';
import {inferStrokeNormal,normalAgrees} from './edgeOrientation';
const raster=(w=125,h=125,ink=0,paper=255)=>{
  const data=new Uint8Array(w*h);data.fill(paper);
  const dot=(x:number,y:number)=>{if(x>=0&&y>=0&&x<w&&y<h)data[y*w+x]=ink;};
  return {data,w,h,dot,bar:(x0:number,y0:number,x1:number,y1:number)=>{
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)dot(x,y);
  }};
};
describe('W3 direction-constrained Hough vote filter',()=>{
  it('finds normal to thick horizontal stroke at top and bottom border',()=>{
    const m=raster();m.bar(10,59,114,63);
    const n=inferStrokeNormal(m.data,m.w,m.h,60,59,165);
    expect(n).not.toBeNull();
    expect(normalAgrees(n!,0,1)).toBe(true);
    expect(normalAgrees(n!,1,0)).toBe(false);
  });
  it('finds normal to thick vertical and 1px horizontal and vertical ridges',()=>{
    const v=raster();v.bar(58,10,62,114);
    expect(normalAgrees(inferStrokeNormal(v.data,v.w,v.h,58,60,165)!,1,0)).toBe(true);
    const h=raster();h.bar(12,60,110,60);
    expect(normalAgrees(inferStrokeNormal(h.data,h.w,h.h,60,60,165)!,0,1)).toBe(true);
    const thinV=raster();thinV.bar(60,10,60,114);
    expect(normalAgrees(inferStrokeNormal(thinV.data,thinV.w,thinV.h,60,60,165)!,1,0)).toBe(true);
  });
  it('retains a one-pixel diagonal and faded printed grey strokes',()=>{
    const diag=raster();for(let i=12;i<=110;i++)diag.dot(i,i);
    const n=inferStrokeNormal(diag.data,diag.w,diag.h,60,60,165);
    expect(n).not.toBeNull();
    expect(normalAgrees(n!,-Math.SQRT1_2,Math.SQRT1_2)).toBe(true);
    const faded=raster(125,125,185,250);faded.bar(10,60,110,62);
    expect(normalAgrees(inferStrokeNormal(faded.data,faded.w,faded.h,60,60,185)!,0,1)).toBe(true);
  });
  it('rejects isolated noise and ambiguous single-pixel intersection centres',()=>{
    const noise=raster();noise.dot(60,60);
    expect(inferStrokeNormal(noise.data,noise.w,noise.h,60,60,165)).toBeNull();
    const x=raster();x.bar(20,60,100,60);x.bar(60,20,60,100);
    expect(inferStrokeNormal(x.data,x.w,x.h,60,60,165)).toBeNull();
  });
  it('rejects blank pixels and invalid buffers',()=>{
    const m=raster();
    expect(inferStrokeNormal(m.data,m.w,m.h,60,60,165)).toBeNull();
    expect(inferStrokeNormal(new Uint8Array(0),125,125,60,60,165)).toBeNull();
    expect(inferStrokeNormal(m.data,m.w,m.h,-1,60,165)).toBeNull();
  });
});
