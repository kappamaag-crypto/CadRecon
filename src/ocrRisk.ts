/** Engineering OCR risk flags: never silently correct text or claim accuracy.
 *
 * Tesseract may report high confidence for dimension 8O0 (letter O instead
 * of zero), M1l (lowercase ell vs one), or mixed Cyrillic/Latin glyphs.
 * A high score is not a reason to bypass review on safety-critical drawings.
 * The signals are deliberately conservative annotations and a bounded reason
 * to re-read using an enlarged local crop, not replacements.
 */
export interface TechnicalOcrRisk{
  needsReread:boolean;
  needsReview:boolean;
  criticalLabel:boolean;
  warnings:string[];
}
export function assessTechnicalOcr(text:string):TechnicalOcrRisk{
  if(!text||text.length>4000)return {needsReread:false,needsReview:false,criticalLabel:false,warnings:[]};
  const warnings:string[]=[];
  // Confusable zero/O and one/l/I between or next to numeric characters.
  // Diameter ⌀/Ø is intentionally NOT listed as a fake zero.
  const numericConfusable=/(?:\d[ОоOoIlІі|]|\b[ОоOoIlІі|]\d)/u.test(text);
  if(numericConfusable)warnings.push('Цифра/похожая буква (0/O/О или 1/I/l): перепроверьте числовое значение');
  const tokens=text.match(/[\p{L}\p{N}⌀Ø|]+/gu)||[];
  const mixed=tokens.some(token=>/[A-Za-z]/.test(token)&&/[А-Яа-яЁё]/u.test(token));
  if(mixed)warnings.push('Смешаны кириллица и латиница в одной надписи: проверьте обозначение');
  // This is a REVIEW category, NOT a claim that a legitimate label is wrong.
  // Prioritize the particularly fragile signs visible on engineering sheets:
  // roughness Ra/Rz, diameter, pitch in thread designations and tolerance.
  // Keep standalone ordinary measurements outside this semantic heuristic.
  const criticalLabel=/(?:^|[^\p{L}])(?:R[az]\s*\d|[Ø⌀∅Фф]\s*\d|[MМ]\s*\d+\s*[×xхXХ]\s*\d|±\s*\d)/iu.test(text);
  if(criticalLabel)warnings.push('Критичное техническое обозначение: диаметр, резьба с шагом, шероховатость или допуск. Сверить символы и запятую по оригиналу');
  // Symbols from real mechanical drawings: an OCR engine can be extremely
  // confident about Ø2S,4 or Ra O,8 although neither is a valid numeric
  // dimension/roughness value. Flag for a local re-read, never substitute.
  // Accept both comma and dot as decimal separators, as printed.
  const decimal=/^\d+(?:[.,]\d+)?$/u;
  const stripTerminal=(s:string)=>s.replace(/[;:.)\]]+$/u,'');
  const roughness=[...text.matchAll(/\bR[az]\s+([^\s;]+)/giu)]
    .some(m=>!decimal.test(stripTerminal(m[1])));
  const diameter=[...text.matchAll(/[⌀Ø∅]\s*([^\s;]+)/gu)]
    .some(m=>!decimal.test(stripTerminal(m[1])));
  if(roughness)warnings.push('Нечитаемое числовое значение Ra/Rz: проверьте шероховатость по оригиналу');
  if(diameter)warnings.push('Нечитаемое число после знака диаметра: проверьте Ø/⌀ и цифры');
  // Font-map corruption and bad OCR are not merely low-confidence labels.
  // Even a high Tesseract score should trigger a bounded crop reread.
  const corrupt=/[\uFFFD\uE000-\uF8FF\u0000-\u0008\u000E-\u001F]/u.test(text)||
    /(?:Ã.|Â.|Ð.|Ñ.){2,}/u.test(text);
  if(corrupt)warnings.push('Нечитаемые символы или повреждённая кодировка: повторный OCR и ручная проверка оригинала');
  const needsReread=numericConfusable||(mixed&&/\d/.test(text))||roughness||diameter||corrupt;
  return {needsReread,criticalLabel,needsReview:warnings.length>0,warnings};
}
