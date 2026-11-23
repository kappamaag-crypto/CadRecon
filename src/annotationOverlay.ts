/** Detect a LIKELY coloured markup overlay on a local CAD screenshot.
 * Blue traces can be the reference annotation itself. Recovering those pixels
 * is not evidence that the original, unannotated drawing was recognized.
 * Pure risk signal only; never modifies the image, geometry, or benchmark.
 */
export interface OverlayRisk {
  samples:number;
  coloredPixels:number;
  neutralInkPixels:number;
  coloredFraction:number;
  likelyMarkup:boolean;
}
export function inspectAnnotationColors(
  rgba:Uint8ClampedArray,width:number,height:number
):OverlayRisk{
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||
    rgba.length<width*height*4||width*height>1_000_000)
    throw new Error('Аннотации: недопустимые размеры источника');
  let colored=0,neutral=0,samples=0;
  const step=Math.max(1,Math.ceil(width*height/250_000));
  for(let i=0;i<width*height;i+=step){
    const j=i*4,r=rgba[j],g=rgba[j+1],b=rgba[j+2],alpha=rgba[j+3];
    if(alpha<180)continue;
    samples++;
    const blue=r<190&&b>=120&&b-r>=45&&b-g>=25;
    const cyan=r<145&&g>=90&&b>=90&&g-r>=45&&b-r>=45;
    if(blue||cyan)colored++;
    if(Math.max(r,g,b)-Math.min(r,g,b)<=24&&
      .299*r+.587*g+.114*b<170)neutral++;
  }
  const coloredFraction=samples?colored/samples:0;
  // Both coloured outlines and independent dark monochrome ink are present.
  // This is a WARNING, not a proof that the colours are user annotations:
  // original engineering CAD drawings may also intentionally use colours.
  const likelyMarkup=samples>=300&&colored>=25&&neutral>=25&&
    coloredFraction>=.004&&neutral/samples>=.004;
  return {samples,coloredPixels:colored,neutralInkPixels:neutral,
    coloredFraction,likelyMarkup};
}
export function inspectAnnotationImage(image:HTMLImageElement):OverlayRisk|null {
  if(!image.naturalWidth||!image.naturalHeight)return null;
  const ratio=Math.min(1,256/Math.max(image.naturalWidth,image.naturalHeight));
  const w=Math.max(2,Math.round(image.naturalWidth*ratio)),
    h=Math.max(2,Math.round(image.naturalHeight*ratio));
  const canvas=document.createElement('canvas');
  canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)return null;
  ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
  ctx.drawImage(image,0,0,w,h);
  const risk=inspectAnnotationColors(ctx.getImageData(0,0,w,h).data,w,h);
  canvas.width=0;canvas.height=0;
  return risk;
}
