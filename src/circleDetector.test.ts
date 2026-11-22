import {describe,it,expect} from 'vitest';
import {detectOverlappedCircles} from './circleDetector';

function canvas(width:number,height:number) {
  const rgba=new Uint8ClampedArray(width*height*4);
  rgba.fill(255);
  const dot=(x:number,y:number,r=1)=>{
    for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
      const xx=x+dx,yy=y+dy;
      if(xx<0||yy<0||xx>=width||yy>=height)continue;
      const i=(yy*width+xx)*4;
      rgba[i]=rgba[i+1]=rgba[i+2]=0;
    }
  };
  const line=(x0:number,y0:number,x1:number,y1:number)=>{
    const steps=Math.ceil(Math.hypot(x1-x0,y1-y0)*2);
    for(let j=0;j<=steps;j++){
      const t=j/steps;
      dot(Math.round(x0+(x1-x0)*t),Math.round(y0+(y1-y0)*t),1);
    }
  };
  const circle=(cx:number,cy:number,r:number)=>{
    for(let j=0;j<2400;j++){
      const a=j*Math.PI*2/2400;
      dot(Math.round(cx+r*Math.cos(a)),Math.round(cy+r*Math.sin(a)),1);
    }
  };
  return {rgba,dot,line,circle};
}
describe('W3 browser contour+gradient circle proposals',()=>{
  it('finds a circle crossing a straight line without marking it verified',()=>{
    const {rgba,circle,line}=canvas(440,330);
    circle(225,165,72);
    line(20,120,425,225);
    const found=detectOverlappedCircles(rgba,440,330);
    const match=found.find(c=>Math.hypot(c.x-225,c.y-165)<9&&Math.abs(c.radius-72)<7);
    expect(match).toBeDefined();
    expect(match!.coverage).toBeGreaterThan(.72);
    expect(match!.confidence).toBeLessThan(1);
  });
  it('does not hallucinate a complete circle from isolated straight lines',()=>{
    const {rgba,line}=canvas(440,330);
    line(20,110,420,110);
    line(50,50,50,280);
    const result=detectOverlappedCircles(rgba,440,330);
    expect(result).toHaveLength(0);
  });
  it('stays within documented bounds and is deterministic',()=>{
    const {rgba,circle}=canvas(330,330);
    circle(165,165,70);
    const a=detectOverlappedCircles(rgba,330,330,3);
    const b=detectOverlappedCircles(rgba,330,330,3);
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(3);
  });
});
