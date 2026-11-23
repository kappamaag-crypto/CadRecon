import {describe,it,expect,vi} from 'vitest';
import {entity,newProject} from './model';
import {regionToSourcePixels,placeOcrRegionReadings,cropOcrRegion} from './ocrRegion';
describe('OCR selected region: safe pixel/geometry mapping',()=>{
 it('maps clipped reversed rect to source pixels and sheet coordinates',()=>{
   const pixels=regionToSourcePixels({width:1000,height:500},2000,1000,
     {x0:700,y0:350,x1:200,y1:100});
   expect(pixels).toEqual({
     x:400,y:200,width:1000,height:500,
     offset:{x:200,y:100},sheetWidth:500,sheetHeight:250,
   });
 });
 it('rejects tiny, non-finite, off-page and excessive crops',()=>{
   const s={width:1000,height:1000};
   expect(()=>regionToSourcePixels(s,2000,2000,{x0:5,y0:5,x1:6,y1:7})).toThrow();
   expect(()=>regionToSourcePixels(s,5000,5000,{x0:0,y0:0,x1:1000,y1:1000})).toThrow(/6 Мп/);
   expect(()=>regionToSourcePixels(s,2000,2000,{x0:2000,y0:0,x1:3000,y1:200})).toThrow();
   expect(()=>regionToSourcePixels(s,2000,2000,{x0:NaN,y0:0,x1:200,y1:200})).toThrow();
 });
 it('translates OCR text and bbox to original sheet without altering original',()=>{
   const e=entity('text',[{x:20,y:30}],'OCR','ocr');e.text='R20';
   e.bbox={x0:15,y0:10,x1:40,y1:38};e.verified=true;
   const moved=placeOcrRegionReadings([e],{x:200,y:100});
   expect(moved[0].points).toEqual([{x:220,y:130}]);
   expect(moved[0].bbox).toEqual({x0:215,y0:110,x1:240,y1:138});
   expect(moved[0].verified).toBe(false);
   expect(e.points[0].x).toBe(20);
   expect(moved[0].reason).toContain('выделенной');
 });
 it('crops entirely on client while preserving coordinate scale',async()=>{
   const oldImage=globalThis.Image,oldDoc=globalThis.document;
   class Img{naturalWidth=2000;naturalHeight=1000;src='';async decode(){}}
   const drawImage=vi.fn(),fillRect=vi.fn();
   const context={drawImage,fillRect,fillStyle:''};
   const canvas={width:0,height:0,
     getContext:()=>context,toDataURL:()=>'data:image/png;base64,crop'};
   Object.defineProperty(globalThis,'Image',{configurable:true,value:Img});
   Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>canvas}});
   try{
     const sheet=newProject().sheets[0];sheet.width=1000;sheet.height=500;
     sheet.image='data:image/png;base64,original';
     const result=await cropOcrRegion(sheet,{x0:200,y0:100,x1:700,y1:350});
     expect(drawImage).toHaveBeenCalledOnce();
     expect(fillRect).toHaveBeenCalledWith(0,0,1000,500);
     expect(context.fillStyle).toBe('#fff');
     expect(fillRect.mock.invocationCallOrder[0]).toBeLessThan(drawImage.mock.invocationCallOrder[0]);
     expect(result.sheet.image).toBe('data:image/png;base64,crop');
     expect(result.offset).toEqual({x:200,y:100});
     expect(result.sheet.width).toBe(500);
     expect(result.sheet.height).toBe(250);
     expect(sheet.image).toBe('data:image/png;base64,original');
   }finally{
     Object.defineProperty(globalThis,'Image',{configurable:true,value:oldImage});
     Object.defineProperty(globalThis,'document',{configurable:true,value:oldDoc});
   }
 });
});
