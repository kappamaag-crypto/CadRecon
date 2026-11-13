import {describe,it,expect} from 'vitest';
import {newProject} from './model';
import {decodeAdvancedResponse,validateAdvancedEndpoint} from './advanced';
describe('optional private high-quality OCR backend',()=>{
  it('requires HTTPS except local loopback',()=>{
    expect(validateAdvancedEndpoint('http://127.0.0.1:8765/')).toBe('http://127.0.0.1:8765');
    expect(validateAdvancedEndpoint('https://cad.example.org/')).toBe('https://cad.example.org');
    expect(()=>validateAdvancedEndpoint('http://public.example.org')).toThrow();
    expect(()=>validateAdvancedEndpoint('https://u:password@cad.example.org')).toThrow();
  });
  it('translates model boxes and segments to sheet coordinates and preserves review flags',()=>{
    const s=newProject().sheets[0];s.width=200;s.height=100;
    const result=decodeAdvancedResponse(s,{width:400,height:200,engine:'PaddleOCR PP-OCRv5 + OpenCV',
      texts:[{text:'Áîëò M24x90',confidence:.94,box:[20,40,140,60]}],
      lines:[{a:[5,10],b:[395,10],confidence:.83}],
      circles:[{center:[200,100],radius:25,confidence:.7}],
      polygons:[{points:[[100,100],[120,100],[110,115]],confidence:.67}]});
    expect(result.entities).toHaveLength(4);
    expect(result.entities[0].text).toBe('Болт M24x90');
    expect(result.entities[0].bbox).toEqual({x0:10,y0:20,x1:70,y1:30});
    expect(result.entities[1].points[1].x).toBe(197.5);
    expect(result.entities[2].center).toEqual({x:100,y:50});
    expect(result.entities.every(e=>!e.verified)).toBe(true);
  });
});