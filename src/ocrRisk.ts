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
  const criticalLabel=/(?:^|[^\p{L}])(?:R[az]\s*\d|[Ø⌀∅⌀Фф]\s*\d|M\s*\d+(?:[×xхXХ]\s*\d|\s*[xхXХ]\s*\d)|±\s*\d)/iu.test(text);
  if(criticalLabel)warnings.push('Критичное техническое обозначение: диаметр, резьба с шагом, шероховатость или допуск. Сверить символы и запятую по оригиналу');
  const needsReread=numericConfusable||(mixed&&/\d/.test(text));
  return {needsReread,criticalLabel,needsReview:warnings.length>0,warnings};
}
