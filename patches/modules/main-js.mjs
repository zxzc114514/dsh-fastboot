import { replaceOnce } from "./utils.mjs";

export function patchMainJs({ readFromAsar, setReplacement, log = () => {} }) {
  const path = "lib/main.js";
  let code = readFromAsar(path);
  code = replaceOnce(
    code,
`function desktopNodeEnvironment(executable, bin, environment) {
	return {
		...environment,
		ELECTRON_RUN_AS_NODE: "1",
		...bin === void 0 ? {} : {
			DSH_DESKTOP_NODE_EXECUTABLE: executable,
			PATH: \`\${bin}\${delimiter}\${environment.PATH ?? ""}\`
		}
	};
}`,
`function ensureLoopbackNoProxy(envObj) {
	if (!envObj || envObj.DSH_FASTBOOT_DISABLE === "1" || envObj.DSH_NO_LOOPBACK_NO_PROXY === "1") return;
	const existingKeys = Object.keys(envObj).filter((k) => k.toLowerCase() === "no_proxy");
	const rawValues = existingKeys.length > 0 ? existingKeys.map((k) => envObj[k]).filter((v) => typeof v === "string" && v.length > 0) : typeof envObj.NO_PROXY === "string" && envObj.NO_PROXY.length > 0 ? [envObj.NO_PROXY] : [];
	const seen = /* @__PURE__ */ new Set();
	const tokens = [];
	for (const raw of rawValues) {
		for (const part of raw.split(",")) {
			const trimmed = part.trim();
			if (!trimmed) continue;
			const lower = trimmed.toLowerCase();
			if (seen.has(lower)) continue;
			seen.add(lower);
			tokens.push(trimmed);
		}
	}
	for (const required of ["127.0.0.1", "localhost"]) {
		if (!seen.has(required)) {
			seen.add(required);
			tokens.push(required);
		}
	}
	const merged = tokens.join(",");
	if (envObj === process.env) {
		process.env.NO_PROXY = merged;
		if (process.platform !== "win32") {
			for (const k of existingKeys) envObj[k] = merged;
		}
	} else if (existingKeys.length > 0) {
		for (const k of existingKeys) envObj[k] = merged;
	} else {
		envObj.NO_PROXY = merged;
	}
}
function desktopNodeEnvironment(executable, bin, environment) {
	const env = {
		...environment,
		ELECTRON_RUN_AS_NODE: "1",
		...bin === void 0 ? {} : {
			DSH_DESKTOP_NODE_EXECUTABLE: executable,
			PATH: \`\${bin}\${delimiter}\${environment.PATH ?? ""}\`
		}
	};
	if (environment.DSH_KEEP_COMPILE_CACHE !== "1") delete env.NODE_COMPILE_CACHE;
	ensureLoopbackNoProxy(env);
	return env;
}
ensureLoopbackNoProxy(process.env);`,
    "lib/main.js strip negative NODE_COMPILE_CACHE & ensure loopback NO_PROXY"
  );

  code = replaceOnce(
    code,
`async function authenticateWebHost(url) {
	const response = await fetch(url, { redirect: "manual" });
	const cookie = response.headers.get("set-cookie");
	await response.body?.cancel();
	if (response.status !== 303 || cookie === null) throw new Error("Desktop Host authentication failed");
	const end = cookie.indexOf(";");
	return end < 0 ? cookie : cookie.slice(0, end);
}`,
`async function authenticateWebHost(url) {
	if (process.env.DSH_FASTBOOT_DISABLE === "1") {
		const response = await fetch(url, { redirect: "manual" });
		const cookie = response.headers.get("set-cookie");
		await response.body?.cancel();
		if (response.status !== 303 || cookie === null) throw new Error("Desktop Host authentication failed");
		const end = cookie.indexOf(";");
		return end < 0 ? cookie : cookie.slice(0, end);
	}
	ensureLoopbackNoProxy(process.env);
	const retryDelays = [80, 160, 320];
	let lastError;
	for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
		try {
			const response = await fetch(url, { redirect: "manual" });
			const cookie = response.headers.get("set-cookie");
			await response.body?.cancel().catch(() => {});
			if (response.status === 303 && cookie !== null) {
				const end = cookie.indexOf(";");
				return end < 0 ? cookie : cookie.slice(0, end);
			}
			const transientStatus = response.status === 502 || response.status === 503 || response.status === 504;
			if (!transientStatus || attempt === retryDelays.length) {
				throw new Error("Desktop Host authentication failed");
			}
		} catch (error) {
			lastError = error;
			if (error instanceof Error && error.message === "Desktop Host authentication failed") throw error;
			if (attempt === retryDelays.length) throw lastError;
		}
		await new Promise((resolveDelay) => setTimeout(resolveDelay, retryDelays[attempt]));
	}
	throw lastError ?? new Error("Desktop Host authentication failed");
}`,
    "lib/main.js authenticateWebHost loopback NO_PROXY & backoff retry"
  );

  code = replaceOnce(
    code,
`	if (PLUGIN_BUNDLE_PATH.test(source.pathname)) outgoing.set("cache-control", "no-store");`,
`	if (PLUGIN_BUNDLE_PATH.test(source.pathname)) {
		const rev = source.searchParams.get("rev");
		const hostCacheControl = outgoing.get("cache-control") ?? "";
		const allowImmutableCache = process.env.DSH_FASTBOOT_DISABLE !== "1" && process.env.DSH_NO_PLUGIN_HTTP_CACHE !== "1" && (request.method === "GET" || request.method === "HEAD") && response.status === 200 && typeof rev === "string" && rev.length > 0 && /\\bimmutable\\b/iu.test(hostCacheControl);
		if (!allowImmutableCache) outgoing.set("cache-control", "no-store");
	}`,
    "lib/main.js allow immutable cache on revisioned /plugins/ responses"
  );

  setReplacement(path, code);
  log("Prepared patch for: " + path);
}
