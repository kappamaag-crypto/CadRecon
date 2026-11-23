import {describe,it,expect,vi} from 'vitest';
import {createWorker} from 'tesseract.js';
import {preloadOcrModels,recognizeText} from './ocr';
import {newProject} from './model';
import {planOcrTiles} from './ocrTiles';

vi.mock('tesseract.js',()=>({
  createWorker:vi.fn(),
  PSM:{SPARSE_TEXT:11,SINGLE_LINE:7},
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
  it('uses opaque white Canvas even for a standard single-page PNG when available',async()=>{
    const oldImage=globalThis.Image,oldDoc=globalThis.document;
    class Img{naturalWidth=300;naturalHeight=200;src='';async decode(){}}
    const ops:string[]=[],ctx={fillStyle:'',
      fillRect:vi.fn(()=>ops.push('white')),
      drawImage:vi.fn(()=>ops.push('image'))};
    const canvas={width:0,height:0,getContext:()=>ctx};
    Object.defineProperty(globalThis,'Image',{configurable:true,value:Img});
    Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>canvas}});
    const recognize=vi.fn().mockResolvedValue({data:{text:'',blocks:[]}});
    try{
      vi.mocked(createWorker).mockResolvedValue({
        terminate:vi.fn().mockResolvedValue(undefined),
        setParameters:vi.fn().mockResolvedValue(undefined),recognize,
      } as unknown as Awaited<ReturnType<typeof createWorker>>);
      const sheet=newProject().sheets[0];sheet.image='data:image/png;base64,fixture';
      await recognizeText(sheet);
      expect(ops).toEqual(['white','image']);
      expect(ctx.fillStyle).toBe('#fff');
      expect(ctx.fillRect).toHaveBeenCalledWith(0,0,300,200);
      expect(recognize).toHaveBeenCalledWith(canvas,{}, {blocks:true,text:true});
    }finally{
      Object.defineProperty(globalThis,'Image',{configurable:true,value:oldImage});
      Object.defineProperty(globalThis,'document',{configurable:true,value:oldDoc});
    }
  });
  it('runs a 3500x2500 page in bounded canvas tiles without losing coordinate offsets',async ()=>{
    const originalImage=globalThis.Image,originalDocument=globalThis.document;
    class LargeImage {
      naturalWidth=3500;naturalHeight=2500;
      src='';
      async decode(){return;}
    }
    const drawImage=vi.fn(),fillRect=vi.fn();
    const context={drawImage,fillRect,fillStyle:''};
    const canvas={width:0,height:0,getContext:()=>context};
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
      expect(fillRect).toHaveBeenCalledTimes(tiles.length);
      expect(context.fillStyle).toBe('#fff');
      expect(fillRect.mock.invocationCallOrder[0]).toBeLessThan(drawImage.mock.invocationCallOrder[0]);
      expect(out.entities).toHaveLength(tiles.length);
      expect(out.entities.map(e=>e.points[0].x)).toContain(30);
      expect(out.entities.some(e=>e.points[0].x>1400)).toBe(true);
      expect(out.entities.every(e=>e.confidence===.91&&!e.verified)).toBe(true);
    }finally{
      Object.defineProperty(globalThis,'Image',{configurable:true,value:originalImage});
      Object.defineProperty(globalThis,'document',{configurable:true,value:originalDocument});
    }
  });
  it('enhanced OCR re-reads a low confidence technical value on 2.5x canvas and preserves conflict',async()=>{
    const oldImage=globalThis.Image,oldDoc=globalThis.document;
    class Img {naturalWidth=200;naturalHeight=100;src='';async decode(){}}
    const canvas={width:0,height:0,getContext:()=>({
      drawImage:vi.fn(),fillRect:vi.fn(),save:vi.fn(),restore:vi.fn(),translate:vi.fn(),rotate:vi.fn(),
      filter:'none',imageSmoothingEnabled:false,imageSmoothingQuality:'low',
    })};
    Object.defineProperty(globalThis,'Image',{configurable:true,value:Img});
    Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>canvas}});
    const main={data:{text:'8O0',blocks:[{paragraphs:[{lines:[{
      text:'8O0',confidence:40,bbox:{x0:20,y0:10,x1:80,y1:22},
    }]}]}]}};
    const retry={data:{text:'800',confidence:93,blocks:[{paragraphs:[{lines:[{
      text:'800',confidence:93,bbox:{x0:2,y0:4,x1:155,y1:35},
    }]}]}]}};
    const recognize=vi.fn().mockResolvedValueOnce(main).mockResolvedValueOnce(retry);
    const parameters=vi.fn().mockResolvedValue(undefined),terminate=vi.fn().mockResolvedValue(undefined);
    try{
      vi.mocked(createWorker).mockResolvedValue({
        terminate,recognize,setParameters:parameters,
      } as unknown as Awaited<ReturnType<typeof createWorker>>);
      const sheet=newProject().sheets[0];sheet.image='data:image/png;base64,fixture';
      sheet.width=200;sheet.height=100;
      const out=await recognizeText(sheet,undefined,undefined,{mode:'enhanced'});
      expect(recognize).toHaveBeenCalledTimes(2);
      expect(out.entities).toHaveLength(1);
      expect(out.entities[0].text).toBe('800');
      expect(out.entities[0].reason).toContain('8O0');
      expect(out.entities[0].bbox).toEqual({x0:20,y0:10,x1:80,y1:22});
      expect(out.entities[0].verified).toBe(false);
      expect(out.diagnostics?.promoted).toBe(1);
      expect(terminate).toHaveBeenCalledOnce();
    }finally{
      Object.defineProperty(globalThis,'Image',{configurable:true,value:oldImage});
      Object.defineProperty(globalThis,'document',{configurable:true,value:oldDoc});
    }
  });
  it('enhanced OCR rechecks uncertain roughness without overwriting plausible text',async()=>{
    const oldImage=globalThis.Image,oldDoc=globalThis.document;
    class Img {naturalWidth=200;naturalHeight=100;src='';async decode(){}}
    const canvas={width:0,height:0,getContext:()=>({
      drawImage:vi.fn(),fillRect:vi.fn(),save:vi.fn(),restore:vi.fn(),
    })};
    Object.defineProperty(globalThis,'Image',{configurable:true,value:Img});
    Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>canvas}});
    const response=(value:string,score:number)=>({data:{text:value,confidence:score,
      blocks:[{paragraphs:[{lines:[{text:value,confidence:score,
        bbox:{x0:20,y0:10,x1:100,y1:28}}]}]}]}}); // 18px high, no tiny-text fallback
    const recognize=vi.fn()
      .mockResolvedValueOnce(response('Ra 0,8',86))
      .mockResolvedValueOnce(response('Ra 0,6',88));
    try{
      vi.mocked(createWorker).mockResolvedValue({
        terminate:vi.fn().mockResolvedValue(undefined),
        setParameters:vi.fn().mockResolvedValue(undefined),recognize,
      } as unknown as Awaited<ReturnType<typeof createWorker>>);
      const sheet=newProject().sheets[0];sheet.image='data:image/png;base64,fixture';
      sheet.width=200;sheet.height=100;
      const result=await recognizeText(sheet,undefined,undefined,
        {mode:'enhanced',maxRetries:5});
      expect(recognize).toHaveBeenCalledTimes(2);
      expect(result.entities[0].text).toBe('Ra 0,8'); // conflict, no auto-fix
      expect(result.entities[0].reason).toContain('Ra 0,6');
      expect(result.entities[0].reason).toContain('Критичное техническое обозначение');
      expect(result.entities[0].verified).toBe(false);
      expect(result.diagnostics?.conflicts).toBe(1);
    }finally{
      Object.defineProperty(globalThis,'Image',{configurable:true,value:oldImage});
      Object.defineProperty(globalThis,'document',{configurable:true,value:oldDoc});
    }
  });
  it('enhanced OCR keeps 6000 when close-confidence retry says 8000',async()=>{
    const oldImage=globalThis.Image,oldDoc=globalThis.document;
    class Img {naturalWidth=200;naturalHeight=100;src='';async decode(){}}
    const canvas={width:0,height:0,getContext:()=>({
      drawImage:vi.fn(),fillRect:vi.fn(),save:vi.fn(),restore:vi.fn(),
    })};
    Object.defineProperty(globalThis,'Image',{configurable:true,value:Img});
    Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>canvas}});
    const data=(text:string,confidence:number)=>({data:{text,blocks:[{paragraphs:[{lines:[{
      text,confidence,bbox:{x0:20,y0:10,x1:70,y1:22},
    }]}]}]}});
    const recognize=vi.fn().mockResolvedValueOnce(data('6000',80)).mockResolvedValueOnce(data('8000',87));
    try{
      vi.mocked(createWorker).mockResolvedValue({
        terminate:vi.fn().mockResolvedValue(undefined),
        setParameters:vi.fn().mockResolvedValue(undefined),recognize,
      } as unknown as Awaited<ReturnType<typeof createWorker>>);
      const sheet=newProject().sheets[0];sheet.image='data:image/png;base64,fixture';
      sheet.width=200;sheet.height=100;
      const out=await recognizeText(sheet,undefined,undefined,{mode:'enhanced'});
      expect(out.entities[0].text).toBe('6000');
      expect(out.entities[0].reason).toContain('8000');
      expect(out.diagnostics?.conflicts).toBe(1);
    }finally{
      Object.defineProperty(globalThis,'Image',{configurable:true,value:oldImage});
      Object.defineProperty(globalThis,'document',{configurable:true,value:oldDoc});
    }
  });
  it('optional vertical OCR rotates both ways and restores original source bbox',async()=>{
    const oldImage=globalThis.Image,oldDoc=globalThis.document;
    class Img {naturalWidth=200;naturalHeight=100;src='';async decode(){}}
    const canvas={width:0,height:0,getContext:()=>({
      drawImage:vi.fn(),fillRect:vi.fn(),save:vi.fn(),restore:vi.fn(),translate:vi.fn(),rotate:vi.fn(),
    })};
    Object.defineProperty(globalThis,'Image',{configurable:true,value:Img});
    Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>canvas}});
    const noText={data:{text:'',blocks:[]}};
    const plus={data:{text:'ПОЗ 6',blocks:[{paragraphs:[{lines:[{
      text:'ПОЗ 6',confidence:89,bbox:{x0:20,y0:40,x1:85,y1:55},
    }]}]}]}};
    const recognize=vi.fn().mockResolvedValueOnce(noText).mockResolvedValueOnce(plus)
      .mockResolvedValueOnce(noText);
    try{
      vi.mocked(createWorker).mockResolvedValue({
        terminate:vi.fn().mockResolvedValue(undefined),
        setParameters:vi.fn().mockResolvedValue(undefined),recognize,
      } as unknown as Awaited<ReturnType<typeof createWorker>>);
      const sheet=newProject().sheets[0];
      sheet.image='data:image/png;base64,fixture';sheet.width=200;sheet.height=100;
      const result=await recognizeText(sheet,undefined,undefined,
        {mode:'enhanced',detectVertical:true,maxRetries:0});
      expect(result.diagnostics?.rotations).toBe(2);
      expect(recognize).toHaveBeenCalledTimes(3);
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].bbox).toEqual({x0:40,y0:15,x1:55,y1:80});
      expect(result.entities[0].reason).toContain('поворот');
      expect(result.entities[0].verified).toBe(false);
    }finally{
      Object.defineProperty(globalThis,'Image',{configurable:true,value:oldImage});
      Object.defineProperty(globalThis,'document',{configurable:true,value:oldDoc});
    }
  });
  it('finds vertical OCR text on multi-tile 3500x2500 without a full-page rotated canvas',async()=>{
    const oldImage=globalThis.Image,oldDoc=globalThis.document;
    class Img{naturalWidth=3500;naturalHeight=2500;src='';async decode(){}}
    const canvas={width:0,height:0,getContext:()=>({
      drawImage:vi.fn(),fillRect:vi.fn(),save:vi.fn(),restore:vi.fn(),translate:vi.fn(),rotate:vi.fn(),
    })};
    Object.defineProperty(globalThis,'Image',{configurable:true,value:Img});
    Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>canvas}});
    const tiles=planOcrTiles(3500,2500),n=tiles.length;
    const last=tiles[n-1],noText={data:{text:'',blocks:[]}};
    const found={data:{text:'ОСЬ 2',blocks:[{paragraphs:[{lines:[{
      text:'ОСЬ 2',confidence:88,bbox:{x0:10,y0:20,x1:45,y1:90},
    }]}]}]}};
    let count=0;
    const recognize=vi.fn(async()=>++count===n+(n-1)*2+1?found:noText);
    try{
      vi.mocked(createWorker).mockResolvedValue({
        recognize,terminate:vi.fn().mockResolvedValue(undefined),
        setParameters:vi.fn().mockResolvedValue(undefined),
      } as unknown as Awaited<ReturnType<typeof createWorker>>);
      const sheet=newProject().sheets[0];sheet.image='data:image/png;base64,fixture';
      sheet.width=3500;sheet.height=2500;
      const out=await recognizeText(sheet,undefined,undefined,
        {mode:'enhanced',detectVertical:true,maxRetries:0});
      expect(recognize).toHaveBeenCalledTimes(n*3);
      expect(out.diagnostics?.rotations).toBe(n*2);
      expect(out.entities).toHaveLength(1);
      expect(out.entities[0].bbox).toEqual({
        x0:last.x+20,x1:last.x+90,
        y0:last.y+last.height-45,y1:last.y+last.height-10,
      });
      expect(out.warnings||[]).not.toContain(expect.stringContaining('пропущен'));
      expect(out.entities[0].verified).toBe(false);
    }finally{
      Object.defineProperty(globalThis,'Image',{configurable:true,value:oldImage});
      Object.defineProperty(globalThis,'document',{configurable:true,value:oldDoc});
    }
  });
  it('explicitly reports partial vertical coverage on huge A0-like scan instead of silently skipping',async()=>{
    const oldImage=globalThis.Image,oldDoc=globalThis.document;
    class Img{naturalWidth=6800;naturalHeight=4700;src='';async decode(){}}
    const cv={width:0,height:0,getContext:()=>({
      drawImage:vi.fn(),fillRect:vi.fn(),save:vi.fn(),restore:vi.fn(),translate:vi.fn(),rotate:vi.fn(),
    })};
    Object.defineProperty(globalThis,'Image',{configurable:true,value:Img});
    Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>cv}});
    const recognize=vi.fn().mockResolvedValue({data:{text:'',blocks:[]}});
    try{
      vi.mocked(createWorker).mockResolvedValue({
        recognize,setParameters:vi.fn().mockResolvedValue(undefined),
        terminate:vi.fn().mockResolvedValue(undefined),
      } as unknown as Awaited<ReturnType<typeof createWorker>>);
      const sheet=newProject().sheets[0];sheet.image='data:image/png;base64,fixture';
      sheet.width=6800;sheet.height=4700;
      const tiles=planOcrTiles(6800,4700);
      const out=await recognizeText(sheet,undefined,undefined,
        {mode:'enhanced',detectVertical:true,maxRetries:0});
      expect(tiles.length).toBeGreaterThan(8);
      expect(out.diagnostics?.rotations).toBe(16);
      expect(recognize).toHaveBeenCalledTimes(tiles.length+16);
      expect(out.warnings?.join(' ')).toContain('не пропустить подписи');
    }finally{
      Object.defineProperty(globalThis,'Image',{configurable:true,value:oldImage});
      Object.defineProperty(globalThis,'document',{configurable:true,value:oldDoc});
    }
  });
  it('aborts during expensive retry without returning partially recognized CAD text',async()=>{
    const oldImage=globalThis.Image,oldDoc=globalThis.document;
    class Img {naturalWidth=200;naturalHeight=100;src='';async decode(){}}
    const canvas={width:0,height:0,getContext:()=>({
      drawImage:vi.fn(),fillRect:vi.fn(),save:vi.fn(),restore:vi.fn(),
    })};
    Object.defineProperty(globalThis,'Image',{configurable:true,value:Img});
    Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>canvas}});
    const ctrl=new AbortController();
    const main={data:{text:'A',blocks:[{paragraphs:[{lines:[{
      text:'A',confidence:20,bbox:{x0:20,y0:10,x1:50,y1:22},
    }]}]}]}};
    const recognize=vi.fn().mockResolvedValueOnce(main).mockImplementationOnce(async()=>{
      ctrl.abort();
      return main;
    });
    const terminate=vi.fn().mockResolvedValue(undefined);
    try{
      vi.mocked(createWorker).mockResolvedValue({
        terminate,setParameters:vi.fn().mockResolvedValue(undefined),recognize,
      } as unknown as Awaited<ReturnType<typeof createWorker>>);
      const sheet=newProject().sheets[0];sheet.image='data:image/png;base64,fixture';
      await expect(recognizeText(sheet,undefined,ctrl.signal,{mode:'enhanced'})).rejects.toThrow();
      expect(terminate).toHaveBeenCalled();
    }finally{
      Object.defineProperty(globalThis,'Image',{configurable:true,value:oldImage});
      Object.defineProperty(globalThis,'document',{configurable:true,value:oldDoc});
    }
  });
  it('rechecks high-confidence dimension 8O0 but never silently changes it to 800',async()=>{
    const oldImage=globalThis.Image,oldDoc=globalThis.document;
    class Img{naturalWidth=200;naturalHeight=100;src='';async decode(){}}
    const cv={width:0,height:0,getContext:()=>({
      drawImage:vi.fn(),fillRect:vi.fn(),save:vi.fn(),restore:vi.fn(),translate:vi.fn(),rotate:vi.fn(),
      imageSmoothingEnabled:true,imageSmoothingQuality:'high',filter:'',
    })};
    Object.defineProperty(globalThis,'Image',{configurable:true,value:Img});
    Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>cv}});
    const data=(text:string,confidence:number)=>({data:{text,confidence,
      blocks:[{paragraphs:[{lines:[{text,confidence,
        bbox:{x0:20,y0:10,x1:80,y1:35}}]}]}]}});
    const recognize=vi.fn().mockResolvedValueOnce(data('8O0',95))
      .mockResolvedValueOnce(data('800',96));
    try{
      vi.mocked(createWorker).mockResolvedValue({
        recognize,setParameters:vi.fn().mockResolvedValue(undefined),
        terminate:vi.fn().mockResolvedValue(undefined),
      } as unknown as Awaited<ReturnType<typeof createWorker>>);
      const s=newProject().sheets[0];s.image='data:image/png;base64,fixture';
      s.width=200;s.height=100;
      const out=await recognizeText(s,undefined,undefined,
        {mode:'enhanced',maxRetries:1});
      expect(recognize).toHaveBeenCalledTimes(2);
      expect(out.diagnostics?.retried).toBe(1);
      expect(out.diagnostics?.conflicts).toBe(1);
      expect(out.entities).toHaveLength(1);
      expect(out.entities[0].text).toBe('8O0');
      expect(out.entities[0].reason).toContain('800');
      expect(out.entities[0].reason).toContain('ПОДОЗРЕНИЕ OCR');
      expect(out.entities[0].verified).toBe(false);
    }finally{
      Object.defineProperty(globalThis,'Image',{configurable:true,value:oldImage});
      Object.defineProperty(globalThis,'document',{configurable:true,value:oldDoc});
    }
  });
  it('supports a single English OCR language model instead of always forcing Russian',async()=>{
    const oldImage=globalThis.Image;
    class Img{naturalWidth=200;naturalHeight=100;src='';async decode(){}}
    Object.defineProperty(globalThis,'Image',{configurable:true,value:Img});
    try{
      vi.mocked(createWorker).mockResolvedValue({
        terminate:vi.fn().mockResolvedValue(undefined),
        setParameters:vi.fn().mockResolvedValue(undefined),
        recognize:vi.fn().mockResolvedValue({data:{text:'M16',blocks:[]}}),
      } as unknown as Awaited<ReturnType<typeof createWorker>>);
      const sheet=newProject().sheets[0];sheet.image='data:image/png;base64,fixture';
      await recognizeText(sheet,undefined,undefined,{languages:'eng'});
      expect(createWorker).toHaveBeenCalledWith(['eng'],1,expect.any(Object));
    }finally{
      Object.defineProperty(globalThis,'Image',{configurable:true,value:oldImage});
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
