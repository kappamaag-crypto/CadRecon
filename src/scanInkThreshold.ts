/** Contrast-aware adaptive threshold for scanned engineering drawings.
 * Otsu is applied per original-resolution scan tile. Never use a fixed global
 * "black <165" cutoff when scanning pale grey pencil/photocopy strokes.
 * Border white/range are clamped so a noisy/blank background is not promoted
 * to geometry. This threshold is not an OCR confidence score.
 */
export function otsuInkThreshold(histogram:Uint32Array):number{
  if(histogram.length!==256)return 165;
  let total=0,weighted=0;
  for(let g=0;g<256;g++){total+=histogram[g];weighted+=g*histogram[g];}
  if(!total)return 165;
  let foreground=0,foregroundSum=0,best=-1,threshold=165;
  for(let g=0;g<255;g++){
    foreground+=histogram[g];foregroundSum+=g*histogram[g];
    const background=total-foreground;
    if(foreground===0||background===0)continue;
    const meanA=foregroundSum/foreground,meanB=(weighted-foregroundSum)/background;
    const between=foreground*background*(meanA-meanB)**2;
    if(between>best){best=between;threshold=g;}
  }
  // In a bimodal image, Otsu's boundary can equal the ink value. The
  // comparison MUST be <= threshold; < threshold erased entire faint strokes.
  // Cap at 240 to avoid interpreting paper texture as black geometry.
  return best<0?165:Math.max(40,Math.min(240,threshold));
}


/** Engineering drawings exported by KOMPAS-3D may use actual coloured CAD
 * LINE styles (blue, cyan, green, red), not annotations. A pure luminance
 * channel discards faint saturated strokes. This tonal projection retains
 * achromatic pencil strokes exactly and lowers the value of saturated ink.
 * It is NOT a colour-segmentation/annotation classifier or geometry proof.
 */
export function scanInkTone(red:number,green:number,blue:number):number{
  const lum=.299*red+.587*green+.114*blue;
  const lo=Math.min(red,green,blue),hi=Math.max(red,green,blue);
  if(hi-lo>=45&&lo<225&&lum<246)
    return Math.max(0,Math.min(255,Math.round(Math.min(lum,.55*lo+.45*lum))));
  return Math.max(0,Math.min(255,Math.round(lum)));
}
