import {describe,it,expect,vi} from 'vitest';
import {createWorker} from 'tesseract.js';
import {preloadOcrModels,recognizeText} from './ocr';
import {newProject} from './model';
import {planOcrTiles} from './ocrTiles';

vi.mock('tesseract.js',()=>({
  createWorker:vi.fn(),
  PSM:{SPARSE_TEXT:11},
}));

describe('browser OCR language pack preparation',()=>{
  it('normalizes raw Tesseract confidence from 0..100 to 0..1',async ()=>{
    const originalImage=globalThis.Image;
    class TestImage {
      naturalWidth=200;naturalHeight=100;
      src='';
      async decode(){return;}
    }
    Object.defineProperty(globalThis,'Image',{configurable:true,value:TestImage});
    const terminate=vi.fn().mockResolvedValue(undefined);
    try {
      vi.mocked(createWorker).mockResolvedValue({
        terminate,
        setParameters:vi.fn().mockResolvedValue(undefined),
        recognize:vi.fn().mockResolvedValue({data:{text:'6000',blocks:[{paragraphs:[{lines:[
          {text:'6000',confidence:93,bbox:{x0:20,y0:10,x1:60,y1:30}},
          {text:'R20',confidence:101,bbox:{x0:80,y0:10,x1:120,y1:30}},
          {text:'?',confidence:-10,bbox:{x0:135,y0:10,x1:145,y1:30}},
        ]}]}]}}),
      } as unknown as Awaited<ReturnType<typeof createWorker>>);
      const sheet=newProject().sheets[0];
      sheet.image='data:image/png;base64,fixture';sheet.width=400;sheet.height=200;
      const result=await recognizeText(sheet);
      expect(result.entities.map(e=>e.confidence)).toEqual([.93,1,0]);
      expect(result.entities[0].bbox).toEqual({x0:40,y0:20,x1:120,y1:60});
      expect(result.entities.every(e=>!e.verified)).toBe(true);
      expect(terminate).toHaveBeenCalledOnce();
    }finally{Object.defineProperty(globalThis,'Image',{configurable:true,value:originalImage});}
  });
  it('runs a 3500x2500 page in bounded canvas tiles without losing coordinate offsets',async ()=>{
    const originalImage=globalThis.Image,originalDocument=globalThis.document;
    class LargeImage {
      naturalWidth=3500;naturalHeight=2500;
      src='';
      async decode(){return;}
    }
    const canvas={width:0,height:0,getContext:()=>({drawImage:vi.fn()})};
    Object.defineProperty(globalThis,'Image',{configurable:true,value:LargeImage});
    Object.defineProperty(globalThis,'document',{configurable:true,
      value:{createElement:()=>canvas}});
    const recognize=vi.fn().mockResolvedValue({data:{text:'R20',blocks:[{paragraphs:[{lines:[{
      text:'R20',confidence:91,bbox:{x0:30,y0:30,x1:80,y1:50}
    }]}]}]}});
    const terminate=vi.fn().mockResolvedValue(undefined);
    try{
      vi.mocked(createWorker).mockResolvedValue({
        terminate,setParameters:vi.fn().mockResolvedValue(undefined),recognize,
      } as unknown as Awaited<ReturnType<typeof createWorker>>);
      const sheet=newProject().sheets[0];
      sheet.image='data:image/png;base64,fixture';sheet.width=3500;sheet.height=2500;
      const tiles=planOcrTiles(3500,2500);
      expect(tiles.length).toBeGreaterThan(1);
      const out=await recognizeText(sheet);
      expect(recognize).toHaveBeenCalledTimes(tiles.length);
      expect(out.entities).toHaveLength(tiles.length);
      expect(out.entities.map(e=>e.points[0].x)).toContain(30);
      expect(out.entities.some(e=>e.points[0].x>1400)).toBe(true);
      expect(out.entities.every(e=>e.confidence===.91&&!e.verified)).toBe(true);
    }finally{
      Object.defineProperty(globalThis,'Image',{configurable:true,value:originalImage});
      Object.defineProperty(globalThis,'document',{configurable:true,value:originalDocument});
    }
  });
  it('does not create a worker or emit candidates when already cancelled',async ()=>{
    const controller=new AbortController();controller.abort();
    vi.mocked(createWorker).mockClear();
    const sheet=newProject().sheets[0];sheet.image='data:image/png;base64,fixture';
    await expect(recognizeText(sheet,undefined,controller.signal)).rejects.toThrow();
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('downloads/loads only language models and closes worker without any drawing',async ()=>{
    const terminate=vi.fn().mockResolvedValue(undefined);
    const recognize=vi.fn();
    vi.mocked(createWorker).mockResolvedValue({
      terminate,recognize,
    } as unknown as Awaited<ReturnType<typeof createWorker>>);
    const progress:string[]=[];
    await preloadOcrModels(s=>progress.push(s));
    expect(createWorker).toHaveBeenCalledOnce();
    expect(createWorker).toHaveBeenCalledWith(['rus','eng'],1,expect.objectContaining({logger:expect.any(Function)}));
    expect(terminate).toHaveBeenCalledOnce();
    expect(recognize).not.toHaveBeenCalled();
    expect(progress.join(' ')).toContain('готовы');
  });
});
