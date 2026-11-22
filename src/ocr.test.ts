import {describe,it,expect,vi} from 'vitest';
import {createWorker} from 'tesseract.js';
import {preloadOcrModels} from './ocr';

vi.mock('tesseract.js',()=>({
  createWorker:vi.fn(),
  PSM:{SPARSE_TEXT:11},
}));

describe('browser OCR language pack preparation',()=>{
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
