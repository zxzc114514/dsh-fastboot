export function replaceOnce(src, target, replacement, label) {
  const idx = src.indexOf(target);
  if (idx === -1) throw new Error(`Target not found [${label}]`);
  if (src.indexOf(target, idx + 1) !== -1) throw new Error(`Target matched multiple times [${label}]`);
  return src.slice(0, idx) + replacement + src.slice(idx + target.length);
}

export function makeAsarImmutableHelper(fnName = "isAsarImmutablePath") {
  return `function ${fnName}(p) {
	return typeof p === "string" && (p.includes(".asar\\\\") || p.includes(".asar/") || p.endsWith(".asar")) && !p.includes(".asar.unpacked\\\\") && !p.includes(".asar.unpacked/");
}`;
}
