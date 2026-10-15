/** Validated hex only; keep both tinted badges and text emphasis readable. */
export function optionStyle(hex?: string, badge = true) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return undefined;
  const rgb = [1, 3, 5].map((n) => parseInt(hex.slice(n, n + 2), 16));
  const luminance = (v: number[]) => v.map((c) => c / 255).map((c) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
  const background = rgb.map((c) => Math.round(c * .14 + 255 * .86));
  let foreground = [...rgb];
  while ((luminance(badge ? background : [250, 247, 241]) + .05) / (luminance(foreground) + .05) < 4.5) foreground = foreground.map((c) => Math.floor(c * .85));
  const color = `rgb(${foreground.join(",")})`;
  return badge ? { color, backgroundColor: `rgb(${background.join(",")})`, borderColor: hex } : { color };
}
