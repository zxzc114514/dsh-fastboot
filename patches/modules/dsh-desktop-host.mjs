import { replaceOnce } from "./utils.mjs";

export function patchDshDesktopHost({ readFromAsar, setReplacement, log = () => {} }) {
  const filePath = "dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js";
  let code = readFromAsar(filePath);

  if (code.includes('import { registerHooks } from "node:module";')) {
    code = replaceOnce(
      code,
      `import { registerHooks } from "node:module";`,
      `import { realpathSync, writeFileSync as __dshWriteFileSync } from "node:fs";
import { performance as __dshPerf } from "node:perf_hooks";
const __DSH_BOOT_T0__ = __dshPerf.now();
const __bootSlabCtrl = globalThis[Symbol.for("@deepseek-ai/dsh-app-boot/boot-slab")];
__bootSlabCtrl?.enable({ projectDir: process.argv[3] });`,
      "dsh-desktop-host legacy top timing + remove registerHooks import"
    );
    code = replaceOnce(
      code,
      `import { realpathSync } from "node:fs";\n`,
      "",
      "dsh-desktop-host legacy deduplicate realpathSync"
    );
    if (code.includes("function installOfficeEngineResolution(runtimeDir)")) {
      // 用精确替换内联 office redirect（适配 rc.1）
      code = replaceOnce(
        code,
`function installOfficeEngineResolution(runtimeDir) {
	if (runtimeArchivePath(runtimeDir) === void 0) return void 0;
	const root = realpathSync(runtimeDir);
	const archive = dirname(root);
	const source = pathToFileURL(join(root, "node_modules", "@deepseek-ai", "libreoffice-kit-")).href;
	const destination = pathToFileURL(join(\`\${archive}.unpacked\`, relative(archive, root), "node_modules", "@deepseek-ai", "libreoffice-kit-")).href;
	return registerHooks({ resolve(specifier, context, nextResolve) {
		const resolved = nextResolve(specifier, context);
		if (!resolved.url.startsWith("file:")) return resolved;
		const engineRequest = /^@deepseek-ai\\/libreoffice-kit-(?:darwin|win32|linux)-/u.test(specifier);
		const engineTarget = /\\/node_modules\\/@deepseek-ai\\/libreoffice-kit-(?:darwin|win32|linux)-[^/]+\\//u.test(new URL(resolved.url).pathname);
		if (!engineRequest && !engineTarget) return resolved;
		const canonical = pathToFileURL(realpathSync(fileURLToPath(resolved.url))).href;
		if (!canonical.startsWith(source)) {
			if (canonical.startsWith(pathToFileURL(archive + "/").href)) throw new Error(\`desktop Office engine resolved outside the runtime package directory: \${resolved.url}\`);
			return resolved;
		}
		const physical = realpathSync(fileURLToPath(destination + canonical.slice(source.length)));
		return {
			...resolved,
			url: pathToFileURL(physical).href
		};
	} });
}`,
`function installOfficeEngineResolution(runtimeDir) {
	if (runtimeArchivePath(runtimeDir) === void 0) return void 0;
	const root = realpathSync(runtimeDir);
	const archive = dirname(root);
	const source = pathToFileURL(join(root, "node_modules", "@deepseek-ai", "libreoffice-kit-")).href;
	const destination = pathToFileURL(join(\`\${archive}.unpacked\`, relative(archive, root), "node_modules", "@deepseek-ai", "libreoffice-kit-")).href;
	const archiveHref = pathToFileURL(archive + "/").href;
	const reqRe = /^@deepseek-ai\\/libreoffice-kit-(?:darwin|win32|linux)-/u;
	const targetRe = /\\/node_modules\\/@deepseek-ai\\/libreoffice-kit-(?:darwin|win32|linux)-[^/]+\\//u;
	const resolveFileUrl = (urlHref, specifier) => {
		if (!urlHref.startsWith("file:")) return void 0;
		const engineRequest = reqRe.test(specifier);
		const engineTarget = targetRe.test(new URL(urlHref).pathname);
		if (!engineRequest && !engineTarget) return void 0;
		const canonical = pathToFileURL(realpathSync(fileURLToPath(urlHref))).href;
		if (!canonical.startsWith(source)) {
			if (canonical.startsWith(archiveHref)) throw new Error(\`desktop Office engine resolved outside the runtime package directory: \${urlHref}\`);
			return void 0;
		}
		return realpathSync(fileURLToPath(destination + canonical.slice(source.length)));
	};
	globalThis[Symbol.for("@deepseek-ai/dsh-app-boot/office-engine-redirect")] = {
		redirectPath(filename, request) {
			const physical = resolveFileUrl(pathToFileURL(filename).href, request);
			return physical ?? filename;
		},
		redirectUrl(resolved, specifier) {
			const physical = resolveFileUrl(resolved.url, specifier);
			return physical === void 0 ? resolved : { ...resolved, url: pathToFileURL(physical).href };
		}
	};
}`,
        "dsh-desktop-host legacy inline office redirect"
      );
    }
  } else {
    code = replaceOnce(
      code,
      `import { parsePluginOperationRecord } from "@deepseek-ai/dsh-plugin-manager/diagnostic";`,
      `import { writeFileSync as __dshWriteFileSync } from "node:fs";
import { performance as __dshPerf } from "node:perf_hooks";
import { parsePluginOperationRecord } from "@deepseek-ai/dsh-plugin-manager/diagnostic";
const __DSH_BOOT_T0__ = __dshPerf.now();
const __bootSlabCtrl = globalThis[Symbol.for("@deepseek-ai/dsh-app-boot/boot-slab")];
__bootSlabCtrl?.enable({ projectDir: process.argv[3] });`,
      "dsh-desktop-host top slab enable & optional perf"
    );
  }

  code = replaceOnce(
    code,
`async function main() {
	const runId = randomUUID();`,
`async function main() {
	__bootSlabCtrl?.enable({ projectDir: process.argv[3] });
	const __bootFsPhase = globalThis[Symbol.for("@deepseek-ai/dsh-app-boot/boot-fs-phase")];
	__bootFsPhase?.enter();
	let __bootFsReleased = false;
	const __releaseBootFsPhase = () => {
		if (__bootFsReleased) return;
		__bootFsReleased = true;
		__bootSlabCtrl?.finish();
		__bootFsPhase?.exit();
	};
	try {
	const runId = randomUUID();`,
    "dsh-desktop-host main enter bootFsPhase & slab"
  );

  code = replaceOnce(
    code,
`	const url = ctx.connection.authenticatedUrl(\`\${ctx.webServer.protocol}//127.0.0.1:\${String(ctx.webServer.port)}\`);
	if (process.connected) process.send?.({
		type: "ready",
		url,
		injections: ctx.webServer.collectIndexInjections(ctx.connection.browserPeer)
	}, (error) => {
		if (error !== null) console.error(error);
	});
}
if (import.meta.main)`,
`	__releaseBootFsPhase();
	if (process.env.DSH_BOOT_METRICS_OUT && __bootSlabCtrl) {
		try {
			__dshWriteFileSync(process.env.DSH_BOOT_METRICS_OUT, JSON.stringify({
				hostReadyMs: +(__dshPerf.now() - __DSH_BOOT_T0__).toFixed(1),
				slab: __bootSlabCtrl.getMetrics()
			}, null, 2), "utf8");
		} catch {}
	}
	const url = ctx.connection.authenticatedUrl(\`\${ctx.webServer.protocol}//127.0.0.1:\${String(ctx.webServer.port)}\`);
	if (process.connected) process.send?.({
		type: "ready",
		url,
		injections: ctx.webServer.collectIndexInjections(ctx.connection.browserPeer)
	}, (error) => {
		if (error !== null) console.error(error);
	});
	} finally {
		__releaseBootFsPhase();
	}
}
if (import.meta.main)`,
    "dsh-desktop-host exit bootFsPhase & finish slab before ready"
  );

  setReplacement(filePath, code);
  log("Prepared patch for: " + filePath);
}
