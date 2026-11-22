/** Browser-only bounded tiling of large engineering scans for Tesseract.
 * Transparent geometry: all result boxes remain in original image pixels,
 * then convert once into sheet coordinates.
 */
export interface OcrTile {x:number;y:number;width:number;height:number;}
export function planOcrTiles(
  width:number,height:number,
  tileSize=1600,overlap=160,
):OcrTile[]{
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2)
    throw new Error('OCR: некорректные размеры растра');
  if(tileSize<256||overlap<0||overlap>=tileSize/2)
    throw new Error('OCR: некорректные параметры фрагментации');
  if(width*height<=4_000_000&&width<=3000&&height<=3000)
    return [{x:0,y:0,width,height}];
  const step=tileSize-overlap;
  const xPositions:number[]=[],yPositions:number[]=[];
  for(let x=0;;x+=step){
    const at=Math.max(0,Math.min(x,width-tileSize));
    if(xPositions.length&&at===xPositions[xPositions.length-1])break;
    xPositions.push(at);
    if(at+tileSize>=width)break;
  }
  for(let y=0;;y+=step){
    const at=Math.max(0,Math.min(y,height-tileSize));
    if(yPositions.length&&at===yPositions[yPositions.length-1])break;
    yPositions.push(at);
    if(at+tileSize>=height)break;
  }
  if(xPositions.length*yPositions.length>100)
    throw new Error('OCR: более 100 фрагментов. Разбейте большой чертёж на отдельные листы.');
  return yPositions.flatMap(y=>xPositions.map(x=>({
    x,y,width:Math.min(tileSize,width-x),height:Math.min(tileSize,height-y),
  })));
}
export interface OcrBox {x0:number;y0:number;x1:number;y1:number;text:string;}
/** Deduplicate the SAME text line in overlapping tiles, never neighboring
 * distinct notes. A substantial bounding-box intersection is required. */
export function sameOcrLine(a:OcrBox,b:OcrBox):boolean{
  if(a.text.trim()!==b.text.trim())return false;
  const ix=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0));
  const iy=Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
  const common=ix*iy,areaA=Math.max(0,(a.x1-a.x0)*(a.y1-a.y0));
  const areaB=Math.max(0,(b.x1-b.x0)*(b.y1-b.y0));
  return Math.min(areaA,areaB)>0&&common/Math.min(areaA,areaB)>=.7;
}

/** Map OCR from a 90-degree canvas back to the ORIGINAL source pixels.
 * Canvas +90: (X,Y)=(H-y,x); Canvas -90: (X,Y)=(y,W-x).
 * Returned boxes are not dimension measurements.
 */
export function unrotateOcrBox(
  box:OcrBox,originalWidth:number,originalHeight:number,angle:90|-90
):OcrBox {
  if(angle===90)return {...box,
    x0:box.y0,x1:box.y1,
    y0:originalHeight-box.x1,y1:originalHeight-box.x0};
  return {...box,
    x0:originalWidth-box.y1,x1:originalWidth-box.y0,
    y0:box.x0,y1:box.x1};
}


/** Bounded ±90° pass for A0/A1 scanned drawings.
 * Large pages are already tiled at original pixel resolution. Do not rotate
 * the entire 6800x4700 canvas: use selected original tiles, maintain tile
 * offsets and explicitly report incomplete coverage to the operator.
 * Selection samples the whole sheet, including the right-bottom title-block.
 */
export interface VerticalOcrSelection {
  tiles:OcrTile[];skipped:number;complete:boolean;
}
export function planVerticalOcrTiles(tiles:OcrTile[],maxTiles=8):VerticalOcrSelection{
  if(!Number.isInteger(maxTiles)||maxTiles<1||maxTiles>100)
    throw new Error('OCR: неверный предел повёрнутых фрагментов');
  if(tiles.length<=maxTiles)return {tiles:[...tiles],skipped:0,complete:true};
  if(maxTiles===1)return {tiles:[tiles[tiles.length-1]],skipped:tiles.length-1,complete:false};
  // Include first and last fragments (the final is usually the title block).
  const positions=new Set<number>([0,tiles.length-1]);
  for(let i=0;i<maxTiles&&positions.size<maxTiles;i++){
    const at=Math.round(i*(tiles.length-1)/(maxTiles-1));
    positions.add(at);
  }
  // Adjacent rounded samples may collide; fill deterministically.
  for(let i=tiles.length-1;i>=0&&positions.size<maxTiles;i--)positions.add(i);
  const selected=[...positions].sort((a,b)=>a-b).map(i=>tiles[i]);
  return {tiles:selected,skipped:tiles.length-selected.length,complete:false};
}
