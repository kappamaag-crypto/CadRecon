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
