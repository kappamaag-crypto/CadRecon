import {describe,it,expect} from 'vitest';
import {preservePdfRaster} from './pdfRasterPolicy';
describe('W1/W3 protect thin scanned drawing strokes during PDF import',()=>{
  it('preserves lossless PNG as the preferred subsequent OCR/trace source',()=>{
    const calls:string[]=[];
    const result=preservePdfRaster({toDataURL(type){calls.push(type||'');return 'data:image/png;base64,AAAA';}},18000000);
    expect(result.image).toMatch(/^data:image\/png/);
    expect(result.lossless).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(calls).toEqual(['image/png']);
  });
  it('never silently substitutes JPEG when PNG export is unavailable',()=>{
    const result=preservePdfRaster({toDataURL(type){
      if(type==='image/png')throw new Error('memory exhausted');
      return 'data:image/jpeg;base64,AAAA';
    }},8000000);
    expect(result.lossless).toBe(false);
    expect(result.warning).toContain('с потерями');
    expect(result.warning).toContain('PNG/TIFF');
  });
  it('rejects corrupt and oversized canvases',()=>{
    expect(()=>preservePdfRaster({toDataURL(){return '';}},30000000)).toThrow();
    expect(()=>preservePdfRaster({toDataURL(){return '';}},12)).toThrow();
    expect(()=>preservePdfRaster({toDataURL(t){
      return t==='image/png'?'':'data:image/png;base64,AAAA';
    }},100)).toThrow();
  });
});
