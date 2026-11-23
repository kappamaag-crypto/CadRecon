import {describe,it,expect} from 'vitest';
import {inspectAnnotationColors} from './annotationOverlay';
const picture=(w:number,h:number)=>{const rgba=new Uint8ClampedArray(w*h*4);
  rgba.fill(255);
  const paint=(x0:number,y0:number,x1:number,y1:number,
    color:[number,number,number,number])=>{
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const i=(y*w+x)*4;
      rgba[i]=color[0];rgba[i+1]=color[1];rgba[i+2]=color[2];rgba[i+3]=color[3];
    }
  };
  return {rgba,paint};
};
describe('W0 annotated screenshot contamination warning (no automatic removal)',()=>{
  it('detects overlaid engineering blue lines and black source marks',()=>{
    const m=picture(200,120);
    m.paint(10,10,190,11,[105,105,221,255]);
    m.paint(10,30,190,33,[40,40,40,255]);
    const r=inspectAnnotationColors(m.rgba,200,120);
    expect(r.likelyMarkup).toBe(true);
    expect(r.coloredFraction).toBeGreaterThan(.004);
  });
  it('does not flag ordinary monochrome scan or blue-only design as proven markup',()=>{
    const mono=picture(200,120);mono.paint(0,20,190,25,[50,50,50,255]);
    expect(inspectAnnotationColors(mono.rgba,200,120).likelyMarkup).toBe(false);
    const blue=picture(200,120);blue.paint(0,20,190,25,[80,90,225,255]);
    expect(inspectAnnotationColors(blue.rgba,200,120).likelyMarkup).toBe(false);
  });
  it('recognizes cyan ticks, ignores transparent coloured pixels',()=>{
    const m=picture(100,100);
    m.paint(5,5,95,9,[20,160,160,255]);
    m.paint(5,30,95,35,[40,40,40,255]);
    expect(inspectAnnotationColors(m.rgba,100,100).likelyMarkup).toBe(true);
    const t=picture(100,100);t.paint(5,5,95,9,[20,160,160,0]);
    expect(inspectAnnotationColors(t.rgba,100,100).coloredPixels).toBe(0);
  });
  it('rejects hostile buffers and unbounded image allocations',()=>{
    expect(()=>inspectAnnotationColors(new Uint8ClampedArray(0),200,120)).toThrow();
    expect(()=>inspectAnnotationColors(new Uint8ClampedArray(0),10000,10000)).toThrow();
  });
});
