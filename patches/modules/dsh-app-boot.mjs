import { replaceOnce, makeAsarImmutableHelper } from "./utils.mjs";

export function patchDshAppBoot({ readFromAsar, setReplacement, log = () => {} }) {
  const filePath = "dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js";
  let code = readFromAsar(filePath);

  code = replaceOnce(
    code,
`import { createRequire, isBuiltin } from "node:module";`,
`import Module, { createRequire, isBuiltin, syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";`,
    "dsh-app-boot imports top"
  );

  code = replaceOnce(
    code,
`import { getEnvironmentData, setEnvironmentData } from "node:worker_threads";`,
`import { Worker, getEnvironmentData, setEnvironmentData } from "node:worker_threads";`,
    "dsh-app-boot import Worker"
  );

  code = replaceOnce(
    code,
`function getDshRuntimeVersion() {
	const filename = fileURLToPath(new URL("../package.json", import.meta.url));
	const manifest = objectOf$1(JSON.parse(fs.readFileSync(filename, "utf8")), "app-boot package.json");
	return runtimeVersionOf(Object.hasOwn(manifest, "version") ? manifest.version : void 0);
}`,
`let _cachedDshRuntimeVersion = void 0;
function getDshRuntimeVersion() {
	if (_cachedDshRuntimeVersion !== void 0 && !isBootFastOptDisabled()) return _cachedDshRuntimeVersion;
	const filename = fileURLToPath(new URL("../package.json", import.meta.url));
	const manifest = objectOf$1(JSON.parse(fs.readFileSync(filename, "utf8")), "app-boot package.json");
	const ver = runtimeVersionOf(Object.hasOwn(manifest, "version") ? manifest.version : void 0);
	if (isAsarImmutablePath(filename) || bootPhaseActive) _cachedDshRuntimeVersion = ver;
	return ver;
}`,
    "dsh-app-boot memoize getDshRuntimeVersion"
  );

  code = replaceOnce(
    code,
`function realModuleDirectory(path) {
	return isPackagedExecutable() ? realpathSync(path) : realpathSync.native(path);
}`,
`const realDirCache = /* @__PURE__ */ new Map();
${makeAsarImmutableHelper("isAsarImmutablePath")}
function canUseMutablePathCache(p) {
	return bootPhaseActive || (typeof p === "string" && isAsarImmutablePath(p));
}
function realModuleDirectory(path) {
	const useCache = canUseMutablePathCache(path);
	if (useCache) {
		const cached = realDirCache.get(path);
		if (cached !== void 0) return cached;
	}
	const resolved = isPackagedExecutable() ? realpathSync(path) : realpathSync.native(path);
	if (useCache) realDirCache.set(path, resolved);
	return resolved;
}`,
    "dsh-app-boot realModuleDirectory cache"
  );

  code = replaceOnce(
    code,
`function readPackageManifest(anchor) {
	return JSON.parse(readFileSync(anchor, "utf8"));
}`,
`const asarPackageManifestCache = /* @__PURE__ */ new Map();
const bootManifestCache = /* @__PURE__ */ new Map();
let _activeResWatcher = null;
function recordResWatcherFile(p) {
	if (_activeResWatcher === null || typeof p !== "string" || isAsarImmutablePath(p)) return;
	const nk = normalizeResWatchKey(p);
	if (_activeResWatcher.seen.has(nk)) return;
	_activeResWatcher.seen.add(nk);
	try {
		const st = statSync(p);
		_activeResWatcher.list.push({ p, k: "f", exists: true, size: st.size, mtimeMs: st.mtimeMs });
	} catch {
		_activeResWatcher.list.push({ p, k: "f", exists: false, size: 0, mtimeMs: 0 });
	}
}
function recordResWatcherDir(p) {
	if (_activeResWatcher === null || typeof p !== "string" || isAsarImmutablePath(p)) return;
	const nk = normalizeResWatchKey(p);
	if (_activeResWatcher.seen.has(nk)) return;
	_activeResWatcher.seen.add(nk);
	try {
		const st = statSync(p);
		_activeResWatcher.list.push({ p, k: "d", exists: st.isDirectory(), size: 0, mtimeMs: st.mtimeMs });
	} catch {
		_activeResWatcher.list.push({ p, k: "d", exists: false, size: 0, mtimeMs: 0 });
	}
}
function readPackageManifest(anchor) {
	recordResWatcherFile(anchor);
	if (isAsarImmutablePath(anchor)) {
		let cached = asarPackageManifestCache.get(anchor);
		if (cached === void 0) {
			cached = JSON.parse(readFileSync(anchor, "utf8"));
			asarPackageManifestCache.set(anchor, cached);
		}
		return cached;
	}
	if (bootPhaseActive) {
		let cached = bootManifestCache.get(anchor);
		if (cached === void 0) {
			cached = JSON.parse(readFileSync(anchor, "utf8"));
			bootManifestCache.set(anchor, cached);
		}
		return cached;
	}
	return JSON.parse(readFileSync(anchor, "utf8"));
}`,
    "dsh-app-boot readPackageManifest asar, boot & watcher cache"
  );

  code = replaceOnce(
    code,
`async function createRuntimeResolution(options) {
	const { installAnchor, profile, home = resolveDshHome() } = options;
	const profilesDir = join(home, PROFILES_DIR);
	const manifest = readOptionalProfileManifest(profile);
	const { packageNames, packageDirs, declarers, versions } = collectInstallationScopePackages(installAnchor, new Set(profile?.skippedBundles.map((skipped) => skipped.packageName)));
	const profileDeclarers = /* @__PURE__ */ new Map();
	const profileVersions = /* @__PURE__ */ new Map();
	const localPackageNames = profile === void 0 ? [] : installedProfilePackageNames(profile, manifest);
	const profilePackages = profile === void 0 ? /* @__PURE__ */ new Map() : collectProfileScopePackages(profile, packageNames, profileDeclarers, profileVersions);
	const linkedRoots = profile === void 0 ? [] : linkedProfileRoots(profile, profilesDir);
	return await Promise.resolve(new ProfileRuntimeResolution({
		installAnchor,
		profileDir: profile?.dir,
		home
	}, {
		profilesDir,
		profileDir: profile?.dir,
		localPackageNames: Object.freeze(localPackageNames),
		linkedRoots: Object.freeze(linkedRoots.map((root) => Object.freeze(root))),
		entries: Object.freeze([...[...packageDirs].map(([name, packageDir]) => Object.freeze({
			name,
			packageDir,
			version: versions.get(name),
			declarer: declarers.get(name),
			scope: "installation"
		})), ...[...profilePackages].map(([name, packageDir]) => Object.freeze({
			name,
			packageDir,
			version: profileVersions.get(name),
			declarer: profileDeclarers.get(name),
			scope: "profile"
		}))])
	}));
}`,
`const BYPASS_RES_SNAPSHOT = Symbol("dsh-bypass-res-snapshot");
const BOOT_RES_PROC_TOKEN = String(process.pid) + "-" + String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8);
let resWriteSeq = 0;
let resGlobalWriteSeq = 0;
const resExactWriteSeq = /* @__PURE__ */ new Map();
const resRecWriteLog = [];
const minValidResSnapSeq = /* @__PURE__ */ new Map();
const resSnapRecomputedSet = /* @__PURE__ */ new Set();
const resSnapWriteSeqByPath = /* @__PURE__ */ new Map();
const resSnapWriteQueue = /* @__PURE__ */ new Map();
let resSnapTmpSeq = 0;

function normalizeResWatchKey(p) {
	return IS_WIN32 ? stripWinNsPrefix(p).replaceAll("/", "\\\\").toLowerCase() : p;
}
function noteResGlobalWrite() {
	const seq = ++resWriteSeq;
	if (seq > resGlobalWriteSeq) resGlobalWriteSeq = seq;
}
function noteResPathWrite(clean, pClean, prefix, recursive, kind, extraTargetClean) {
	const seq = ++resWriteSeq;
	if (resExactWriteSeq.size > 4096) {
		resGlobalWriteSeq = seq;
		resExactWriteSeq.clear();
	} else {
		resExactWriteSeq.set(clean, seq);
		if (pClean) resExactWriteSeq.set(pClean, seq);
		if (extraTargetClean && extraTargetClean !== clean) {
			const sepCh = IS_WIN32 ? "\\\\" : "/";
			let cur = extraTargetClean;
			for (let depth = 0; depth < 32 && cur && cur.length > clean.length && cur.startsWith(prefix); depth++) {
				resExactWriteSeq.set(cur, seq);
				const ls = cur.lastIndexOf(sepCh);
				if (ls <= 0) break;
				cur = IS_WIN32 && ls === 2 ? cur.slice(0, 3) : cur.slice(0, ls);
			}
		}
	}
	if (recursive) {
		resRecWriteLog.push({ clean, prefix, seq, downward: kind !== "mkdir", extraTargetClean: extraTargetClean || "" });
		if (resRecWriteLog.length > 256) {
			const evicted = resRecWriteLog.shift();
			if (evicted && evicted.seq > resGlobalWriteSeq) resGlobalWriteSeq = evicted.seq;
		}
	}
}
function getResWatchWriteSeq(w) {
	const k = normalizeResWatchKey(w.p);
	let maxSeq = resExactWriteSeq.get(k) ?? 0;
	const sep = IS_WIN32 ? "\\\\" : "/";
	const kPrefix = w.k === "d" ? (k.endsWith(sep) ? k : k + sep) : "";
	for (let i = resRecWriteLog.length - 1; i >= 0; i--) {
		const entry = resRecWriteLog[i];
		if (entry.seq <= maxSeq) continue;
		const hit = k === entry.clean
			|| (entry.downward && k.startsWith(entry.prefix))
			|| (kPrefix && (entry.clean.startsWith(kPrefix) || (entry.extraTargetClean && entry.extraTargetClean.startsWith(kPrefix))));
		if (hit) maxSeq = entry.seq;
	}
	return maxSeq;
}
function hasResWatcherWriteSince(watchers, sinceSeq) {
	if (resGlobalWriteSeq > sinceSeq) return true;
	if (!Array.isArray(watchers)) return false;
	for (let i = 0; i < watchers.length; i++) {
		if (getResWatchWriteSeq(watchers[i]) > sinceSeq) return true;
	}
	return false;
}
function extractAsarArchivePath(p) {
	if (typeof p !== "string") return null;
	const m = /^(.*?\\.asar)(?:[\\\\/]|$)/iu.exec(p);
	return m ? m[1] : null;
}
function statAsarReal(asarPath) {
	const prev = process.noAsar;
	process.noAsar = true;
	try {
		return statSync(asarPath);
	} finally {
		process.noAsar = prev;
	}
}
function getResSnapshotFilePath(home, installAnchor, profileDir) {
	const key = createHash("sha1").update(String(installAnchor) + "\\0" + String(profileDir ?? "") + "\\0" + String(home)).digest("hex").slice(0, 16);
	return join(home, "cache", "boot-res-v1", \`res-\${key}.json\`);
}
function buildResProfileSignature(profile) {
	if (profile === void 0) return { hasProfile: false, skipped: [], layers: [] };
	return {
		hasProfile: true,
		skipped: [...profile.skippedBundles].map((s) => s.packageName).sort(),
		layers: profile.layers.map((l) => l.packageName + "\\0" + l.packageDir)
	};
}
function sameStringArray(a, b) {
	return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
}
function freezeResolutionTable(table) {
	return {
		profilesDir: table.profilesDir,
		profileDir: table.profileDir,
		localPackageNames: Object.freeze([...table.localPackageNames]),
		linkedRoots: Object.freeze(table.linkedRoots.map((root) => Object.freeze({ ...root }))),
		entries: Object.freeze(table.entries.map((e) => Object.freeze({ ...e })))
	};
}
function tryReadResSnapshot(snapPath, options, anchorAsarPath, profSig, dshVer) {
	if (isBootFastOptDisabled() || process.env.DSH_NO_RES_CACHE === "1") return null;
	let raw;
	try { raw = readFileSync(snapPath, "utf8"); } catch { return null; }
	let snap;
	try { snap = JSON.parse(raw); } catch { return null; }
	if (!snap || snap.version !== 1) return null;
	if (snap.dshVersion !== dshVer) return null;
	if (snap.installAnchor !== options.installAnchor || snap.profileDir !== options.profile?.dir) return null;
	if (!snap.profileSig || snap.profileSig.hasProfile !== profSig.hasProfile) return null;
	if (!sameStringArray(snap.profileSig.skipped, profSig.skipped) || !sameStringArray(snap.profileSig.layers, profSig.layers)) return null;
	if (anchorAsarPath !== null) {
		try {
			const ast = statAsarReal(anchorAsarPath);
			if (!snap.anchorStat || snap.anchorStat.size !== ast.size || snap.anchorStat.mtimeMs !== ast.mtimeMs) return null;
		} catch { return null; }
	} else {
		try {
			const fst = statSync(options.installAnchor);
			if (!snap.anchorStat || snap.anchorStat.size !== fst.size || snap.anchorStat.mtimeMs !== fst.mtimeMs) return null;
		} catch { return null; }
	}
	if (!Array.isArray(snap.watchers)) return null;
	if (resSnapRecomputedSet.has(snapPath)) {
		if (snap.procToken !== BOOT_RES_PROC_TOKEN) return null;
		const minSeq = minValidResSnapSeq.get(snapPath) ?? 0;
		if (typeof snap.captureSeq !== "number" || snap.captureSeq < minSeq) return null;
	}
	const sinceSeq = snap.procToken === BOOT_RES_PROC_TOKEN && typeof snap.captureSeq === "number" ? snap.captureSeq : 0;
	if (hasResWatcherWriteSince(snap.watchers, sinceSeq)) return null;
	for (let i = 0; i < snap.watchers.length; i++) {
		const w = snap.watchers[i];
		try {
			const st = statSync(w.p);
			if (!w.exists) return null;
			if (w.k === "d") {
				if (!st.isDirectory() || st.mtimeMs !== w.mtimeMs) return null;
			} else {
				if (!st.isFile() || st.size !== w.size || st.mtimeMs !== w.mtimeMs) return null;
			}
		} catch {
			if (w.exists) return null;
		}
	}
	return snap.table;
}
function scheduleWriteResSnapshot(snapPath, payload) {
	if (isBootFastOptDisabled() || process.env.DSH_NO_RES_CACHE === "1") return;
	const prevMin = minValidResSnapSeq.get(snapPath) ?? 0;
	if (payload.captureSeq > prevMin) minValidResSnapSeq.set(snapPath, payload.captureSeq);
	resSnapRecomputedSet.add(snapPath);
	const writeOrder = ++resSnapTmpSeq;
	resSnapWriteSeqByPath.set(snapPath, writeOrder);
	const prevPromise = resSnapWriteQueue.get(snapPath) ?? Promise.resolve();
	const dir = dirname(snapPath);
	const tmpPath = snapPath + ".tmp." + String(process.pid) + "." + String(writeOrder);
	const nextPromise = prevPromise.then(async () => {
		if (resSnapWriteSeqByPath.get(snapPath) !== writeOrder) return;
		if (hasResWatcherWriteSince(payload.watchers, payload.captureSeq)) return;
		await mkdir(dir, { recursive: true });
		await writeFile(tmpPath, JSON.stringify(payload), "utf8");
		if (resSnapWriteSeqByPath.get(snapPath) !== writeOrder || hasResWatcherWriteSince(payload.watchers, payload.captureSeq)) {
			await rm(tmpPath, { force: true }).catch(() => {});
			return;
		}
		await rename(tmpPath, snapPath);
	}).catch(() => rm(tmpPath, { force: true }).catch(() => {}));
	resSnapWriteQueue.set(snapPath, nextPromise);
}
async function createRuntimeResolution(options) {
	const bypassSnapshot = options[BYPASS_RES_SNAPSHOT] === true;
	if (bypassSnapshot) {
		profileDirSnapshotCache.clear();
		clearAllBootVolatileCaches();
	}
	const useBootAccel = !bypassSnapshot;
	if (useBootAccel) installBootFsAccel();
	try {
	const { installAnchor, profile, home = resolveDshHome() } = options;
	const snapPath = getResSnapshotFilePath(home, installAnchor, profile?.dir);
	const anchorAsarPath = extractAsarArchivePath(installAnchor);
	const profSig = buildResProfileSignature(profile);
	const dshVer = getDshRuntimeVersion();
	if (!bypassSnapshot) {
		const cachedTable = tryReadResSnapshot(snapPath, options, anchorAsarPath, profSig, dshVer);
		if (cachedTable !== null) {
			bootSlabMetrics.resSnapshotHit++;
			return await Promise.resolve(new ProfileRuntimeResolution({
				installAnchor,
				profileDir: profile?.dir,
				home
			}, freezeResolutionTable(cachedTable)));
		}
	}
	const prevWatcher = _activeResWatcher;
	const recorder = bypassSnapshot ? null : { seen: new Set(), list: [], pkgKeys: new Set() };
	if (!bypassSnapshot) _activeResWatcher = recorder;
	const captureSeq = resWriteSeq;
	let table;
	try {
		const profilesDir = join(home, PROFILES_DIR);
		recordResWatcherDir(profilesDir);
		if (profile !== void 0) {
			recordResWatcherDir(profile.dir);
			recordResWatcherFile(join(profile.dir, "package.json"));
			recordResWatcherDir(join(profile.dir, "node_modules"));
		}
		const manifest = readOptionalProfileManifest(profile);
		const { packageNames, packageDirs, declarers, versions } = collectInstallationScopePackages(installAnchor, new Set(profile?.skippedBundles.map((skipped) => skipped.packageName)));
		const profileDeclarers = /* @__PURE__ */ new Map();
		const profileVersions = /* @__PURE__ */ new Map();
		const localPackageNames = profile === void 0 ? [] : installedProfilePackageNames(profile, manifest);
		if (profile !== void 0) {
			for (let i = 0; i < localPackageNames.length; i++) {
				recordResWatcherFile(join(profile.dir, "node_modules", localPackageNames[i], "package.json"));
			}
		}
		const profilePackages = profile === void 0 ? /* @__PURE__ */ new Map() : collectProfileScopePackages(profile, packageNames, profileDeclarers, profileVersions);
		const linkedRoots = profile === void 0 ? [] : linkedProfileRoots(profile, profilesDir);
		for (let i = 0; i < linkedRoots.length; i++) {
			recordResWatcherDir(linkedRoots[i].realPath);
			recordResWatcherDir(join(profile.dir, "node_modules", linkedRoots[i].name));
		}
		table = {
			profilesDir,
			profileDir: profile?.dir,
			localPackageNames: Object.freeze(localPackageNames),
			linkedRoots: Object.freeze(linkedRoots.map((root) => Object.freeze(root))),
			entries: Object.freeze([...[...packageDirs].map(([name, packageDir]) => Object.freeze({
				name,
				packageDir,
				version: versions.get(name),
				declarer: declarers.get(name),
				scope: "installation"
			})), ...[...profilePackages].map(([name, packageDir]) => Object.freeze({
				name,
				packageDir,
				version: profileVersions.get(name),
				declarer: profileDeclarers.get(name),
				scope: "profile"
			}))])
		};
	} finally {
		_activeResWatcher = prevWatcher;
	}
	if (!bypassSnapshot && !isBootFastOptDisabled() && process.env.DSH_NO_RES_CACHE !== "1") {
		try {
			const ast = anchorAsarPath !== null ? statAsarReal(anchorAsarPath) : statSync(installAnchor);
			scheduleWriteResSnapshot(snapPath, {
				version: 1,
				dshVersion: dshVer,
				installAnchor,
				profileDir: profile?.dir,
				anchorStat: { size: ast.size, mtimeMs: ast.mtimeMs },
				profileSig: profSig,
				procToken: BOOT_RES_PROC_TOKEN,
				captureSeq,
				watchers: recorder.list,
				table
			});
		} catch {}
	}
	return await Promise.resolve(new ProfileRuntimeResolution({
		installAnchor,
		profileDir: profile?.dir,
		home
	}, table));
	} finally {
		if (useBootAccel) endBootFsPhase();
	}
}`,
    "dsh-app-boot createRuntimeResolution snapshot cache & bypass fs-accel"
  );

  code = replaceOnce(
    code,
`	computeLatestResolution() {
		const { installAnchor, home, profileDir } = this.#source;
		return createRuntimeResolution({
			installAnchor,
			home,
			...profileDir === void 0 ? {} : { profile: loadProfileDirectory("dsh", profileDir, installAnchor) }
		});
	}`,
`	computeLatestResolution() {
		const { installAnchor, home, profileDir } = this.#source;
		return createRuntimeResolution({
			[BYPASS_RES_SNAPSHOT]: true,
			installAnchor,
			home,
			...profileDir === void 0 ? {} : { profile: loadProfileDirectory("dsh", profileDir, installAnchor) }
		});
	}`,
    "dsh-app-boot computeLatestResolution bypass snapshot"
  );

  code = replaceOnce(
    code,
`function installedProfilePackageNames(profile, manifest) {
	if (manifest === void 0) return [];
	return profileDependencyNames(manifest).filter((name) => existsSync(join(profile.dir, "node_modules", name, "package.json")));
}`,
`function installedProfilePackageNames(profile, manifest) {
	if (manifest === void 0) return [];
	const nmDir = join(profile.dir, "node_modules");
	const entries = getDirEntries(nmDir);
	if (entries === null) return [];
	return profileDependencyNames(manifest).filter((name) => {
		const slash = name.indexOf("/");
		if (slash >= 0) {
			const scope = name.slice(0, slash);
			if (!entries.has(IS_WIN32 ? scope.toLowerCase() : scope)) return false;
			const subEntries = getDirEntries(join(nmDir, scope));
			if (subEntries === null) return false;
			const pkgKey = IS_WIN32 ? name.slice(slash + 1).toLowerCase() : name.slice(slash + 1);
			if (!subEntries.has(pkgKey)) return false;
		} else {
			if (!entries.has(IS_WIN32 ? name.toLowerCase() : name)) return false;
		}
		const pj = join(nmDir, name, "package.json");
		recordResWatcherFile(pj);
		return existsSync(pj);
	});
}`,
    "dsh-app-boot installedProfilePackageNames dirEntries & watcher"
  );

  code = replaceOnce(
    code,
`function writeProfileManifest(dir, manifest) {
	writeFileSync(join(dir, "package.json"), JSON.stringify(manifest, void 0, 2) + "\\n");
}`,
`function writeProfileManifest(dir, manifest) {
	const file = join(dir, "package.json");
	writeFileSync(file, JSON.stringify(manifest, void 0, 2) + "\\n");
	bootManifestCache.delete(file);
	profileDirSnapshotCache.clear();
}`,
    "dsh-app-boot writeProfileManifest invalidate"
  );

  code = replaceOnce(
    code,
`function packageDirFromAnchor(anchor, packageName) {
	/* v8 ignore next */
	for (const searchPath of createRequire(anchor).resolve.paths(packageName) ?? []) {
		const candidate = join(searchPath, packageName);
		if (existsSync(join(candidate, "package.json"))) return candidate;
	}
}`,
`const anchorPathsCache = /* @__PURE__ */ new Map();
const pkgDirAnchorCache = /* @__PURE__ */ new Map();
function getAnchorSearchPaths(anchor) {
	if (!bootPhaseActive) return createRequire(anchor).resolve.paths("dsh-anchor-probe") ?? [];
	const dir = dirname(anchor);
	let paths = anchorPathsCache.get(dir);
	if (paths === void 0) {
		paths = createRequire(anchor).resolve.paths("dsh-anchor-probe") ?? [];
		anchorPathsCache.set(dir, paths);
	}
	return paths;
}
function hasPackageManifestInSearchPath(searchPath, packageName) {
	const entries = getDirEntries(searchPath);
	if (entries === null) return false;
	const slash = packageName.indexOf("/");
	let leafEntries = entries;
	let leafName = packageName;
	if (slash >= 0) {
		const scope = packageName.slice(0, slash);
		const scopeKey = IS_WIN32 ? scope.toLowerCase() : scope;
		const scopeEnt = entries.get(scopeKey);
		if (scopeEnt === void 0) {
			recordResWatcherDir(join(searchPath, scope));
			return false;
		}
		leafEntries = getDirEntries(join(searchPath, scope));
		if (leafEntries === null) return false;
		leafName = packageName.slice(slash + 1);
	}
	const key = IS_WIN32 ? leafName.toLowerCase() : leafName;
	const ent = leafEntries.get(key);
	const candidate = join(searchPath, packageName);
	if (ent === void 0) {
		recordResWatcherDir(candidate);
		return false;
	}
	if (ent.isSymbolicLink()) {
		const pj = join(candidate, "package.json");
		recordResWatcherFile(pj);
		return existsSync(pj);
	}
	if (!ent.isDirectory()) return false;
	const pkgEntries = getDirEntries(candidate);
	if (pkgEntries === null) return false;
	const pkgEnt = pkgEntries.get("package.json");
	const pj = join(candidate, "package.json");
	recordResWatcherFile(pj);
	return pkgEnt !== void 0 && (!pkgEnt.isSymbolicLink() || existsSync(pj));
}
function packageDirFromAnchor(anchor, packageName) {
	if (isBuiltin(packageName)) return void 0;
	const useCache = bootPhaseActive;
	const cacheKey = useCache ? dirname(anchor) + "\\0" + packageName : "";
	if (useCache && (_activeResWatcher === null || _activeResWatcher.pkgKeys.has(cacheKey)) && pkgDirAnchorCache.has(cacheKey)) return pkgDirAnchorCache.get(cacheKey);
	let result;
	for (const searchPath of getAnchorSearchPaths(anchor)) {
		if (hasPackageManifestInSearchPath(searchPath, packageName)) {
			result = join(searchPath, packageName);
			break;
		}
	}
	if (useCache) {
		pkgDirAnchorCache.set(cacheKey, result);
		if (_activeResWatcher !== null) _activeResWatcher.pkgKeys.add(cacheKey);
	}
	return result;
}`,
    "dsh-app-boot packageDirFromAnchor caches & watcher"
  );

  code = replaceOnce(
    code,
`function loadProfileDirectory(binName, dir, installAnchor, options = {}) {
	const bundles = dropRetiredBundles(dir, readProfileManifest(binName, dir)).dsh?.profile?.bundles ?? [];
	const layers = [];
	const skippedBundles = [];
	const exemptions = bundles.length === 0 ? {} : readProfileVersionExemptions(dir);
	for (const packageName of bundles) try {
		const packageDir = resolveBundleDir(binName, packageName, installAnchor, dir);
		const bundleManifest = readProfileManifest(binName, packageDir);
		const bundle = bundleManifest.dsh?.bundle;
		if (bundle === void 0) throw new Error(\`\${binName}: profile bundle \${JSON.stringify(packageName)} declares no dsh.bundle in its package.json\`);
		assertBundlePlatform(bundle.platforms, process.platform);
		const issue = evaluatePluginCompatibility(bundleManifest, exemptions);
		if (issue !== void 0 && !issue.exempted) throw new Error(pluginCompatibilityWarning(issue));
		const patchPaths = bundlePatchPaths(packageDir, bundle);
		const patches = patchPaths.flatMap((patchPath) => loadOverlayPatches(binName, patchPath));
		layers.push({
			packageName,
			packageDir,
			patchPaths,
			patches
		});
	} catch (error) {
		skippedBundles.push({
			packageName,
			reason: String(error)
		});
	}
	const patchPath = join(dir, PROFILE_PATCH_FILENAME);
	const patches = options.userLayer !== false && existsSync(patchPath) ? loadOverlayPatches(binName, patchPath) : [];
	return {
		name: basename(dir),
		dir,
		layers,
		patchPath,
		patches,
		skippedBundles
	};
}`,
`const profileDirSnapshotCache = /* @__PURE__ */ new Map();
function statStamp(filePath) {
	if (isAsarImmutablePath(filePath)) return "asar";
	try {
		const st = statSync(filePath);
		return \`\${st.mtimeMs}:\${st.size}\`;
	} catch {
		return "missing";
	}
}
function loadProfileDirectory(binName, dir, installAnchor, options = {}) {
	const includeUserLayer = options.userLayer !== false;
	const cacheKey = \`\${binName}\\0\${dir}\\0\${installAnchor}\\0\${includeUserLayer}\`;
	const cached = profileDirSnapshotCache.get(cacheKey);
	if (cached !== void 0) {
		let valid = true;
		for (let i = 0; i < cached.watchers.length; i++) {
			const [wPath, wStamp] = cached.watchers[i];
			if (statStamp(wPath) !== wStamp) {
				valid = false;
				break;
			}
		}
		if (valid) return options.readonly === true ? cached.result : structuredClone(cached.result);
	}
	const manifestPath = join(dir, "package.json");
	const patchPath = join(dir, PROFILE_PATCH_FILENAME);
	const compatPath = join(dir, PROFILE_COMPATIBILITY_FILENAME);
	const watchers = [
		[manifestPath, statStamp(manifestPath)],
		[compatPath, statStamp(compatPath)],
		...(includeUserLayer ? [[patchPath, statStamp(patchPath)]] : [])
	];
	const bundles = dropRetiredBundles(dir, readProfileManifest(binName, dir)).dsh?.profile?.bundles ?? [];
	watchers[0][1] = statStamp(manifestPath);
	const layers = [];
	const skippedBundles = [];
	const exemptions = bundles.length === 0 ? {} : readProfileVersionExemptions(dir);
	for (const packageName of bundles) {
		let packageDir;
		try {
			packageDir = resolveBundleDir(binName, packageName, installAnchor, dir);
			if (!isAsarImmutablePath(packageDir)) {
				const bPkg = join(packageDir, "package.json");
				watchers.push([bPkg, statStamp(bPkg)]);
			}
			const bundleManifest = readProfileManifest(binName, packageDir);
			const bundle = bundleManifest.dsh?.bundle;
			if (bundle === void 0) throw new Error(\`\${binName}: profile bundle \${JSON.stringify(packageName)} declares no dsh.bundle in its package.json\`);
			assertBundlePlatform(bundle.platforms, process.platform);
			const issue = evaluatePluginCompatibility(bundleManifest, exemptions);
			if (issue !== void 0 && !issue.exempted) throw new Error(pluginCompatibilityWarning(issue));
			const patchPaths = bundlePatchPaths(packageDir, bundle);
			if (!isAsarImmutablePath(packageDir)) {
				for (const pp of patchPaths) watchers.push([pp, statStamp(pp)]);
			}
			const patches = patchPaths.flatMap((pp) => loadOverlayPatches(binName, pp));
			layers.push({
				packageName,
				packageDir,
				patchPaths,
				patches
			});
		} catch (error) {
			if (packageDir === void 0 && !isBuiltin(packageName)) {
				const seenSkipped = /* @__PURE__ */ new Set();
				for (const anchor of [installAnchor, manifestPath]) {
					for (const searchPath of getAnchorSearchPaths(anchor)) {
						if (isAsarImmutablePath(searchPath)) continue;
						const candidatePkg = join(searchPath, packageName, "package.json");
						const watchKey = IS_WIN32 ? candidatePkg.toLowerCase() : candidatePkg;
						if (seenSkipped.has(watchKey)) continue;
						seenSkipped.add(watchKey);
						watchers.push([candidatePkg, statStamp(candidatePkg)]);
					}
				}
			}
			skippedBundles.push({
				packageName,
				reason: String(error)
			});
		}
	}
	const patches = includeUserLayer && existsSync(patchPath) ? loadOverlayPatches(binName, patchPath) : [];
	const result = {
		name: basename(dir),
		dir,
		layers,
		patchPath,
		patches,
		skippedBundles
	};
	const stored = structuredClone(result);
	profileDirSnapshotCache.set(cacheKey, { watchers, result: stored });
	return options.readonly === true ? stored : result;
}`,
    "dsh-app-boot loadProfileDirectory snapshot cache & readonly"
  );

  code = replaceOnce(
    code,
`function canonicalPath(path) {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}
function prefixes(path) {
	const configured = resolve(path) + sep;
	const canonical = canonicalPath(path) + sep;
	return canonical === configured ? [configured] : [configured, canonical];
}
function compileResolution(resolution) {
	return {
		entries: new Map(resolution.entries.map((entry) => [entry.name, {
			...entry,
			realDir: canonicalPath(entry.packageDir)
		}])),
		profilesDir: resolution.profilesDir,
		profileDir: resolution.profileDir,
		profilePaths: prefixes(resolution.profilesDir),
		profile: resolution.profileDir === void 0 ? [] : prefixes(resolution.profileDir),
		installationPaths: [...new Set(resolution.entries.filter((entry) => entry.scope === "installation").flatMap((entry) => prefixes(entry.packageDir)))],
		linkedPaths: resolution.linkedRoots.flatMap((root) => prefixes(root.realPath)),
		localPackageNames: new Set(resolution.localPackageNames),
		esmRoutes: /* @__PURE__ */ new Map(),
		cjsRoutes: /* @__PURE__ */ new Map()
	};
}`,
`const OFFICE_REDIRECT_SYMBOL = Symbol.for("@deepseek-ai/dsh-app-boot/office-engine-redirect");
const BOOT_FS_PHASE_SYMBOL = Symbol.for("@deepseek-ai/dsh-app-boot/boot-fs-phase");
const IS_WIN32 = process.platform === "win32";
const canonicalCache = /* @__PURE__ */ new Map();
const prefixesCache = /* @__PURE__ */ new Map();
const selfRefDirCache = /* @__PURE__ */ new Map();
const dirEntriesCache = /* @__PURE__ */ new Map();
const peerNamesCache = /* @__PURE__ */ new Map();

// [Step 3] CJS & ESM 只读 ASAR 与引导期解析缓存
const cjsAsarResolvedCache = /* @__PURE__ */ new Map();
const cjsBootResolvedCache = /* @__PURE__ */ new Map();
const asarEsmDirCache = /* @__PURE__ */ new Map();

// [Step 4] 通用禁用开关与 Boot Slab 字节码/外盘单文件池引擎
function isBootFastOptDisabled() {
	return process.env.DSH_NO_BOOT_FS_CACHE === "1" || process.env.DSH_FASTBOOT_DISABLE === "1";
}
const BOOT_SLAB_SYMBOL = Symbol.for("@deepseek-ai/dsh-app-boot/boot-slab");
const bootEsmRelDirCache = /* @__PURE__ */ new Map();

const bootSlabMetrics = {
	enabled: false,
	asarLoadMs: 0,
	asarCcCount: 0,
	workerReadyAtMs: 0,
	extSlabReady: false,
	extEntryCount: 0,
	asarCjsHit: 0,
	asarEsmHit: 0,
	extSrcHit: 0,
	extCjsHit: 0,
	extEsmHit: 0,
	fallbackRej: 0,
	fallbackSyntax: 0,
	modReadHit: 0,
	modNearestHit: 0,
	modScopeHit: 0,
	modTypeHit: 0,
	pkgReadHit: 0,
	pkgNearestHit: 0,
	resSnapshotHit: 0,
	esmRelDirHit: 0,
	buildTriggered: false,
	buildCancelled: false
};

const SLAB_MAGIC = "DSHSLAB1";
const SLAB_MAX_DATA_BYTES = 8 * 1024 * 1024;
const SLAB_SAFE_DATA_EXTS = new Set([".json", ".yml", ".yaml", ".txt"]);
let slabActive = false;
let slabHooksInstalled = false;
let slabFinished = false;
let slabHomeDir = "";
let slabProfileKey = "default";
let slabAsarPath = "";
let slabAsarSize = 0;
let slabAsarMtimeMs = 0;
let slabAsarNeedBuild = false;
let slabExtNeedBuild = false;
let slabAsarMissCount = 0;
let slabExtMissCount = 0;
let slabAsarRejectCount = 0;
let slabExtRejectCount = 0;
let slabExtReady = false;
let slabVerifyWorker = null;
let slabBuildWorker = null;
let slabBuildPromise = null;
let runtimeRecomposeEpoch = 0;
let slabBuildDelayTimer = null;
let slabActiveBuildResolve = null;

const asarCcMap = new Map();
const extByPath = new Map();
const slabDirtyPaths = new Set();
const collectedAsarMods = new Map();
const collectedExtMods = new Map();
const collectedExtData = new Set();
const slabHookRestorers = [];

const modReadCache = new Map();
const modNearestCache = new Map();
const modScopeCache = new Map();
const modTypeCache = new Map();
const pkgReadCache = new Map();
const pkgNearestCache = new Map();

function clearSlabPkgCaches() {
	modReadCache.clear();
	modNearestCache.clear();
	modScopeCache.clear();
	modTypeCache.clear();
	pkgReadCache.clear();
	pkgNearestCache.clear();
}

function slabToWinPath(p) {
	if (typeof p === "string") return p;
	if (p instanceof URL && p.protocol === "file:") {
		try { return fileURLToPath(p); } catch { return ""; }
	}
	if (Buffer.isBuffer(p)) return p.toString("utf8");
	return "";
}

function slabNormKey(p) {
	const s = IS_WIN32 ? stripWinNsPrefix(p).replaceAll("/", "\\\\") : p;
	return IS_WIN32 ? s.toLowerCase() : s;
}

function resolveBootFsOrigReadFileSync() {
	return _origFsReadFileSync ?? readFileSync;
}

function isSimpleReadOpts(opts) {
	if (opts === void 0 || opts === null || opts === "utf8" || opts === "utf-8") return true;
	if (typeof opts !== "object" || Buffer.isBuffer(opts) || Array.isArray(opts)) return false;
	if (opts.flag !== void 0 && opts.flag !== "r") return false;
	return opts.encoding === void 0 || opts.encoding === null || opts.encoding === "utf8" || opts.encoding === "utf-8";
}

function getEncodingString(opts) {
	return typeof opts === "string" ? opts : opts?.encoding;
}

function markSlabDirty(cleanPath, prefix, recursive) {
	if (slabActive) {
		slabDirtyPaths.add(cleanPath);
		extByPath.delete(cleanPath);
		if (recursive) {
			for (const k of extByPath.keys()) {
				if (k === cleanPath || k.startsWith(prefix)) extByPath.delete(k);
			}
			for (const p of collectedExtData) {
				const pk = slabNormKey(p);
				if (pk === cleanPath || pk.startsWith(prefix)) collectedExtData.delete(p);
			}
		}
	}
	clearSlabPkgCaches();
	bootEsmRelDirCache.clear();
}

function tryLoadAsarSlabSync(asarSlabPath, curAsarPath) {
	const t0 = performance.now();
	try {
		const st = statAsarReal(curAsarPath);
		slabAsarPath = curAsarPath;
		slabAsarSize = st.size;
		slabAsarMtimeMs = st.mtimeMs;
		const abuf = resolveBootFsOrigReadFileSync()(asarSlabPath);
		if (abuf.byteLength < 16 || abuf.subarray(0, 8).toString("ascii") !== SLAB_MAGIC) {
			slabAsarNeedBuild = true;
			return;
		}
		const hdrLen = abuf.readUInt32LE(8);
		const payloadStart = abuf.readUInt32LE(12);
		if (hdrLen <= 0 || payloadStart < 16 + hdrLen || payloadStart > abuf.byteLength) {
			slabAsarNeedBuild = true;
			return;
		}
		const meta = JSON.parse(abuf.subarray(16, 16 + hdrLen).toString("utf8"));
		if (
			meta?.version !== 1 ||
			meta.kind !== "asar" ||
			meta.v8Version !== process.versions.v8 ||
			meta.arch !== process.arch ||
			meta.platform !== process.platform ||
			meta.asarSize !== st.size ||
			meta.asarMtimeMs !== st.mtimeMs ||
			!Array.isArray(meta.entries)
		) {
			slabAsarNeedBuild = true;
			return;
		}
		for (let i = 0; i < meta.entries.length; i++) {
			const e = meta.entries[i];
			const end = payloadStart + e.cdOff + e.cdLen;
			if (end > abuf.byteLength) {
				asarCcMap.clear();
				slabAsarNeedBuild = true;
				return;
			}
			asarCcMap.set(slabNormKey(e.path), {
				kind: e.kind,
				cdSlice: abuf.subarray(payloadStart + e.cdOff, end)
			});
		}
		bootSlabMetrics.asarCcCount = asarCcMap.size;
	} catch {
		slabAsarNeedBuild = true;
	} finally {
		bootSlabMetrics.asarLoadMs = +(performance.now() - t0).toFixed(1);
	}
}

const EXT_VERIFY_WORKER_SRC = "(" + function () {
	const { parentPort, workerData } = require("node:worker_threads");
	const fs = require("node:fs");
	(async () => {
		try {
			const st = fs.statSync(workerData.extSlabPath);
			if (st.size < 16) return parentPort.postMessage({ ok: false, reason: "small" });
			const sab = new SharedArrayBuffer(st.size);
			const view = Buffer.from(sab);
			const fd = fs.openSync(workerData.extSlabPath, "r");
			try {
				let pos = 0;
				while (pos < st.size) pos += fs.readSync(fd, view, pos, st.size - pos, pos);
			} finally {
				fs.closeSync(fd);
			}
			if (view.subarray(0, 8).toString("ascii") !== "DSHSLAB1") {
				return parentPort.postMessage({ ok: false, reason: "magic" });
			}
			const hdrLen = view.readUInt32LE(8);
			const payloadStart = view.readUInt32LE(12);
			if (hdrLen <= 0 || payloadStart < 16 + hdrLen || payloadStart > st.size) {
				return parentPort.postMessage({ ok: false, reason: "hdr" });
			}
			const meta = JSON.parse(view.subarray(16, 16 + hdrLen).toString("utf8"));
			if (
				!meta || meta.version !== 1 || meta.kind !== "ext" ||
				meta.v8Version !== workerData.v8Version ||
				meta.arch !== workerData.arch ||
				meta.platform !== workerData.platform ||
				!Array.isArray(meta.entries)
			) {
				return parentPort.postMessage({ ok: false, reason: "meta" });
			}
			const entries = meta.entries;
			for (let i = 0; i < entries.length; i++) {
				const e = entries[i];
				if (payloadStart + e.srcOff + e.srcLen > st.size || payloadStart + e.cdOff + e.cdLen > st.size) {
					return parentPort.postMessage({ ok: false, reason: "bounds" });
				}
			}
			const validSab = new SharedArrayBuffer(entries.length);
			const valid = new Uint8Array(validSab);
			let nextIdx = 0;
			const workers = [];
			const nWorkers = Math.min(64, Math.max(1, entries.length));
			for (let w = 0; w < nWorkers; w++) {
				workers.push((async () => {
					while (true) {
						const i = nextIdx++;
						if (i >= entries.length) break;
						const e = entries[i];
						try {
							const est = await fs.promises.stat(e.path);
							if (est.isFile() && est.size === e.size && est.mtimeMs === e.mtimeMs) valid[i] = 1;
						} catch {}
					}
				})());
			}
			await Promise.all(workers);
			parentPort.postMessage({ ok: true, sab, validSab, hdrLen, payloadStart });
		} catch {
			parentPort.postMessage({ ok: false, reason: "err" });
		}
	})();
}.toString() + ")()";

const SLAB_BUILD_WORKER_SRC = "(" + function () {
	const { parentPort, workerData } = require("node:worker_threads");
	const fs = require("node:fs");
	const path = require("node:path");
	const { pathToFileURL } = require("node:url");

	const origW = process.emitWarning;
	process.emitWarning = (m, t, ...r) => (t === "internal/test/binding" ? void 0 : origW.call(process, m, t, ...r));
	const { internalBinding } = require("internal/test/binding");
	process.emitWarning = origW;

	const { compileFunction, compileFunctionForCJSLoader } = internalBinding("contextify");
	const { ModuleWrap } = internalBinding("module_wrap");
	const { vm_dynamic_import_default_internal, source_text_module_default_hdo } = internalBinding("symbols");
	const pkgReader = require("internal/modules/package_json_reader");
	const params5 = ["exports", "require", "module", "__filename", "__dirname"];
	const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

	function sleepSync(ms) {
		try {
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
		} catch {
			const end = Date.now() + ms;
			while (Date.now() < end) {}
		}
	}

	function renameWithRetry(tmpPath, outPath) {
		const delays = [50, 100, 150, 250, 400];
		let lastErr;
		for (let attempt = 0; attempt <= delays.length; attempt++) {
			try {
				fs.renameSync(tmpPath, outPath);
				return;
			} catch (err) {
				lastErr = err;
				const code = err && typeof err === "object" ? err.code : "";
				if ((code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") || attempt === delays.length) break;
				sleepSync(delays[attempt]);
			}
		}
		throw lastErr;
	}

	function cleanupStaleTmps(dir, prefix) {
		try {
			for (const name of fs.readdirSync(dir)) {
				if (name.startsWith(prefix + ".tmp.")) {
					try { fs.rmSync(path.join(dir, name), { force: true }); } catch {}
				}
			}
		} catch {}
	}

	function writeSlabFile(outPath, headerObj, chunks, payloadLen) {
		const dir = path.dirname(outPath);
		fs.mkdirSync(dir, { recursive: true });
		cleanupStaleTmps(dir, path.basename(outPath));
		const hdrRaw = Buffer.from(JSON.stringify(headerObj), "utf8");
		const totalPre = 16 + hdrRaw.byteLength;
		const hdrPad = (8 - (totalPre & 7)) & 7;
		const prefix = Buffer.alloc(16);
		prefix.write("DSHSLAB1", 0, 8, "ascii");
		prefix.writeUInt32LE(hdrRaw.byteLength, 8);
		prefix.writeUInt32LE(totalPre + hdrPad, 12);
		const tmpPath = outPath + ".tmp." + process.pid + "." + Date.now();
		const fd = fs.openSync(tmpPath, "w");
		try {
			fs.writeSync(fd, prefix);
			fs.writeSync(fd, hdrRaw);
			if (hdrPad > 0) fs.writeSync(fd, Buffer.alloc(hdrPad));
			for (let i = 0; i < chunks.length; i++) {
				if (chunks[i].byteLength > 0) fs.writeSync(fd, chunks[i]);
			}
		} catch (e) {
			try { fs.closeSync(fd); } catch {}
			try { fs.rmSync(tmpPath, { force: true }); } catch {}
			throw e;
		}
		fs.closeSync(fd);
		renameWithRetry(tmpPath, outPath);
	}

	function compileModuleCachedData(fp, kind, src) {
		let actualKind = kind;
		let cd = null;
		if (kind === "cjs") {
			let pjsonType;
			if (fp.endsWith(".js")) {
				try { pjsonType = pkgReader.getNearestParentPackageJSON(fp)?.data?.type; } catch {}
			}
			if (pjsonType === "module" || fp.endsWith(".mjs")) {
				actualKind = "esm";
			} else {
				try {
					const r = compileFunction(src, fp, 0, 0, undefined, true, undefined, [], params5, vm_dynamic_import_default_internal, vm_dynamic_import_default_internal);
					if (r.cachedDataProduced && r.cachedData) cd = Buffer.from(r.cachedData);
				} catch {
					try {
						const r2 = compileFunctionForCJSLoader(src, fp, false, true);
						if (r2.canParseAsESM) actualKind = "esm";
					} catch {}
				}
			}
		}
		if (actualKind === "esm" && !cd) {
			try {
				const w = new ModuleWrap(pathToFileURL(fp).href, undefined, src, 0, 0, source_text_module_default_hdo);
				const buf = w.createCachedData();
				if (buf && buf.byteLength > 0) cd = Buffer.from(buf);
			} catch {}
		}
		return { actualKind, cd };
	}

	try {
		const res = { builtAsar: false, builtExt: false, asarCount: 0, extCount: 0 };
		if (workerData.buildAsar && workerData.asarSlabPath && workerData.asarTargets.length > 0) {
			const entries = [];
			const chunks = [];
			let off = 0;
			for (let i = 0; i < workerData.asarTargets.length; i++) {
				const item = workerData.asarTargets[i];
				let raw;
				try { raw = fs.readFileSync(item.path, "utf8"); } catch { continue; }
				const { actualKind, cd } = compileModuleCachedData(item.path, item.kind, stripBom(raw));
				if (!cd || cd.byteLength === 0) continue;
				const pad = (8 - (off & 7)) & 7;
				if (pad > 0) { chunks.push(Buffer.alloc(pad)); off += pad; }
				entries.push({ path: item.path, kind: actualKind, cdOff: off, cdLen: cd.byteLength });
				chunks.push(cd);
				off += cd.byteLength;
			}
			writeSlabFile(workerData.asarSlabPath, {
				version: 1, kind: "asar",
				v8Version: process.versions.v8, arch: process.arch, platform: process.platform,
				asarSize: workerData.asarSize, asarMtimeMs: workerData.asarMtimeMs,
				entries
			}, chunks, off);
			res.builtAsar = true;
			res.asarCount = entries.length;
		}
		if (workerData.buildExt && workerData.extSlabPath && workerData.extTargets.length > 0) {
			const entries = [];
			const chunks = [];
			let off = 0;
			for (let i = 0; i < workerData.extTargets.length; i++) {
				const item = workerData.extTargets[i];
				let st;
				try { st = fs.statSync(item.path); } catch { continue; }
				if (!st.isFile() || st.size <= 0 || st.size > 8 * 1024 * 1024) continue;
				let rawBuf;
				try { rawBuf = fs.readFileSync(item.path); } catch { continue; }
				if (rawBuf.byteLength !== st.size) continue;
				let st2;
				try { st2 = fs.statSync(item.path); } catch { continue; }
				if (!st2.isFile() || st2.size !== st.size || st2.mtimeMs !== st.mtimeMs) continue;
				let cd = null;
				let finalKind = item.kind;
				if (item.kind === "cjs" || item.kind === "esm") {
					const compiled = compileModuleCachedData(item.path, item.kind, stripBom(rawBuf.toString("utf8")));
					finalKind = compiled.actualKind;
					cd = compiled.cd;
				}
				const srcOff = off;
				const srcLen = rawBuf.byteLength;
				chunks.push(rawBuf);
				off += srcLen;
				let cdOff = 0, cdLen = 0;
				if (cd && cd.byteLength > 0) {
					const pad = (8 - (off & 7)) & 7;
					if (pad > 0) { chunks.push(Buffer.alloc(pad)); off += pad; }
					cdOff = off;
					cdLen = cd.byteLength;
					chunks.push(cd);
					off += cdLen;
				}
				const endPad = (8 - (off & 7)) & 7;
				if (endPad > 0) { chunks.push(Buffer.alloc(endPad)); off += endPad; }
				entries.push({ path: item.path, kind: finalKind, size: st.size, mtimeMs: st.mtimeMs, srcOff, srcLen, cdOff, cdLen });
			}
			writeSlabFile(workerData.extSlabPath, {
				version: 1, kind: "ext",
				v8Version: process.versions.v8, arch: process.arch, platform: process.platform,
				entries
			}, chunks, off);
			res.builtExt = true;
			res.extCount = entries.length;
		}
		parentPort.postMessage({ ok: true, ...res });
	} catch (err) {
		parentPort.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
	}
}.toString() + ")()";

function installSlabRuntimeHooks() {
	if (slabHooksInstalled) return;
	slabHooksInstalled = true;
	const reqBoot = createRequire(import.meta.url);
	let internalBindingFn = null;
	const origWarn = process.emitWarning;
	process.emitWarning = (msg, type, ...rest) => {
		if (type === "internal/test/binding") return;
		return origWarn.call(process, msg, type, ...rest);
	};
	try {
		internalBindingFn = reqBoot("internal/test/binding").internalBinding;
	} catch {
		internalBindingFn = null;
	} finally {
		process.emitWarning = origWarn;
	}
	if (typeof internalBindingFn !== "function") return;

	try {
		const { compileFunction } = internalBindingFn("contextify");
		const { ModuleWrap } = internalBindingFn("module_wrap");
		const { vm_dynamic_import_default_internal } = internalBindingFn("symbols");
		const { privateSymbols: { module_source_private_symbol: kModuleSource } } = internalBindingFn("util");
		const modulesBinding = internalBindingFn("modules");
		const { getOptionValue } = reqBoot("internal/options");
		const { maybeCacheSourceMap } = reqBoot("internal/source_map/source_map_cache");
		const { makeRequireFunction, stringify } = reqBoot("internal/modules/helpers");
		const { kIsExecuting } = reqBoot("internal/modules/cjs/loader");
		const mUtils = reqBoot("internal/modules/esm/utils");
		const { translators } = reqBoot("internal/modules/esm/translators");
		const esmLoaderMod = reqBoot("internal/modules/esm/loader");
		const pkgReader = reqBoot("internal/modules/package_json_reader");
		const cascadedLoader = esmLoaderMod.getOrInitializeCascadedLoader();

		const hookWrap = (obj, key, makeFn) => {
			const orig = obj[key];
			if (typeof orig !== "function") return;
			obj[key] = makeFn(orig);
			slabHookRestorers.push(() => { obj[key] = orig; });
		};

		// 1. modulesBinding C++ 边界与 pkgReader 缓存
		hookWrap(modulesBinding, "readPackageJSON", (orig) => function (jsonPath, isESM, base, specifier) {
			if (!slabActive || typeof jsonPath !== "string") return orig.call(this, jsonPath, isESM, base, specifier);
			const c = modReadCache.get(jsonPath);
			if (c !== void 0) { bootSlabMetrics.modReadHit++; return c === null ? void 0 : c; }
			const r = orig.call(this, jsonPath, isESM, base, specifier);
			modReadCache.set(jsonPath, r === void 0 ? null : r);
			return r;
		});
		hookWrap(modulesBinding, "getNearestParentPackageJSON", (orig) => function (checkPath) {
			if (!slabActive || typeof checkPath !== "string") return orig.call(this, checkPath);
			const idx = checkPath.lastIndexOf(sep);
			const isDirLike = idx > 0 && checkPath.indexOf(".", idx) < 0;
			const key = isDirLike ? checkPath : (idx > 0 ? checkPath.slice(0, idx) : checkPath);
			const c = modNearestCache.get(key);
			if (c !== void 0) { bootSlabMetrics.modNearestHit++; return c === null ? void 0 : c; }
			const r = orig.call(this, checkPath);
			modNearestCache.set(key, r === void 0 ? null : r);
			return r;
		});
		hookWrap(modulesBinding, "getPackageScopeConfig", (orig) => function (resolvedStr) {
			if (!slabActive) return orig.call(this, resolvedStr);
			const s = String(resolvedStr);
			const idx = s.lastIndexOf("/");
			const key = idx > 0 ? s.slice(0, idx) : s;
			const c = modScopeCache.get(key);
			if (c !== void 0) { bootSlabMetrics.modScopeHit++; return c === null ? void 0 : c; }
			const r = orig.call(this, s);
			modScopeCache.set(key, r === void 0 ? null : r);
			return r;
		});
		hookWrap(modulesBinding, "getPackageType", (orig) => function (urlStr) {
			if (!slabActive) return orig.call(this, urlStr);
			const s = String(urlStr);
			const idx = s.lastIndexOf("/");
			const key = idx > 0 ? s.slice(0, idx) : s;
			const c = modTypeCache.get(key);
			if (c !== void 0) { bootSlabMetrics.modTypeHit++; return c; }
			const r = orig.call(this, s);
			modTypeCache.set(key, r);
			return r;
		});
		hookWrap(pkgReader, "read", (orig) => function (jsonPath, options) {
			if (!slabActive || typeof jsonPath !== "string") return orig.call(this, jsonPath, options);
			const c = pkgReadCache.get(jsonPath);
			if (c !== void 0) { bootSlabMetrics.pkgReadHit++; return c; }
			const res = orig.call(this, jsonPath, options);
			if (res && res.exists) pkgReadCache.set(jsonPath, res);
			return res;
		});
		hookWrap(pkgReader, "getNearestParentPackageJSON", (orig) => function (checkPath) {
			if (!slabActive || typeof checkPath !== "string") return orig.call(this, checkPath);
			const idx = checkPath.lastIndexOf(sep);
			const isDirLike = idx > 0 && checkPath.indexOf(".", idx) < 0;
			const key = isDirLike ? checkPath : (idx > 0 ? checkPath.slice(0, idx) : checkPath);
			const c = pkgNearestCache.get(key);
			if (c !== void 0) { bootSlabMetrics.pkgNearestHit++; return c === null ? void 0 : c; }
			const res = orig.call(this, checkPath);
			pkgNearestCache.set(key, res === void 0 ? null : res);
			return res;
		});

		function recordLoadedModule(fp, kind) {
			if (!slabActive || !fp) return;
			const nk = slabNormKey(fp);
			if (isAsarImmutablePath(fp)) {
				if (!collectedAsarMods.has(nk)) collectedAsarMods.set(nk, { path: fp, kind });
				else if (kind === "esm") collectedAsarMods.get(nk).kind = "esm";
				return;
			}
			if (slabDirtyPaths.has(nk)) return;
			if (!collectedExtMods.has(nk)) collectedExtMods.set(nk, { path: fp, kind });
			else if (kind === "esm") collectedExtMods.get(nk).kind = "esm";
		}

		function lookupCodeCache(fp) {
			if (!slabActive) return null;
			const nk = slabNormKey(fp);
			if (isAsarImmutablePath(fp)) {
				const a = asarCcMap.get(nk);
				return a ? { entry: a, isAsar: true, nk } : null;
			}
			if (!slabExtReady || slabDirtyPaths.has(nk)) return null;
			const e = extByPath.get(nk);
			return e && e.cdSlice ? { entry: e, isAsar: false, nk } : null;
		}

		// 2. ESM translator hook
		const defaultInitMeta = (meta, wrap) => cascadedLoader.importMetaInitialize(meta, { url: wrap.url, isMain: wrap.isMain });
		const defaultDynImport = (specifier, referrer, attributes, phase) => cascadedLoader.import(specifier, referrer.url, attributes, phase);
		const printReqTla = getOptionValue("--experimental-print-required-tla");
		const origEsmModule = translators.get("module");
		translators.set("module", function (url, translateContext, parentURL) {
			if (slabActive && typeof url === "string" && url.startsWith("file:")) {
				let fp = "";
				try { fp = fileURLToPath(url); } catch {}
				if (fp) {
					recordLoadedModule(fp, "esm");
					const hit = lookupCodeCache(fp);
					if (hit && hit.entry.cdSlice) {
						const sourceStr = stringify(translateContext.source);
						try {
							const wrap = new ModuleWrap(url, undefined, sourceStr, 0, 0, hit.entry.cdSlice);
							mUtils.registerModule(wrap, { initializeImportMeta: defaultInitMeta, importModuleDynamically: defaultDynImport });
							if (parentURL === void 0) wrap.isMain = true;
							if (wrap.hasTopLevelAwait && printReqTla) wrap[kModuleSource] = sourceStr;
							if (wrap.sourceMapURL) maybeCacheSourceMap(url, sourceStr, wrap, false, wrap.sourceURL, wrap.sourceMapURL);
							if (hit.isAsar) { bootSlabMetrics.asarEsmHit++; } else { bootSlabMetrics.extEsmHit++; }
							return wrap;
						} catch {
							bootSlabMetrics.fallbackRej++;
							if (hit.isAsar) { asarCcMap.delete(hit.nk); slabAsarRejectCount++; }
							else { extByPath.delete(hit.nk); slabExtRejectCount++; }
						}
					} else {
						if (isAsarImmutablePath(fp)) slabAsarMissCount++;
						else if (slabExtReady) slabExtMissCount++;
					}
				}
			}
			return origEsmModule.call(this, url, translateContext, parentURL);
		});
		slabHookRestorers.push(() => { translators.set("module", origEsmModule); });

		// 3. CJS _compile hook（严格分离 compile 与 execute 阶段 catch，绝不双执行模块体异常！）
		const params5 = ["exports", "require", "module", "__filename", "__dirname"];
		const localGlobal = typeof global !== "undefined" ? global : void 0;
		const localBuffer = typeof Buffer !== "undefined" ? Buffer : void 0;
		const origCompile = Module.prototype._compile;
		Module.prototype._compile = function (content, filename, format) {
			if (slabActive && format !== "module" && format !== "commonjs-typescript" && format !== "module-typescript" && format !== "typescript") {
				recordLoadedModule(filename, "cjs");
				const hit = lookupCodeCache(filename);
				if (hit && hit.entry.kind === "cjs" && hit.entry.cdSlice) {
					let res = null;
					try {
						res = compileFunction(
							content, filename, 0, 0, hit.entry.cdSlice, false, undefined, [],
							params5, vm_dynamic_import_default_internal, vm_dynamic_import_default_internal
						);
					} catch {
						bootSlabMetrics.fallbackSyntax++;
						res = null;
					}
					if (res !== null && !res.cachedDataRejected && typeof res.function === "function") {
						if (hit.isAsar) bootSlabMetrics.asarCjsHit++;
						else bootSlabMetrics.extCjsHit++;
						if (res.sourceMapURL) maybeCacheSourceMap(filename, content, this, false, res.sourceURL, res.sourceMapURL);
						const dirName = dirname(filename);
						const reqFn = makeRequireFunction(this);
						this[kIsExecuting] = true;
						try {
							return res.function.call(this.exports, this.exports, reqFn, this, filename, dirName, process, localGlobal, localBuffer);
						} finally {
							this[kIsExecuting] = false;
						}
					} else if (res !== null && res.cachedDataRejected) {
						bootSlabMetrics.fallbackRej++;
						if (hit.isAsar) { asarCcMap.delete(hit.nk); slabAsarRejectCount++; }
						else { extByPath.delete(hit.nk); slabExtRejectCount++; }
					}
				} else {
					if (isAsarImmutablePath(filename)) slabAsarMissCount++;
					else if (slabExtReady) slabExtMissCount++;
				}
			}
			return origCompile.call(this, content, filename, format);
		};
		slabHookRestorers.push(() => { Module.prototype._compile = origCompile; });
	} catch {}
}

function enableBootSlab(options = {}) {
	if (isBootFastOptDisabled() || process.env.DSH_DISABLE_SLAB === "1") return;
	if (slabActive || slabFinished) return;
	const home = options.home ?? resolveDshHome();
	const cacheDir = join(home, "cache", "boot-slab-v1");
	slabHomeDir = home;
	const profKeyInput = options.projectDir ?? options.profileDir ?? "default";
	slabProfileKey = createHash("sha1").update(String(profKeyInput)).digest("hex").slice(0, 12);

	const selfFile = fileURLToPath(import.meta.url);
	const asarPath = options.asarPath ?? extractAsarArchivePath(selfFile);
	const asarKey = asarPath ? createHash("sha1").update(slabNormKey(asarPath)).digest("hex").slice(0, 10) : "none";
	const asarSlabPath = asarPath ? join(cacheDir, \`asar-cc-\${asarKey}.bin\`) : "";
	const extSlabPath = join(cacheDir, \`ext-slab-\${slabProfileKey}.bin\`);

	slabActive = true;
	bootSlabMetrics.enabled = true;

	if (asarPath) {
		tryLoadAsarSlabSync(asarSlabPath, asarPath);
	}
	// 启动异步 Worker 读入 ext-slab 并在 64 并发下验证 mtime/size
	if (existsSync(extSlabPath)) {
		try {
			const w = new Worker(EXT_VERIFY_WORKER_SRC, {
				eval: true,
				workerData: {
					extSlabPath,
					v8Version: process.versions.v8,
					arch: process.arch,
					platform: process.platform
				}
			});
			w.unref();
			slabVerifyWorker = w;
			const tStart = performance.now();
			w.on("message", (msg) => {
				if (!slabActive) return;
				if (!msg || !msg.ok) {
					slabExtNeedBuild = true;
					return;
				}
				try {
					const view = Buffer.from(msg.sab);
					const valid = new Uint8Array(msg.validSab);
					const meta = JSON.parse(view.subarray(16, 16 + msg.hdrLen).toString("utf8"));
					const entries = meta.entries;
					const ps = msg.payloadStart;
					let missOrInvalid = 0;
					for (let i = 0; i < entries.length; i++) {
						if (valid[i] !== 1) { missOrInvalid++; continue; }
						const e = entries[i];
						const nk = slabNormKey(e.path);
						if (slabDirtyPaths.has(nk)) { missOrInvalid++; continue; }
						const srcSlice = view.subarray(ps + e.srcOff, ps + e.srcOff + e.srcLen);
						const cdSlice = e.cdLen > 0 ? view.subarray(ps + e.cdOff, ps + e.cdOff + e.cdLen) : null;
						extByPath.set(nk, { kind: e.kind, srcSlice, cdSlice });
					}
					slabExtReady = true;
					bootSlabMetrics.extSlabReady = true;
					bootSlabMetrics.extEntryCount = extByPath.size;
					bootSlabMetrics.workerReadyAtMs = +(performance.now() - tStart).toFixed(1);
					if (missOrInvalid > 5 || (entries.length > 0 && missOrInvalid / entries.length > 0.02)) {
						slabExtNeedBuild = true;
					}
				} catch {
					slabExtNeedBuild = true;
				}
			});
			w.on("error", () => { slabExtNeedBuild = true; });
		} catch {
			slabExtNeedBuild = true;
		}
	} else {
		slabExtNeedBuild = true;
	}

	installSlabRuntimeHooks();
}

function cancelPendingSlabBuild(reason = "recompose") {
	if (slabBuildDelayTimer !== null) {
		clearTimeout(slabBuildDelayTimer);
		slabBuildDelayTimer = null;
	}
	if (slabBuildWorker !== null) {
		try { slabBuildWorker.terminate().catch(() => {}); } catch {}
		slabBuildWorker = null;
	}
	if (slabActiveBuildResolve !== null) {
		const done = slabActiveBuildResolve;
		slabActiveBuildResolve = null;
		bootSlabMetrics.buildCancelled = true;
		done({ ok: false, cancelled: true, reason });
	}
}

function onRuntimeRecompose(ctx) {
	runtimeRecomposeEpoch++;
	profileDirSnapshotCache.clear();
	clearAllBootVolatileCaches();
	noteResGlobalWrite();
	cancelPendingSlabBuild("recompose");
	try {
		const profCtx = ctx?.get?.("profileContext");
		const home = profCtx?.home ?? resolveDshHome();
		const installAnchor = profCtx?.installAnchor;
		const profileDir = profCtx?.dir;
		if (home && installAnchor) {
			const snapPath = getResSnapshotFilePath(home, installAnchor, profileDir);
			resSnapWriteSeqByPath.set(snapPath, ++resSnapTmpSeq);
			rm(snapPath, { force: true }).catch(() => {});
		}
	} catch {}
}

function finishBootSlab() {
	if (!slabActive || slabFinished) return;
	slabFinished = true;
	slabActive = false;
	slabExtReady = false;

	const needAsarBuild = Boolean(slabAsarPath) && collectedAsarMods.size > 0 && (
		asarCcMap.size === 0 || slabAsarNeedBuild || slabAsarRejectCount > 0 || slabAsarMissCount > 15
	);
	const needExtBuild = (collectedExtMods.size > 0 || collectedExtData.size > 0) && (
		extByPath.size === 0 || slabExtNeedBuild || slabExtRejectCount > 0 || slabExtMissCount > 15
	);

	// 采集列表在清理前提取完毕
	const asarTargets = needAsarBuild ? [...collectedAsarMods.values()] : [];
	const extTargetMap = new Map();
	if (needExtBuild) {
		for (const [k, v] of collectedExtMods) {
			if (!slabDirtyPaths.has(k)) extTargetMap.set(k, v);
		}
		for (const p of collectedExtData) {
			const k = slabNormKey(p);
			if (!slabDirtyPaths.has(k) && !extTargetMap.has(k)) extTargetMap.set(k, { path: p, kind: "data" });
		}
	}
	const extTargets = [...extTargetMap.values()];

	// 卸载钩子并释放全部内存表与验证 Worker
	for (let i = slabHookRestorers.length - 1; i >= 0; i--) {
		try { slabHookRestorers[i](); } catch {}
	}
	slabHookRestorers.length = 0;
	slabHooksInstalled = false;
	asarCcMap.clear();
	extByPath.clear();
	collectedAsarMods.clear();
	collectedExtMods.clear();
	collectedExtData.clear();
	slabDirtyPaths.clear();
	clearSlabPkgCaches();
	if (slabVerifyWorker) {
		try { slabVerifyWorker.terminate().catch(() => {}); } catch {}
		slabVerifyWorker = null;
	}

	if ((asarTargets.length > 0 || extTargets.length > 0) && slabHomeDir && !isBootFastOptDisabled() && process.env.DSH_NO_SLAB_BUILD !== "1") {
		const waitBuild = process.env.DSH_WAIT_SLAB_BUILD === "1";
		const parsedDelay = Number(process.env.DSH_SLAB_BUILD_DELAY_MS);
		const delayMs = waitBuild ? 0 : (Number.isFinite(parsedDelay) && parsedDelay >= 0 ? parsedDelay : 4000);
		const scheduledEpoch = runtimeRecomposeEpoch;
		bootSlabMetrics.buildTriggered = true;
		const cacheDir = join(slabHomeDir, "cache", "boot-slab-v1");
		const asarKey = slabAsarPath ? createHash("sha1").update(slabNormKey(slabAsarPath)).digest("hex").slice(0, 10) : "none";
		const asarSlabPath = slabAsarPath ? join(cacheDir, \`asar-cc-\${asarKey}.bin\`) : "";
		const extSlabPath = join(cacheDir, \`ext-slab-\${slabProfileKey}.bin\`);
		slabBuildPromise = new Promise((resolvePromise) => {
			let settled = false;
			const finishResolve = (val) => {
				if (settled) return;
				settled = true;
				if (slabActiveBuildResolve === finishResolve) slabActiveBuildResolve = null;
				resolvePromise(val);
			};
			slabActiveBuildResolve = finishResolve;
			const launchBuild = () => {
				if (settled) return;
				if (runtimeRecomposeEpoch !== scheduledEpoch) {
					bootSlabMetrics.buildCancelled = true;
					finishResolve({ ok: false, cancelled: true, reason: "epoch-changed" });
					return;
				}
				try {
					const bw = new Worker(SLAB_BUILD_WORKER_SRC, {
						eval: true,
						workerData: {
							buildAsar: asarTargets.length > 0,
							buildExt: extTargets.length > 0,
							asarSlabPath,
							extSlabPath,
							asarSize: slabAsarSize,
							asarMtimeMs: slabAsarMtimeMs,
							asarTargets,
							extTargets
						}
					});
					if (!waitBuild) bw.unref();
					slabBuildWorker = bw;
					bw.on("message", (msg) => {
						slabBuildWorker = null;
						finishResolve(msg ?? { ok: true });
					});
					bw.on("error", (e) => {
						slabBuildWorker = null;
						finishResolve({ ok: false, error: e?.message ?? String(e) });
					});
					bw.on("exit", (c) => {
						slabBuildWorker = null;
						finishResolve({ ok: c === 0, code: c });
					});
				} catch (e) {
					finishResolve({ ok: false, error: e?.message ?? String(e) });
				}
			};
			if (delayMs > 0) {
				slabBuildDelayTimer = setTimeout(() => {
					slabBuildDelayTimer = null;
					launchBuild();
				}, delayMs);
				slabBuildDelayTimer.unref();
			} else {
				launchBuild();
			}
		});
	}
}

globalThis[BOOT_SLAB_SYMBOL] = {
	enable: enableBootSlab,
	finish: finishBootSlab,
	cancelBuild: (r) => cancelPendingSlabBuild(r ?? "manual"),
	waitForBuild: () => slabBuildPromise ?? Promise.resolve({ skipped: true }),
	getMetrics: () => ({ ...bootSlabMetrics }),
	getRecomposeEpoch: () => runtimeRecomposeEpoch
};

// [Step 3/4] Boot-Phase Directory-Backed FS Accelerator + Write Invalidation
let bootPhaseActive = false;
let bootPhaseDepth = 0;
let bootAccelInstalled = false;
const asarStatCache = /* @__PURE__ */ new Map();
const asarRealpathCache = /* @__PURE__ */ new Map();
const asarRealpathNativeCache = /* @__PURE__ */ new Map();
const bootDirCache = /* @__PURE__ */ new Map();
const bootExactStatCache = /* @__PURE__ */ new Map();
const MISSING_STATE = { status: "missing" };
const FALLBACK_STATE = { status: "fallback" };
const SIMPLE_WIN_ABS_RE = /^[A-Za-z]:(?:\\\\[^\\\\/:*?"<>|\\r\\n~]+)+$/u;
const ASAR_SEGMENT_RE = /\\.asar(?:\\\\|$)/iu;

let _origBindingFs = null;
let _origInternalModuleStat = null;
let _origRealpathSync = null;
let _origRealpathNative = null;
let _origFsReadFileSync = null;
let _missingDiskStat = null;
let _bootFsRestorers = [];

const WIN_NS_PREFIX = String.fromCharCode(92, 92, 63, 92);
function hasWinNsPrefix(p) {
	return IS_WIN32 && typeof p === "string" && p.length > 7 && p.charCodeAt(0) === 92 && p.charCodeAt(1) === 92 && p.charCodeAt(2) === 63 && p.charCodeAt(3) === 92 && p.charCodeAt(5) === 58 && p.charCodeAt(6) === 92;
}
function stripWinNsPrefix(p) {
	return hasWinNsPrefix(p) ? p.slice(4) : p;
}
function isDefaultRpUtf8Options(options) {
	if (options === void 0 || options === null || options === "utf8" || options === "utf-8") return true;
	if (typeof options !== "object" || Array.isArray(options) || Buffer.isBuffer(options)) return false;
	const enc = options.encoding;
	if (enc !== void 0 && enc !== null && enc !== "utf8" && enc !== "utf-8") return false;
	for (const k in options) {
		if (Object.prototype.hasOwnProperty.call(options, k) && k !== "encoding") return false;
	}
	return true;
}
function isSimpleWinPath(p) {
	if (!IS_WIN32 || typeof p !== "string") return false;
	if (!SIMPLE_WIN_ABS_RE.test(p)) return false;
	if (p.includes("\\\\.\\\\") || p.includes("\\\\..\\\\") || p.endsWith("\\\\.") || p.endsWith("\\\\..")) return false;
	return true;
}
function isDriveRootWin(p) {
	return IS_WIN32 && p.length === 3 && p.charCodeAt(1) === 58 && p.charCodeAt(2) === 92 && /^[A-Za-z]$/u.test(p[0]);
}
function normalizeInvalidateTarget(target) {
	let str;
	if (typeof target === "string") str = target;
	else if (target instanceof URL) {
		try { str = fileURLToPath(target); } catch { return null; }
	} else if (Buffer.isBuffer(target)) str = target.toString("utf8");
	else return null;
	if (str.length === 0) return null;
	if (!IS_WIN32) {
		const abs = isAbsolute(str) ? str : resolve(str);
		return abs.length > 1 && abs.endsWith("/") ? abs.slice(0, -1) : abs;
	}
	let norm = stripWinNsPrefix(str).replaceAll("/", "\\\\");
	if (!isAbsolute(norm)) norm = resolve(norm);
	if (norm.length > 3 && norm.endsWith("\\\\")) norm = norm.slice(0, -1);
	if (norm.includes("~") && typeof _origRealpathNative === "function") {
		const parts = [];
		let cur = norm;
		while (cur.includes("~") && cur.length >= 3) {
			const ls = cur.lastIndexOf("\\\\");
			if (ls < 0) break;
			parts.push(cur.slice(ls + 1));
			const par = ls === 2 ? cur.slice(0, 3) : cur.slice(0, ls);
			try {
				const rp = _origRealpathNative(par);
				norm = rp + "\\\\" + parts.reverse().join("\\\\");
				break;
			} catch {
				cur = par;
			}
		}
	}
	return norm.toLowerCase();
}
function pathHasOverlap(candidate, clean, prefix, pClean) {
	return candidate === clean || candidate === pClean || candidate.startsWith(prefix);
}
function deleteMapByPrefix(map, clean, prefix, pClean, recursive) {
	for (const k of map.keys()) {
		const kLow = IS_WIN32 ? stripWinNsPrefix(k).toLowerCase() : k;
		if (kLow === clean || kLow === pClean || (recursive && kLow.startsWith(prefix))) {
			map.delete(k);
		}
	}
}
function invalidateBootFsPath(target, meta = {}) {
	const recursive = meta.recursive === true;
	const kind = meta.kind ?? "write";
	const clean = normalizeInvalidateTarget(target);
	if (clean === null) {
		noteResGlobalWrite();
		if (!bootPhaseActive && !slabActive) return;
		clearSlabPkgCaches();
		bootEsmRelDirCache.clear();
		extByPath.clear();
		if (bootPhaseActive) clearAllBootVolatileCaches();
		return;
	}
	if (IS_WIN32 && clean.includes("~")) {
		// 无法把不存在路径的 8.3 短名映射到长名键时，安全清空目录列表防假阴性
		noteResGlobalWrite();
		if (!bootPhaseActive && !slabActive) return;
		bootDirCache.clear();
		bootExactStatCache.clear();
		dirEntriesCache.clear();
		bootManifestCache.clear();
		clearSlabPkgCaches();
		bootEsmRelDirCache.clear();
		extByPath.clear();
		return;
	}
	const sepCh = IS_WIN32 ? "\\\\" : "/";
	const lastSlash = clean.lastIndexOf(sepCh);
	const pClean = lastSlash > 0 ? (IS_WIN32 && lastSlash === 2 ? clean.slice(0, 3) : clean.slice(0, lastSlash)) : "";
	const leafLower = lastSlash >= 0 ? clean.slice(lastSlash + 1) : clean;
	const prefix = clean.endsWith(sepCh) ? clean : clean + sepCh;
	const pPrefix = pClean ? (pClean.endsWith(sepCh) ? pClean : pClean + sepCh) : "";

	const extraTargetClean = meta.mkdirTarget !== void 0 ? normalizeInvalidateTarget(meta.mkdirTarget) : null;
	noteResPathWrite(clean, pClean, prefix, recursive, kind, extraTargetClean);
	if (!bootPhaseActive && !slabActive) return;
	markSlabDirty(clean, prefix, recursive);
	if (!bootPhaseActive) return;

	if (bootDirCache.size > 0) {
		bootDirCache.delete(clean);
		if (pClean) bootDirCache.delete(pClean);
		if (recursive) {
			for (const k of bootDirCache.keys()) {
				if (k === clean || k.startsWith(prefix)) bootDirCache.delete(k);
			}
		}
	}
	if (dirEntriesCache.size > 0) {
		dirEntriesCache.delete(clean);
		if (pClean) dirEntriesCache.delete(pClean);
		if (recursive) {
			for (const k of dirEntriesCache.keys()) {
				if (k === clean || k.startsWith(prefix)) dirEntriesCache.delete(k);
			}
		}
	}
	if (bootExactStatCache.size > 0) {
		deleteMapByPrefix(bootExactStatCache, clean, prefix, pClean, recursive);
	}

	for (const k of bootManifestCache.keys()) {
		const kLow = IS_WIN32 ? k.toLowerCase() : k;
		if (kLow === clean || (recursive && kLow.startsWith(prefix))) bootManifestCache.delete(k);
	}
	if (profileDirSnapshotCache.size > 0) {
		for (const [sk, snap] of profileDirSnapshotCache.entries()) {
			let hit = false;
			for (let i = 0; i < snap.watchers.length; i++) {
				const w = IS_WIN32 ? stripWinNsPrefix(snap.watchers[i][0]).toLowerCase() : snap.watchers[i][0];
				if (w === clean || (recursive && w.startsWith(prefix))) {
					hit = true;
					break;
				}
			}
			if (hit) profileDirSnapshotCache.delete(sk);
		}
	}

	const isPkgJson = leafLower === "package.json";
	const isStructural = recursive || kind === "rm" || kind === "rmdir" || kind === "unlink" || kind === "rename" || kind === "symlink" || kind === "link" || kind === "other";
	const nmToken = sepCh + "node_modules";
	const involvesNm = clean.includes(nmToken + sepCh) || pClean.includes(nmToken) || leafLower === "node_modules";

	if ((isPkgJson || isStructural) && selfRefDirCache.size > 0) {
		for (const k of selfRefDirCache.keys()) {
			const kLow = IS_WIN32 ? stripWinNsPrefix(k).toLowerCase() : k;
			if (kLow === clean || kLow === pClean || (pPrefix && kLow.startsWith(pPrefix)) || (recursive && kLow.startsWith(prefix))) {
				selfRefDirCache.delete(k);
			}
		}
	}
	if ((isPkgJson || isStructural) && pkgDirAnchorCache.size > 0) {
		const nmPos = clean.lastIndexOf(nmToken);
		const nmOwner = nmPos > 0 ? clean.slice(0, nmPos) : "";
		for (const [pk, pv] of pkgDirAnchorCache.entries()) {
			const pSep = pk.indexOf("\\0");
			const aDir = pSep >= 0 ? (IS_WIN32 ? pk.slice(0, pSep).toLowerCase() : pk.slice(0, pSep)) : "";
			const vLow = typeof pv === "string" ? (IS_WIN32 ? pv.toLowerCase() : pv) : "";
			if (
				(vLow && (vLow === clean || vLow === pClean || vLow.startsWith(prefix) || (pClean && pClean.startsWith(vLow + sepCh)))) ||
				(pPrefix && aDir.startsWith(pPrefix)) ||
				(nmOwner && (aDir === nmOwner || aDir.startsWith(nmOwner + sepCh)))
			) {
				pkgDirAnchorCache.delete(pk);
			}
		}
	}
	if (cjsBootResolvedCache.size > 0) {
		const nmPos = clean.lastIndexOf(nmToken);
		const nmOwner = (isPkgJson || isStructural) && nmPos > 0 ? clean.slice(0, nmPos) : "";
		for (const [ck, cv] of cjsBootResolvedCache.entries()) {
			const cSep = ck.indexOf("\\0");
			const cDirLow = cSep >= 0 ? (IS_WIN32 ? stripWinNsPrefix(ck.slice(0, cSep)).toLowerCase() : ck.slice(0, cSep)) : "";
			const cvLow = typeof cv === "string" ? (IS_WIN32 ? stripWinNsPrefix(cv).toLowerCase() : cv) : "";
			if (
				cvLow === clean ||
				(pPrefix && cvLow.startsWith(pPrefix)) ||
				cDirLow === clean ||
				cDirLow === pClean ||
				(recursive && (cDirLow.startsWith(prefix) || cvLow.startsWith(prefix))) ||
				(isPkgJson && pPrefix && (cDirLow.startsWith(pPrefix) || cvLow.startsWith(pPrefix))) ||
				(nmOwner && (cDirLow === nmOwner || cDirLow.startsWith(nmOwner + sepCh)))
			) {
				cjsBootResolvedCache.delete(ck);
			}
		}
	}
	if (isStructural) {
		deleteMapByPrefix(canonicalCache, clean, prefix, pClean, recursive);
		deleteMapByPrefix(prefixesCache, clean, prefix, pClean, recursive);
		for (const rk of realDirCache.keys()) {
			if (isAsarImmutablePath(rk)) continue;
			const rLow = IS_WIN32 ? stripWinNsPrefix(rk).toLowerCase() : rk;
			if (pathHasOverlap(rLow, clean, prefix, pClean)) realDirCache.delete(rk);
		}
	}
}
// 启动阶段与解析重算共用的可变热缓存清理，确保外盘变更不跨生命周期残留
function clearNonAsarRealDirCache() {
	for (const k of realDirCache.keys()) {
		if (!isAsarImmutablePath(k)) realDirCache.delete(k);
	}
}
function clearSharedResVolatileMaps() {
	bootManifestCache.clear();
	cjsBootResolvedCache.clear();
	dirEntriesCache.clear();
	selfRefDirCache.clear();
	pkgDirAnchorCache.clear();
	anchorPathsCache.clear();
	canonicalCache.clear();
	prefixesCache.clear();
	peerNamesCache.clear();
	clearNonAsarRealDirCache();
}
function clearAllBootVolatileCaches() {
	bootDirCache.clear();
	bootExactStatCache.clear();
	bootEsmRelDirCache.clear();
	clearSharedResVolatileMaps();
}
function buildVerifiedDirState(dir, realNativeDir) {
	let ents;
	try {
		ents = readdirSync(dir, { withFileTypes: true });
	} catch (error) {
		const code = error?.code;
		return (code === "ENOENT" || code === "ENOTDIR") ? MISSING_STATE : FALLBACK_STATE;
	}
	const entries = /* @__PURE__ */ new Map();
	const dirents = /* @__PURE__ */ new Map();
	for (let i = 0; i < ents.length; i++) {
		const e = ents[i];
		const lower = e.name.toLowerCase();
		let kind = 2;
		if (!e.isSymbolicLink()) {
			if (e.isFile()) kind = 0;
			else if (e.isDirectory()) kind = 1;
		}
		entries.set(lower, { kind, name: e.name });
		dirents.set(IS_WIN32 ? lower : e.name, e);
	}
	return { status: "ok", realNativeDir, entries, dirents };
}
function joinChildNativeDir(parentRealNative, childName) {
	return parentRealNative.endsWith("\\\\") ? parentRealNative + childName : parentRealNative + "\\\\" + childName;
}
function getVerifiedBootDir(dir) {
	const key = dir.toLowerCase();
	const existing = bootDirCache.get(key);
	if (existing !== void 0) return existing;
	if (ASAR_SEGMENT_RE.test(dir) && !key.includes(".asar.unpacked\\\\") && !key.endsWith(".asar.unpacked")) {
		return FALLBACK_STATE;
	}
	if (isDriveRootWin(dir)) {
		let realRoot;
		try {
			realRoot = _origRealpathNative(dir);
		} catch {
			bootDirCache.set(key, MISSING_STATE);
			return MISSING_STATE;
		}
		const st = buildVerifiedDirState(dir, realRoot);
		bootDirCache.set(key, st);
		return st;
	}
	const lastSlash = dir.lastIndexOf("\\\\");
	const parent = lastSlash === 2 ? dir.slice(0, 3) : dir.slice(0, lastSlash);
	const parentState = bootDirCache.get(parent.toLowerCase());
	if (parentState !== void 0) {
		if (parentState.status === "missing") {
			bootDirCache.set(key, MISSING_STATE);
			return MISSING_STATE;
		}
		if (parentState.status === "fallback") {
			bootDirCache.set(key, FALLBACK_STATE);
			return FALLBACK_STATE;
		}
		const leafLower = dir.slice(lastSlash + 1).toLowerCase();
		const ent = parentState.entries.get(leafLower);
		if (ent === void 0) {
			bootDirCache.set(key, MISSING_STATE);
			return MISSING_STATE;
		}
		if (ent.kind !== 1) {
			bootDirCache.set(key, FALLBACK_STATE);
			return FALLBACK_STATE;
		}
		const st = buildVerifiedDirState(dir, joinChildNativeDir(parentState.realNativeDir, ent.name));
		bootDirCache.set(key, st);
		return st;
	}
	// 向上沿父目录查找已缓存祖先（纯内存查表）
	const pendingChain = [dir];
	let scan = parent;
	let hitState;
	while (scan.length >= 3) {
		const sKey = scan.toLowerCase();
		const st = bootDirCache.get(sKey);
		if (st !== void 0) {
			hitState = st;
			break;
		}
		pendingChain.push(scan);
		if (isDriveRootWin(scan)) break;
		const idx = scan.lastIndexOf("\\\\");
		if (idx < 0) break;
		scan = idx === 2 ? scan.slice(0, 3) : scan.slice(0, idx);
	}
	if (hitState !== void 0) {
		if (hitState.status === "missing") {
			for (let i = 0; i < pendingChain.length; i++) bootDirCache.set(pendingChain[i].toLowerCase(), MISSING_STATE);
			return MISSING_STATE;
		}
		if (hitState.status === "ok") {
			// 自顶向下逐段推进（零额外 realpathNative 调用）
			let curState = hitState;
			for (let i = pendingChain.length - 1; i >= 0; i--) {
				const segDir = pendingChain[i];
				const segKey = segDir.toLowerCase();
				if (curState.status === "missing") {
					bootDirCache.set(segKey, MISSING_STATE);
					continue;
				}
				if (curState.status !== "ok") {
					bootDirCache.set(segKey, FALLBACK_STATE);
					curState = FALLBACK_STATE;
					continue;
				}
				const ls = segDir.lastIndexOf("\\\\");
				const segLeaf = segDir.slice(ls + 1).toLowerCase();
				const ent = curState.entries.get(segLeaf);
				if (ent === void 0) {
					curState = MISSING_STATE;
					bootDirCache.set(segKey, MISSING_STATE);
				} else if (ent.kind !== 1) {
					curState = FALLBACK_STATE;
					bootDirCache.set(segKey, FALLBACK_STATE);
				} else {
					curState = buildVerifiedDirState(segDir, joinChildNativeDir(curState.realNativeDir, ent.name));
					bootDirCache.set(segKey, curState);
				}
			}
			return curState;
		}
		bootDirCache.set(key, FALLBACK_STATE);
		return FALLBACK_STATE;
	}
	// 无已知上游缓存：快速 lstat 检查本目录，不存在时找到存在的祖父，避免大量抛出 Enoent 的 realpathNative 调用
	const lst = lstatSync(dir, { throwIfNoEntry: false });
	if (lst === void 0) {
		let existIdx = -1;
		for (let i = 1; i < pendingChain.length; i++) {
			const cLst = lstatSync(pendingChain[i], { throwIfNoEntry: false });
			if (cLst !== void 0) {
				existIdx = i;
				break;
			}
		}
		if (existIdx >= 0) {
			const anc = pendingChain[existIdx];
			const ancState = getVerifiedBootDir(anc);
			if (ancState.status === "ok") {
				return getVerifiedBootDir(dir);
			}
			bootDirCache.set(key, FALLBACK_STATE);
			return FALLBACK_STATE;
		}
		bootDirCache.set(key, MISSING_STATE);
		return MISSING_STATE;
	}
	if (lst.isSymbolicLink() || !lst.isDirectory()) {
		bootDirCache.set(key, FALLBACK_STATE);
		return FALLBACK_STATE;
	}
	let realNative;
	try {
		realNative = _origRealpathNative(dir);
	} catch {
		bootDirCache.set(key, FALLBACK_STATE);
		return FALLBACK_STATE;
	}
	if (realNative.toLowerCase() !== key) {
		bootDirCache.set(key, FALLBACK_STATE);
		return FALLBACK_STATE;
	}
	const st = buildVerifiedDirState(dir, realNative);
	bootDirCache.set(key, st);
	return st;
}
function fastInternalModuleStat(p) {
	if (typeof p !== "string") return _origInternalModuleStat.call(this, p);
	const norm = stripWinNsPrefix(p);
	if (isAsarImmutablePath(norm)) {
		const hit = asarStatCache.get(norm);
		if (hit !== void 0) return hit;
		const res = _origInternalModuleStat.call(this, p);
		if (asarStatCache.size < 100000) asarStatCache.set(norm, res);
		return res;
	}
	if (bootPhaseActive && isSimpleWinPath(norm)) {
		const pLower = norm.toLowerCase();
		const dirHit = bootDirCache.get(pLower);
		if (dirHit !== void 0) {
			if (dirHit.status === "ok") return 1;
			if (dirHit.status === "missing") return _missingDiskStat;
		}
		const lastSlash = norm.lastIndexOf("\\\\");
		const dir = lastSlash === 2 ? norm.slice(0, 3) : norm.slice(0, lastSlash);
		const dState = getVerifiedBootDir(dir);
		if (dState.status === "ok") {
			const ent = dState.entries.get(norm.slice(lastSlash + 1).toLowerCase());
			if (ent === void 0) return _missingDiskStat;
			if (ent.kind === 0) return 0;
			if (ent.kind === 1) return 1;
		} else if (dState.status === "missing") {
			return _missingDiskStat;
		}
	}
	if (bootPhaseActive) {
		const exactHit = bootExactStatCache.get(norm);
		if (exactHit !== void 0) return exactHit;
		const res = _origInternalModuleStat.call(this, p);
		if (bootExactStatCache.size < 50000) bootExactStatCache.set(norm, res);
		return res;
	}
	return _origInternalModuleStat.call(this, p);
}
function fastRealpathSync(p, options) {
	if (!isDefaultRpUtf8Options(options) || typeof p !== "string") return _origRealpathSync(p, options);
	const hadNs = hasWinNsPrefix(p);
	const norm = hadNs ? p.slice(4) : p;
	if (isAsarImmutablePath(norm)) {
		const hit = asarRealpathCache.get(norm);
		if (hit !== void 0) return hadNs ? WIN_NS_PREFIX + hit : hit;
		let res;
		try {
			res = _origRealpathSync(norm);
		} catch {
			return _origRealpathSync(p, options);
		}
		if (asarRealpathCache.size < 50000) asarRealpathCache.set(norm, res);
		return hadNs ? WIN_NS_PREFIX + res : res;
	}
	if (bootPhaseActive && isSimpleWinPath(norm)) {
		const lastSlash = norm.lastIndexOf("\\\\");
		const dir = lastSlash === 2 ? norm.slice(0, 3) : norm.slice(0, lastSlash);
		const dState = getVerifiedBootDir(dir);
		if (dState.status === "ok") {
			const ent = dState.entries.get(norm.slice(lastSlash + 1).toLowerCase());
			if (ent !== void 0 && ent.kind !== 2) return p;
		}
	}
	return _origRealpathSync(p, options);
}
function fastRealpathNative(p, options) {
	if (!isDefaultRpUtf8Options(options) || typeof p !== "string") return _origRealpathNative(p, options);
	const norm = stripWinNsPrefix(p);
	if (isAsarImmutablePath(norm)) {
		const hit = asarRealpathNativeCache.get(norm);
		if (hit !== void 0) return hit;
		let res;
		try {
			res = _origRealpathNative(norm);
		} catch {
			return _origRealpathNative(p, options);
		}
		if (asarRealpathNativeCache.size < 50000) asarRealpathNativeCache.set(norm, res);
		return res;
	}
	if (bootPhaseActive && isSimpleWinPath(norm)) {
		const lastSlash = norm.lastIndexOf("\\\\");
		const dir = lastSlash === 2 ? norm.slice(0, 3) : norm.slice(0, lastSlash);
		const dState = getVerifiedBootDir(dir);
		if (dState.status === "ok") {
			const ent = dState.entries.get(norm.slice(lastSlash + 1).toLowerCase());
			if (ent !== void 0 && ent.kind !== 2) return joinChildNativeDir(dState.realNativeDir, ent.name);
		}
	}
	return _origRealpathNative(p, options);
}
function onMkdirResult(p, opts, created) {
	if (typeof created === "string") {
		invalidateBootFsPath(created, { recursive: true, kind: "mkdir", mkdirTarget: p });
	} else if (!(opts && typeof opts === "object" && opts.recursive)) {
		invalidateBootFsPath(p, { recursive: true, kind: "mkdir" });
	}
}
function maybeCollectExternalDataFile(fp) {
	if (!slabActive || typeof fp !== "string" || isAsarImmutablePath(fp)) return;
	const dot = fp.lastIndexOf(".");
	if (dot < 0) return;
	const ext = fp.slice(dot).toLowerCase();
	if (!SLAB_SAFE_DATA_EXTS.has(ext)) return;
	const nk = slabNormKey(fp);
	if (slabDirtyPaths.has(nk) || collectedExtMods.has(nk)) return;
	collectedExtData.add(fp);
}
function installBootFsAccel() {
	bootPhaseDepth++;
	if (bootPhaseDepth > 1) return;
	if (isBootFastOptDisabled()) return;
	if (bootAccelInstalled) return;
	try {
		const bfs = process.binding("fs");
		if (typeof bfs?.internalModuleStat !== "function") return;
		_origBindingFs = bfs;
		_origInternalModuleStat = bfs.internalModuleStat;
		_origRealpathSync = fs.realpathSync;
		_origRealpathNative = fs.realpathSync.native;
		_origFsReadFileSync = fs.readFileSync;
		const probeMiss = join(dirname(process.execPath), \`__dsh_step3_miss_\${process.pid}_\${Date.now()}__\`);
		const probeStat = _origInternalModuleStat.call(bfs, probeMiss);
		if (typeof probeStat !== "number" || probeStat >= 0) return;
		_missingDiskStat = probeStat;

		bootPhaseActive = true;
		bootAccelInstalled = true;

		bfs.internalModuleStat = fastInternalModuleStat;
		// 挂载 fastRealpathSync，并复制全部自属性后覆写 .native
		const wrappedRp = function realpathSync(p, options) {
			return fastRealpathSync(p, options);
		};
		for (const k of Object.keys(_origRealpathSync)) wrappedRp[k] = _origRealpathSync[k];
		wrappedRp.native = function realpathSyncNative(p, options) {
			return fastRealpathNative(p, options);
		};
		fs.realpathSync = wrappedRp;

		// 安装 fs / fs.promises 写删改实时失效钩子
		const restorers = [];
		const patchFn = (obj, key, makeWrapper) => {
			const orig = obj[key];
			if (typeof orig !== "function") return;
			obj[key] = makeWrapper(orig);
			restorers.push(() => { obj[key] = orig; });
		};
		const syncMut1 = ["writeFileSync", "appendFileSync", "rmSync", "rmdirSync", "unlinkSync", "truncateSync", "chmodSync", "chownSync", "lchownSync", "utimesSync", "lutimesSync"];
		for (const name of syncMut1) {
			const rec = name === "rmSync";
			const kind = name === "rmSync" ? "rm" : name === "rmdirSync" ? "rmdir" : name === "unlinkSync" ? "unlink" : "write";
			patchFn(fs, name, (orig) => function(p, ...rest) {
				try {
					return orig.call(this, p, ...rest);
				} finally {
					invalidateBootFsPath(p, { recursive: rec, kind });
				}
			});
		}
		patchFn(fs, "mkdirSync", (orig) => function(p, ...rest) {
			const created = orig.call(this, p, ...rest);
			onMkdirResult(p, rest[0], created);
			return created;
		});
		patchFn(fs, "mkdtempSync", (orig) => function(prefix, ...rest) {
			const created = orig.call(this, prefix, ...rest);
			invalidateBootFsPath(typeof created === "string" ? created : prefix, { recursive: true, kind: "mkdir" });
			return created;
		});
		for (const name of ["renameSync", "copyFileSync", "cpSync", "symlinkSync", "linkSync"]) {
			patchFn(fs, name, (orig) => function(src, dest, ...rest) {
				const rec = name === "renameSync" || name === "cpSync";
				const kind = name === "renameSync" ? "rename" : (name === "symlinkSync" || name === "linkSync") ? "symlink" : "write";
				try {
					return orig.call(this, src, dest, ...rest);
				} finally {
					if (name === "renameSync") invalidateBootFsPath(src, { recursive: true, kind: "rename" });
					invalidateBootFsPath(dest, { recursive: rec, kind });
				}
			});
		}
		patchFn(fs, "openSync", (orig) => function(p, flags, ...rest) {
			if (flags !== void 0 && flags !== "r" && flags !== "rs" && flags !== 0) invalidateBootFsPath(p, { recursive: false, kind: "write" });
			return orig.call(this, p, flags, ...rest);
		});
		patchFn(fs, "createWriteStream", (orig) => function(p, ...rest) {
			invalidateBootFsPath(p, { recursive: false, kind: "write" });
			return orig.call(this, p, ...rest);
		});
		const asyncMut1 = ["writeFile", "appendFile", "rm", "rmdir", "unlink", "truncate", "chmod", "chown", "utimes"];
		for (const name of asyncMut1) {
			const rec = name === "rm";
			const kind = name === "rm" ? "rm" : name === "rmdir" ? "rmdir" : name === "unlink" ? "unlink" : "write";
			patchFn(fs, name, (orig) => function(p, ...rest) {
				invalidateBootFsPath(p, { recursive: rec, kind });
				const cb = rest[rest.length - 1];
				if (typeof cb === "function") {
					rest[rest.length - 1] = function(...args) {
						invalidateBootFsPath(p, { recursive: rec, kind });
						return cb.apply(this, args);
					};
				}
				return orig.call(this, p, ...rest);
			});
		}
		patchFn(fs, "mkdir", (orig) => function(p, ...rest) {
			const cbIdx = rest.length - 1;
			const cb = rest[cbIdx];
			const opts = typeof rest[0] === "function" ? void 0 : rest[0];
			if (typeof cb === "function") {
				rest[cbIdx] = function(err, created) {
					if (!err) onMkdirResult(p, opts, created);
					return cb.apply(this, arguments);
				};
			} else {
				invalidateBootFsPath(p, { recursive: true, kind: "mkdir" });
			}
			return orig.call(this, p, ...rest);
		});
		for (const name of ["rename", "copyFile", "cp", "symlink", "link"]) {
			patchFn(fs, name, (orig) => function(src, dest, ...rest) {
				const rec = name === "rename" || name === "cp";
				const kind = name === "rename" ? "rename" : (name === "symlink" || name === "link") ? "symlink" : "write";
				if (name === "rename") invalidateBootFsPath(src, { recursive: true, kind: "rename" });
				invalidateBootFsPath(dest, { recursive: rec, kind });
				const cb = rest[rest.length - 1];
				if (typeof cb === "function") {
					rest[rest.length - 1] = function(...args) {
						if (name === "rename") invalidateBootFsPath(src, { recursive: true, kind: "rename" });
						invalidateBootFsPath(dest, { recursive: rec, kind });
						return cb.apply(this, args);
					};
				}
				return orig.call(this, src, dest, ...rest);
			});
		}
		patchFn(fs, "mkdtemp", (orig) => function(prefix, ...rest) {
			invalidateBootFsPath(dirname(String(prefix)), { recursive: false, kind: "mkdir" });
			const cb = rest[rest.length - 1];
			if (typeof cb === "function") {
				rest[rest.length - 1] = function(err, folder) {
					invalidateBootFsPath(folder ?? dirname(String(prefix)), { recursive: true, kind: "mkdir" });
					return cb.apply(this, arguments);
				};
			}
			return orig.call(this, prefix, ...rest);
		});
		patchFn(fs, "open", (orig) => function(p, flags, ...rest) {
			if (typeof flags === "function") return orig.call(this, p, flags, ...rest);
			if (flags !== void 0 && flags !== "r" && flags !== "rs" && flags !== 0) invalidateBootFsPath(p, { recursive: false, kind: "write" });
			return orig.call(this, p, flags, ...rest);
		});
		if (fs.promises) {
			for (const name of asyncMut1) {
				const rec = name === "rm";
				const kind = name === "rm" ? "rm" : name === "rmdir" ? "rmdir" : name === "unlink" ? "unlink" : "write";
				patchFn(fs.promises, name, (orig) => function(p, ...rest) {
					invalidateBootFsPath(p, { recursive: rec, kind });
					const pr = orig.call(this, p, ...rest);
					return Promise.resolve(pr).finally(() => invalidateBootFsPath(p, { recursive: rec, kind }));
				});
			}
			patchFn(fs.promises, "mkdir", (orig) => function(p, ...rest) {
				return Promise.resolve(orig.call(this, p, ...rest)).then((created) => {
					onMkdirResult(p, rest[0], created);
					return created;
				});
			});
			for (const name of ["rename", "copyFile", "cp", "symlink", "link"]) {
				patchFn(fs.promises, name, (orig) => function(src, dest, ...rest) {
					const rec = name === "rename" || name === "cp";
					const kind = name === "rename" ? "rename" : (name === "symlink" || name === "link") ? "symlink" : "write";
					if (name === "rename") invalidateBootFsPath(src, { recursive: true, kind: "rename" });
					invalidateBootFsPath(dest, { recursive: rec, kind });
					const pr = orig.call(this, src, dest, ...rest);
					return Promise.resolve(pr).finally(() => {
						if (name === "rename") invalidateBootFsPath(src, { recursive: true, kind: "rename" });
						invalidateBootFsPath(dest, { recursive: rec, kind });
					});
				});
			}
			patchFn(fs.promises, "mkdtemp", (orig) => function(prefix, ...rest) {
				invalidateBootFsPath(dirname(String(prefix)), { recursive: false, kind: "mkdir" });
				return Promise.resolve(orig.call(this, prefix, ...rest)).then((res) => {
					invalidateBootFsPath(res, { recursive: true, kind: "mkdir" });
					return res;
				});
			});
			patchFn(fs.promises, "open", (orig) => function(p, flags, ...rest) {
				if (flags !== void 0 && flags !== "r" && flags !== "rs" && flags !== 0) invalidateBootFsPath(p, { recursive: false, kind: "write" });
				return orig.call(this, p, flags, ...rest);
			});
		}
		// [Step 4] 启动期外盘 Slab 源码/元信息拦截及安全静态数据路径采集
		patchFn(fs, "readFileSync", (orig) => function (p, opts) {
			if (slabActive) {
				const fp = slabToWinPath(p);
				if (fp && !isAsarImmutablePath(fp)) {
					const nk = slabNormKey(fp);
					if (slabExtReady && !slabDirtyPaths.has(nk) && isSimpleReadOpts(opts)) {
						const hit = extByPath.get(nk);
						if (hit && hit.srcSlice) {
							bootSlabMetrics.extSrcHit++;
							const enc = getEncodingString(opts);
							return enc ? hit.srcSlice.toString("utf8") : Buffer.from(hit.srcSlice);
						}
					}
					const res = opts === void 0 ? orig.call(this, p) : orig.call(this, p, opts);
					if (res !== void 0 && (res.length ?? res.byteLength ?? 0) <= SLAB_MAX_DATA_BYTES) {
						maybeCollectExternalDataFile(fp);
					}
					return res;
				}
			}
			return opts === void 0 ? orig.call(this, p) : orig.call(this, p, opts);
		});
		if (fs.promises) {
			patchFn(fs.promises, "readFile", (orig) => function (p, opts) {
				if (slabActive) {
					const fp = slabToWinPath(p);
					if (fp && !isAsarImmutablePath(fp)) {
						const nk = slabNormKey(fp);
						if (slabExtReady && !slabDirtyPaths.has(nk) && isSimpleReadOpts(opts)) {
							const hit = extByPath.get(nk);
							if (hit && hit.srcSlice) {
								bootSlabMetrics.extSrcHit++;
								const enc = getEncodingString(opts);
								return Promise.resolve(enc ? hit.srcSlice.toString("utf8") : Buffer.from(hit.srcSlice));
							}
						}
						return orig.call(this, p, opts).then((res) => {
							if (res !== void 0 && (res.length ?? res.byteLength ?? 0) <= SLAB_MAX_DATA_BYTES) {
								maybeCollectExternalDataFile(fp);
							}
							return res;
						});
					}
				}
				return orig.call(this, p, opts);
			});
		}
		_bootFsRestorers = restorers;
		try { syncBuiltinESMExports(); } catch {}
	} catch {
		bootPhaseActive = false;
	}
}
function endBootFsPhase() {
	if (bootPhaseDepth > 0) bootPhaseDepth--;
	if (bootPhaseDepth > 0) return;
	bootPhaseActive = false;
	finishBootSlab();
	clearAllBootVolatileCaches();
	if (!bootAccelInstalled) return;
	bootAccelInstalled = false;
	try {
		if (_origBindingFs && _origInternalModuleStat) _origBindingFs.internalModuleStat = _origInternalModuleStat;
		if (_origRealpathSync) fs.realpathSync = _origRealpathSync;
		for (let i = _bootFsRestorers.length - 1; i >= 0; i--) {
			try { _bootFsRestorers[i](); } catch {}
		}
		_bootFsRestorers = [];
		try { syncBuiltinESMExports(); } catch {}
	} catch {}
}
globalThis[BOOT_FS_PHASE_SYMBOL] = { enter: installBootFsAccel, exit: endBootFsPhase };

function clearResolutionCaches() {
	profileDirSnapshotCache.clear();
	cjsAsarResolvedCache.clear();
	clearSharedResVolatileMaps();
}
function canonicalPath(path) {
	const useCache = canUseMutablePathCache(path);
	let cached = useCache ? canonicalCache.get(path) : void 0;
	if (cached !== void 0) return cached;
	try {
		cached = realpathSync(path);
	} catch {
		cached = resolve(path);
	}
	if (useCache) canonicalCache.set(path, cached);
	return cached;
}
function prefixes(path) {
	const useCache = canUseMutablePathCache(path);
	let cached = useCache ? prefixesCache.get(path) : void 0;
	if (cached !== void 0) return cached;
	const configured = resolve(path) + sep;
	const canonical = canonicalPath(path) + sep;
	cached = canonical === configured ? [configured] : [configured, canonical];
	if (useCache) prefixesCache.set(path, cached);
	return cached;
}
function getDirEntries(dir) {
	recordResWatcherDir(dir);
	const normDir = IS_WIN32 && typeof dir === "string" ? stripWinNsPrefix(dir) : dir;
	const normKey = IS_WIN32 && typeof normDir === "string" ? normDir.toLowerCase() : normDir;
	const useCache = canUseMutablePathCache(normDir);
	let cached = useCache ? dirEntriesCache.get(normKey) : void 0;
	if (cached !== void 0) return cached;
	if (bootPhaseActive && typeof normDir === "string" && !isAsarImmutablePath(normDir) && (isSimpleWinPath(normDir) || isDriveRootWin(normDir))) {
		const dState = getVerifiedBootDir(normDir);
		if (dState.status === "ok") {
			dirEntriesCache.set(normKey, dState.dirents);
			return dState.dirents;
		}
		if (dState.status === "missing") {
			dirEntriesCache.set(normKey, null);
			return null;
		}
	}
	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		const map = /* @__PURE__ */ new Map();
		for (let i = 0; i < entries.length; i++) {
			const e = entries[i];
			map.set(IS_WIN32 ? e.name.toLowerCase() : e.name, e);
		}
		cached = map;
	} catch {
		cached = null;
	}
	if (useCache) dirEntriesCache.set(normKey, cached);
	return cached;
}
function compileResolution(resolution) {
	return {
		entries: new Map(resolution.entries.map((entry) => [entry.name, {
			...entry,
			realDir: canonicalPath(entry.packageDir)
		}])),
		profilesDir: resolution.profilesDir,
		profileDir: resolution.profileDir,
		profilePaths: prefixes(resolution.profilesDir),
		profile: resolution.profileDir === void 0 ? [] : prefixes(resolution.profileDir),
		installationPaths: [...new Set(resolution.entries.filter((entry) => entry.scope === "installation").flatMap((entry) => prefixes(entry.packageDir)))],
		linkedPaths: resolution.linkedRoots.flatMap((root) => prefixes(root.realPath)),
		localPackageNames: new Set(resolution.localPackageNames),
		esmRoutes: /* @__PURE__ */ new Map(),
		dirEsmRoutes: /* @__PURE__ */ new Map(),
		cjsRoutes: /* @__PURE__ */ new Map(),
		dirCjsRoutes: /* @__PURE__ */ new Map(),
		dirSearchPaths: /* @__PURE__ */ new Map()
	};
}`,
    "dsh-app-boot caches, Boot Slab Engine & Boot-Phase FS Accelerator"
  );

  code = replaceOnce(
    code,
`function readPeerNames(directory) {
	try {
		const peers = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).peerDependencies;
		return new Set(peers !== null && typeof peers === "object" ? Object.keys(peers) : []);
	} catch (_error) {
		return /* @__PURE__ */ new Set();
	}
}`,
`function readPeerNames(directory) {
	const useCache = canUseMutablePathCache(directory);
	let cached = useCache ? peerNamesCache.get(directory) : void 0;
	if (cached !== void 0) return cached;
	try {
		const manifest = readPackageManifest(join(directory, "package.json"));
		const peers = manifest.peerDependencies;
		cached = new Set(peers !== null && typeof peers === "object" ? Object.keys(peers) : []);
	} catch (_error) {
		cached = /* @__PURE__ */ new Set();
	}
	if (useCache) peerNamesCache.set(directory, cached);
	return cached;
}`,
    "dsh-app-boot readPeerNames"
  );

  code = replaceOnce(
    code,
`function localPackageCandidate(searchPath, name, flavor) {
	const candidate = join(searchPath, name);
	const stat = statSync(candidate, { throwIfNoEntry: false });
	return (flavor === "esm" ? stat?.isDirectory() === true : stat !== void 0 || [
		".js",
		".json",
		".node"
	].some((extension) => existsSync(candidate + extension))) ? candidate : void 0;
}
function selfReferenceName(parent) {
	let current = dirname(parent);
	while (true) {
		const manifestPath = join(current, "package.json");
		if (existsSync(manifestPath)) {
			let manifest;
			try {
				manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
			} catch (_error) {
				return null;
			}
			return typeof manifest.name === "string" && manifest.exports != null ? manifest.name : false;
		}
		/* v8 ignore next -- scoped module requests normally find an owning manifest before node_modules. */
		if (basename(current) === "node_modules") return false;
		const next = dirname(current);
		if (next === current) return false;
		current = next;
	}
}`,
`function localPackageCandidate(searchPath, name, flavor) {
	const entries = getDirEntries(searchPath);
	if (entries === null) return void 0;
	const slash = name.indexOf("/");
	let leafDirEntries = entries;
	let leafName = name;
	if (slash >= 0) {
		const scope = name.slice(0, slash);
		if (!entries.has(IS_WIN32 ? scope.toLowerCase() : scope)) return void 0;
		leafDirEntries = getDirEntries(join(searchPath, scope));
		if (leafDirEntries === null) return void 0;
		leafName = name.slice(slash + 1);
	}
	const key = IS_WIN32 ? leafName.toLowerCase() : leafName;
	const dirent = leafDirEntries.get(key);
	const candidate = join(searchPath, name);
	if (flavor === "esm") {
		if (dirent === void 0) return void 0;
		if (dirent.isDirectory()) return candidate;
		if (dirent.isSymbolicLink()) return statSync(candidate, { throwIfNoEntry: false })?.isDirectory() === true ? candidate : void 0;
		return void 0;
	}
	if (dirent !== void 0) {
		if (!dirent.isSymbolicLink()) return candidate;
		if (statSync(candidate, { throwIfNoEntry: false }) !== void 0) return candidate;
	}
	for (const extension of [".js", ".json", ".node"]) {
		const extKey = IS_WIN32 ? (leafName + extension).toLowerCase() : leafName + extension;
		const extEnt = leafDirEntries.get(extKey);
		if (extEnt !== void 0 && (!extEnt.isSymbolicLink() || existsSync(candidate + extension))) return candidate;
	}
	return void 0;
}
function selfReferenceNameFromDir(startDir) {
	const useStartCache = canUseMutablePathCache(startDir);
	if (useStartCache) {
		const cached = selfRefDirCache.get(startDir);
		if (cached !== void 0) return cached;
	}
	const visited = [];
	let canWriteVisited = useStartCache;
	let current = startDir;
	let result = false;
	while (true) {
		const useCurrCache = canUseMutablePathCache(current);
		if (useCurrCache) {
			const existing = selfRefDirCache.get(current);
			if (existing !== void 0) {
				result = existing;
				break;
			}
		} else {
			canWriteVisited = false;
			visited.length = 0;
		}
		if (canWriteVisited) visited.push(current);
		const dirEntries = getDirEntries(current);
		const pkgEnt = dirEntries?.get("package.json");
		const hasPkgJson = pkgEnt !== void 0 && (!pkgEnt.isSymbolicLink() || existsSync(join(current, "package.json")));
		if (hasPkgJson) {
			const manifestPath = join(current, "package.json");
			try {
				const manifest = readPackageManifest(manifestPath);
				result = typeof manifest.name === "string" && manifest.exports != null ? manifest.name : false;
			} catch (_error) {
				result = null;
			}
			break;
		}
		if (basename(current) === "node_modules") {
			result = false;
			break;
		}
		const next = dirname(current);
		if (next === current) {
			result = false;
			break;
		}
		current = next;
	}
	if (canWriteVisited) {
		for (let i = 0; i < visited.length; i++) selfRefDirCache.set(visited[i], result);
	}
	return result;
}
function selfReferenceName(parent) {
	return selfReferenceNameFromDir(dirname(parent));
}`,
    "dsh-app-boot localPackageCandidate & selfReferenceName"
  );

  code = replaceOnce(
    code,
`function localCandidateOwnsResolution(candidate, resolved, request, name) {
	if (startsWithin(resolved, prefixes(candidate))) return true;`,
`function localCandidateOwnsResolution(candidate, resolved, request, name) {
	if (resolved.startsWith(resolve(candidate) + sep)) return true;
	if (resolved === candidate || resolved === candidate + ".js" || resolved === candidate + ".json" || resolved === candidate + ".node") return true;
	if (startsWithin(resolved, prefixes(candidate))) return true;`,
    "dsh-app-boot localCandidateOwnsResolution fast string"
  );

  code = replaceOnce(
    code,
`		this.moved.forget(current);
		this.current = next;`,
`		this.moved.forget(current);
		clearResolutionCaches();
		this.current = next;`,
    "dsh-app-boot replace clear caches"
  );

  code = replaceOnce(
    code,
`	getOrCreateParentRoutesForUrl(parentURL) {
		const resolution = this.current;
		let parentRoutes = resolution.esmRoutes.get(parentURL);
		if (parentRoutes !== void 0) return parentRoutes;
		let parent;
		try {
			parent = fileURLToPath(parentURL);
		} catch {
			parent = void 0;
		}
		parentRoutes = parent === void 0 ? false : this.createParentRoutes(parent, resolution) ?? false;
		resolution.esmRoutes.set(parentURL, parentRoutes);
		return parentRoutes;
	}`,
`	getOrCreateParentRoutesForUrl(parentURL) {
		const resolution = this.current;
		let parentRoutes = resolution.esmRoutes.get(parentURL);
		if (parentRoutes !== void 0) return parentRoutes;
		let parent;
		try {
			parent = fileURLToPath(parentURL);
		} catch {
			parent = void 0;
		}
		if (parent === void 0 || parentURL.includes("?") || parentURL.includes("#")) {
			parentRoutes = parent === void 0 ? false : this.createParentRoutes(parent, resolution) ?? false;
			resolution.esmRoutes.set(parentURL, parentRoutes);
			return parentRoutes;
		}
		const dir = dirname(parent);
		let dirRoutes = resolution.dirEsmRoutes.get(dir);
		if (dirRoutes === void 0) {
			const layer = findInterceptionLayer(parent, resolution);
			if (layer === void 0) {
				dirRoutes = false;
				resolution.dirEsmRoutes.set(dir, false);
			} else if (layer.kind === "profile") {
				dirRoutes = {
					parent,
					dir,
					layer,
					requests: /* @__PURE__ */ new Map()
				};
				resolution.dirEsmRoutes.set(dir, dirRoutes);
			} else {
				dirRoutes = {
					parent,
					layer,
					requests: /* @__PURE__ */ new Map()
				};
			}
		} else if (dirRoutes !== false && dirRoutes.layer.kind !== "profile") {
			dirRoutes = {
				parent,
				layer: dirRoutes.layer,
				requests: /* @__PURE__ */ new Map()
			};
		}
		resolution.esmRoutes.set(parentURL, dirRoutes);
		return dirRoutes;
	}`,
    "dsh-app-boot getOrCreateParentRoutesForUrl shared dirEsmRoutes"
  );

  code = replaceOnce(
    code,
`	routeScoped(request, parentRoutes, resolution, flavor, cjs) {
		const { parent, layer, requests } = parentRoutes;
		const memo = layer.kind === "profile" && (cjs === void 0 || cjs.cacheable);
		const name = barePackageName(request);
		if (name === void 0) return void 0;
		if (parentRoutes.selfReferenceName === void 0 || !memo) parentRoutes.selfReferenceName = selfReferenceName(parent);
		if (parentRoutes.selfReferenceName === name || parentRoutes.selfReferenceName === null) {
			const state = { route: { kind: "native" } };
			if (memo) requests.set(request, state);
			return state;
		}
		if (layer.kind === "linked") return this.routeLinked(request, name, parent, resolution, flavor, cjs);
		const target = resolution.entries.get(name);
		const candidates = [];
		const localSearchPaths = [];
		for (const searchPath of createRequire(parent).resolve.paths(name)) {
			if (!searchPath.startsWith(layer.localPrefix)) break;
			localSearchPaths.push(searchPath);
			const candidate = localPackageCandidate(searchPath, name, flavor);
			if (candidate !== void 0) candidates.push(candidate);
		}`,
`	routeScoped(request, parentRoutes, resolution, flavor, cjs, callerParent = parentRoutes.parent) {
		const { layer, requests } = parentRoutes;
		const memo = layer.kind === "profile" && (cjs === void 0 || cjs.cacheable);
		const name = barePackageName(request);
		if (name === void 0) return void 0;
		if (parentRoutes.selfReferenceName === void 0 || !memo) parentRoutes.selfReferenceName = selfReferenceNameFromDir(parentRoutes.dir ?? dirname(callerParent));
		if (parentRoutes.selfReferenceName === name || parentRoutes.selfReferenceName === null) {
			const state = { route: { kind: "native" } };
			if (memo) requests.set(request, state);
			return state;
		}
		if (layer.kind === "linked") return this.routeLinked(request, name, callerParent, resolution, flavor, cjs);
		const target = resolution.entries.get(name);
		const parentDir = parentRoutes.dir ?? dirname(callerParent);
		let localSearchPaths = parentRoutes.localSearchPaths;
		if (localSearchPaths === void 0) {
			localSearchPaths = resolution.dirSearchPaths.get(parentDir);
			if (localSearchPaths === void 0) {
				const allPaths = this.nodeModulePaths(parentDir);
				localSearchPaths = [];
				for (let i = 0; i < allPaths.length; i++) {
					const sp = allPaths[i];
					if (!sp.startsWith(layer.localPrefix)) break;
					localSearchPaths.push(sp);
				}
				resolution.dirSearchPaths.set(parentDir, localSearchPaths);
			}
			if (memo) parentRoutes.localSearchPaths = localSearchPaths;
		}
		const candidates = [];
		for (let i = 0; i < localSearchPaths.length; i++) {
			const candidate = localPackageCandidate(localSearchPaths[i], name, flavor);
			if (candidate !== void 0) candidates.push(candidate);
		}`,
    "dsh-app-boot routeScoped searchPaths"
  );

  code = replaceOnce(
    code,
`	routePath(request, parent, cjs) {
		const resolution = this.current;
		let parentRoutes = resolution.cjsRoutes.get(parent);
		if (parentRoutes === false) return void 0;
		const cached = cjs.cacheable ? parentRoutes?.requests.get(request) : void 0;
		if (cached !== void 0) return cached;
		if (parentRoutes === void 0) {
			parentRoutes = this.createParentRoutes(parent, resolution) ?? false;
			resolution.cjsRoutes.set(parent, parentRoutes);
			if (parentRoutes === false) return void 0;
		}
		return this.routeScoped(request, parentRoutes, resolution, "cjs", cjs);
	}`,
`	routePath(request, parent, cjs) {
		const resolution = this.current;
		const dir = dirname(parent);
		let parentRoutes = resolution.dirCjsRoutes.get(dir);
		if (parentRoutes === false) return void 0;
		const cached = cjs.cacheable ? parentRoutes?.requests.get(request) : void 0;
		if (cached !== void 0) return cached;
		if (parentRoutes === void 0) {
			const layer = findInterceptionLayer(parent, resolution);
			parentRoutes = layer === void 0 ? false : {
				parent,
				dir,
				layer,
				requests: /* @__PURE__ */ new Map()
			};
			resolution.dirCjsRoutes.set(dir, parentRoutes);
			if (parentRoutes === false) return void 0;
		}
		return this.routeScoped(request, parentRoutes, resolution, "cjs", cjs, parent);
	}`,
    "dsh-app-boot routePath shared dir"
  );

  code = replaceOnce(
    code,
`function internalModules() {
	const addon = createRequire(import.meta.url)("node-addon-require-builtin");
	const esmModule = addon.requireBuiltin("internal/modules/esm/loader");
	const cjsModule = addon.requireBuiltin("internal/modules/cjs/loader");
	const cjsHelpers = addon.requireBuiltin("internal/modules/helpers");
	const esmUtils = addon.requireBuiltin("internal/modules/esm/utils");
	const esmResolve = addon.requireBuiltin("internal/modules/esm/resolve");`,
`function internalModules() {
	const req = createRequire(import.meta.url);
	let requireBuiltin;
	try {
		req("internal/modules/helpers");
		requireBuiltin = (id) => req(id);
	} catch {
		const addon = req("node-addon-require-builtin");
		requireBuiltin = (id) => addon.requireBuiltin(id);
	}
	const esmModule = requireBuiltin("internal/modules/esm/loader");
	const cjsModule = requireBuiltin("internal/modules/cjs/loader");
	const cjsHelpers = requireBuiltin("internal/modules/helpers");
	const esmUtils = requireBuiltin("internal/modules/esm/utils");
	const esmResolve = requireBuiltin("internal/modules/esm/resolve");`,
    "dsh-app-boot internalModules"
  );

  code = replaceOnce(
    code,
`		const adapted = (request, parent, attributes) => {
			const delegated = delegatedEsm;
			/* v8 ignore next -- reentry requires a separate synchronous Node hook; supported launches install none */
			if (delegated !== void 0 && delegated.parent === parent && delegated.request === request) return native(request, parent, attributes);
			if (parent === void 0 || !router.hasInterceptionLayerForUrl(parent)) return native(request, parent, attributes);
			const state = router.routeUrl(request, parent);
			if (state === void 0) {
				const target = request[0] === "#" ? packageImportsTarget(fileURLToPath(parent), request, esmConditions) : void 0;
				if (target === void 0) return native(request, parent, attributes);
				const restoreImporter = (error) => throwWithImporter(error, target.parentURL, parent);
				let expected;
				try {
					expected = adapted(target.specifier, target.parentURL, attributes);
					/* v8 ignore next -- the current loader resolves synchronously; the private interface also permits Promise results */
					if (expected instanceof Promise) expected = expected.catch(restoreImporter);
				} catch (error) {
					return restoreImporter(error);
				}
				return expected;
			}
			const cacheable = attributes === EMPTY_ATTRIBUTES || Object.keys(attributes).length === 0;
			if (cacheable && state.esm !== void 0) return state.esm;
			const route = state.route;
			if (route.kind === "native") {
				const result = native(request, parent, attributes);
				if (cacheable && !(result instanceof Promise)) state.esm = result;
				return result;
			}
			const routedParent = pathToFileURL(route.kind === "interception" ? route.entry.declarer : route.parent).href;
			const previous = delegatedEsm;
			delegatedEsm = {
				parent: routedParent,
				request
			};
			const restoreImporter = (error) => throwWithImporter(error, routedParent, parent);
			try {
				let result;
				try {
					result = native(request, routedParent, attributes);
				} catch (error) {
					return restoreImporter(error);
				}
				/* v8 ignore next -- the current loader resolves synchronously; the private interface also permits Promise results */
				if (result instanceof Promise) return result.catch(restoreImporter);
				if (cacheable) state.esm = result;
				return result;
			} finally {
				delegatedEsm = previous;
			}
		};
		const relocate = (result, parent) => {
			if (!result.url.startsWith("file:")) return result;
			const url = new URL(result.url);
			const filename = fileURLToPath(url);
			const relocated = router.relocate(filename, parent?.startsWith("file:") === true ? fileURLToPath(parent) : void 0);
			if (relocated === filename) return result;
			url.pathname = pathToFileURL(relocated).pathname;
			return {
				...result,
				url: url.href
			};
		};
		return (request, parent, attributes) => {
			const result = adapted(request, parent, attributes);
			/* v8 ignore next -- the current loader resolves synchronously; the private interface also permits Promise results */
			return result instanceof Promise ? result.then((resolved) => relocate(resolved, parent)) : relocate(result, parent);
		};`,
`		const adapted = (request, parent, attributes) => {
			if (parent === void 0) return native(request, parent, attributes);
			const delegated = delegatedEsm;
			/* v8 ignore next -- reentry requires a separate synchronous Node hook; supported launches install none */
			if (delegated !== void 0 && delegated.parent === parent && delegated.request === request) return native(request, parent, attributes);
			const cacheableNoQuery = typeof request === "string" && !parent.includes("?") && !parent.includes("#") && !request.includes("?") && !request.includes("#") && !request.includes("libreoffice-kit-") && (attributes === EMPTY_ATTRIBUTES || Object.keys(attributes).length === 0);
			const resolveCachedByDir = (cacheMap, countAsBootRel) => {
				const dirSlash = parent.lastIndexOf("/");
				if (dirSlash <= 0) return native(request, parent, attributes);
				const esmKey = parent.slice(0, dirSlash + 1) + "\\0" + request;
				const cachedEsm = cacheMap.get(esmKey);
				if (cachedEsm !== void 0) {
					if (countAsBootRel) bootSlabMetrics.esmRelDirHit++;
					return cachedEsm;
				}
				const res = native(request, parent, attributes);
				if (!(res instanceof Promise) && res?.url && !res.url.includes("libreoffice-kit-") && cacheMap.size < 20000) {
					cacheMap.set(esmKey, res);
				}
				return res;
			};
			const noLayer = !router.hasInterceptionLayerForUrl(parent);
			if (noLayer) {
				if (cacheableNoQuery && isAsarImmutablePath(parent)) return resolveCachedByDir(asarEsmDirCache, false);
				if (cacheableNoQuery && bootPhaseActive && (request.startsWith("./") || request.startsWith("../"))) return resolveCachedByDir(bootEsmRelDirCache, true);
				return native(request, parent, attributes);
			}
			if (request.charCodeAt(0) !== 35 && barePackageName(request) === void 0) {
				if (cacheableNoQuery && bootPhaseActive && (request.startsWith("./") || request.startsWith("../"))) return resolveCachedByDir(bootEsmRelDirCache, true);
				return native(request, parent, attributes);
			}
			const state = router.routeUrl(request, parent);
			if (state === void 0) {
				const target = request[0] === "#" ? packageImportsTarget(fileURLToPath(parent), request, esmConditions) : void 0;
				if (target === void 0) return native(request, parent, attributes);
				const restoreImporter = (error) => throwWithImporter(error, target.parentURL, parent);
				let expected;
				try {
					expected = adapted(target.specifier, target.parentURL, attributes);
					/* v8 ignore next -- the current loader resolves synchronously; the private interface also permits Promise results */
					if (expected instanceof Promise) expected = expected.catch(restoreImporter);
				} catch (error) {
					return restoreImporter(error);
				}
				return expected;
			}
			const cacheable = attributes === EMPTY_ATTRIBUTES || Object.keys(attributes).length === 0;
			if (cacheable && state.esm !== void 0) return state.esm;
			const route = state.route;
			if (route.kind === "native") {
				const result = native(request, parent, attributes);
				if (cacheable && !(result instanceof Promise)) state.esm = result;
				return result;
			}
			const routedParent = pathToFileURL(route.kind === "interception" ? route.entry.declarer : route.parent).href;
			const previous = delegatedEsm;
			delegatedEsm = {
				parent: routedParent,
				request
			};
			const restoreImporter = (error) => throwWithImporter(error, routedParent, parent);
			try {
				let result;
				try {
					result = native(request, routedParent, attributes);
				} catch (error) {
					return restoreImporter(error);
				}
				/* v8 ignore next -- the current loader resolves synchronously; the private interface also permits Promise results */
				if (result instanceof Promise) return result.catch(restoreImporter);
				if (cacheable) state.esm = result;
				return result;
			} finally {
				delegatedEsm = previous;
			}
		};
		const relocate = (result, parent, request) => {
			const redirector = globalThis[OFFICE_REDIRECT_SYMBOL];
			if (router.moved.targets.size === 0 && redirector === void 0) return result;
			if (!result.url.startsWith("file:")) return result;
			let out = result;
			if (redirector !== void 0 && (out.url.includes("libreoffice-kit-") || request.startsWith("@deepseek-ai/libreoffice-kit-"))) {
				out = redirector.redirectUrl(out, request);
			}
			if (router.moved.targets.size === 0) return out;
			const url = new URL(out.url);
			const filename = fileURLToPath(url);
			const relocated = router.relocate(filename, parent?.startsWith("file:") === true ? fileURLToPath(parent) : void 0);
			if (relocated === filename) return out;
			url.pathname = pathToFileURL(relocated).pathname;
			return {
				...out,
				url: url.href
			};
		};
		return (request, parent, attributes) => {
			const result = adapted(request, parent, attributes);
			/* v8 ignore next -- the current loader resolves synchronously; the private interface also permits Promise results */
			return result instanceof Promise ? result.then((resolved) => relocate(resolved, parent, request)) : relocate(result, parent, request);
		};`,
    "dsh-app-boot adaptEsm unified dir cache & office redirect"
  );

  code = replaceOnce(
    code,
`	const wrappedFilename = (request, parent, main, options) => {
		if (delegatedCjs || !parent?.filename || options?.paths !== void 0) return originalFilename.call(cjs, request, parent, main, options);
		const parentFilename = parent.filename;
		const cacheable = options?.conditions === void 0;
		const routedOptions = options?.conditions === void 0 ? void 0 : { conditions: options.conditions };
		const state = router.routePath(request, parentFilename, {
			cacheable,
			resolveNative: (searchPaths) => resolveNativeCjs(request, searchPaths, parent, parentFilename, main, options?.conditions),
			resolveEntry: (entry, after) => {
				delegatedCjs++;
				try {
					return resolveRoutedCjs(request, {
						kind: "interception",
						entry,
						after
					}, parent, main, routedOptions);
				} finally {
					delegatedCjs--;
				}
			}
		});
		if (state === void 0) {
			const scoped = router.hasInterceptionLayerForPath(parentFilename);
			const conditions = options?.conditions ?? cjsConditions;
			const target = request[0] === "#" && scoped ? packageImportsTarget(parentFilename, request, conditions) : void 0;
			if (target === void 0) return originalFilename.call(cjs, request, parent, main, options);
			return resolvePackageImportCjs(target, conditions);
		}
		if (state.cjs !== void 0) return state.cjs;
		const route = state.route;
		if (route.kind === "native") {
			const result = originalFilename.call(cjs, request, parent, main, options);
			if (cacheable) state.cjs = result;
			return result;
		}
		delegatedCjs++;
		try {
			let expected;
			try {
				expected = resolveRoutedCjs(request, route, parent, main, routedOptions);
			} catch (error) {
				if (route.kind !== "interception" || !isUnselectedPackageMiss(error)) throw error;
				expected = resolveRoutedCjs(request, {
					kind: "native-after-interception",
					parent: route.after
				}, parent, main, routedOptions);
			}
			if (cacheable) state.cjs = expected;
			return expected;
		} finally {
			delegatedCjs--;
		}
	};
	const relocatedFilename = (request, parent, main, options) => {
		const filename = wrappedFilename(request, parent, main, options);
		return isAbsolute(filename) ? router.relocate(filename, parent?.filename ?? void 0) : filename;
	};`,
`	const wrappedFilename = (request, parent, main, options) => {
		if (delegatedCjs || !parent?.filename || options?.paths !== void 0) return originalFilename.call(cjs, request, parent, main, options);
		if (request.charCodeAt(0) !== 35 && barePackageName(request) === void 0) return originalFilename.call(cjs, request, parent, main, options);
		const parentFilename = parent.filename;
		const cacheable = options?.conditions === void 0;
		const routedOptions = options?.conditions === void 0 ? void 0 : { conditions: options.conditions };
		const state = router.routePath(request, parentFilename, {
			cacheable,
			resolveNative: (searchPaths) => resolveNativeCjs(request, searchPaths, parent, parentFilename, main, options?.conditions),
			resolveEntry: (entry, after) => {
				delegatedCjs++;
				try {
					return resolveRoutedCjs(request, {
						kind: "interception",
						entry,
						after
					}, parent, main, routedOptions);
				} finally {
					delegatedCjs--;
				}
			}
		});
		if (state === void 0) {
			const scoped = router.hasInterceptionLayerForPath(parentFilename);
			const conditions = options?.conditions ?? cjsConditions;
			const target = request[0] === "#" && scoped ? packageImportsTarget(parentFilename, request, conditions) : void 0;
			if (target === void 0) return originalFilename.call(cjs, request, parent, main, options);
			return resolvePackageImportCjs(target, conditions);
		}
		if (state.cjs !== void 0) return state.cjs;
		const route = state.route;
		if (route.kind === "native") {
			const result = originalFilename.call(cjs, request, parent, main, options);
			if (cacheable) state.cjs = result;
			return result;
		}
		delegatedCjs++;
		try {
			let expected;
			try {
				expected = resolveRoutedCjs(request, route, parent, main, routedOptions);
			} catch (error) {
				if (route.kind !== "interception" || !isUnselectedPackageMiss(error)) throw error;
				expected = resolveRoutedCjs(request, {
					kind: "native-after-interception",
					parent: route.after
				}, parent, main, routedOptions);
			}
			if (cacheable) state.cjs = expected;
			return expected;
		} finally {
			delegatedCjs--;
		}
	};
	const relocatedFilename = (request, parent, main, options) => {
		let cacheMap = void 0;
		let cacheKey = void 0;
		if (!delegatedCjs && !main && options === void 0 && typeof request === "string" && router.moved.targets.size === 0) {
			const pfn = parent?.filename;
			if (typeof pfn === "string" && pfn.length > 0 && !request.includes("libreoffice-kit-")) {
				const isAsarP = isAsarImmutablePath(pfn);
				if (isAsarP || bootPhaseActive) {
					const isRelativeReq = request.charCodeAt(0) === 46 && (request.length === 1 || request.charCodeAt(1) === 47 || request.charCodeAt(1) === 92 || (request.charCodeAt(1) === 46 && (request.length === 2 || request.charCodeAt(2) === 47 || request.charCodeAt(2) === 92)));
					const pDir = dirname(pfn);
					const canCacheBare = !isRelativeReq && request.charCodeAt(0) !== 35 && Array.isArray(parent.paths) && parent.paths[0] === join(pDir, "node_modules");
					if (isRelativeReq || canCacheBare) {
						cacheMap = isAsarP ? cjsAsarResolvedCache : cjsBootResolvedCache;
						cacheKey = pDir + "\\0" + request;
						const cached = cacheMap.get(cacheKey);
						if (cached !== void 0) return cached;
					}
				}
			}
		}
		let filename = wrappedFilename(request, parent, main, options);
		const redirector = globalThis[OFFICE_REDIRECT_SYMBOL];
		if (redirector !== void 0 && isAbsolute(filename) && (filename.includes("libreoffice-kit-") || request.startsWith("@deepseek-ai/libreoffice-kit-"))) {
			filename = redirector.redirectPath(filename, request);
		}
		const result = router.moved.targets.size === 0 ? filename : (isAbsolute(filename) ? router.relocate(filename, parent?.filename ?? void 0) : filename);
		if (cacheMap !== void 0 && typeof result === "string" && !result.includes("libreoffice-kit-") && cacheMap.size < 60000) {
			cacheMap.set(cacheKey, result);
		}
		return result;
	};`,
    "dsh-app-boot wrappedFilename, relocatedFilename & office redirect"
  );

  code = replaceOnce(
    code,
`async function recompose(ctx, patches, binName, options, withResolution) {
	const { requiredIds = [], running = [] } = options;`,
`async function recompose(ctx, patches, binName, options, withResolution) {
	onRuntimeRecompose(ctx);
	const { requiredIds = [], running = [] } = options;`,
    "dsh-app-boot recompose onRuntimeRecompose"
  );

  code = replaceOnce(
    code,
`	let stage = "host preparation failed";
	try {
		ctx.baseUrl = pathToFileURL(dirname(absoluteConfigPath)).href + "/";
		ctx.provide("dshHomePath", dshHomePath);
		await ctx.plugin(Loader);
		await prepare?.(ctx);
		stage = "plugin tree failed to load";
		await mountRootInclude(ctx, absoluteConfigPath, patches, bareModuleBaseUrl, binName);
		await ctx.get("loader")?.await();
		if (ctx.get("loader") === void 0) return ctx;
		await auditStartupEntries(ctx, binName);
		return ctx;
	} catch (cause) {
		if (cause instanceof StartupError) try {
			cause.composition = captureStartupComposition(ctx);
		} catch (error) {
			ctx.logger.warn("Startup composition diagnostic unavailable", error);
		}
		await ctx.fiber.dispose();
		if (cause instanceof StartupError) {
			cause.startup = {
				configurationPath: absoluteConfigPath,
				messages: startupLogs
			};
			throw cause;
		}
		const detail = cause instanceof Error ? cause.message : String(cause);
		let deepest = cause;
		const seen = /* @__PURE__ */ new Set();
		while (deepest instanceof Error && !seen.has(deepest) && deepest.cause !== void 0) {
			seen.add(deepest);
			deepest = deepest.cause;
		}
		const stack = deepest instanceof AggregateError ? \`\\n\${deepest.stack ?? deepest.message}\\n\${deepest.errors.map((error) => formatActivationError(error)).join("\\n")}\` : deepest instanceof Error && deepest !== cause ? \`\\n\${deepest.stack ?? deepest.message}\` : "";
		throw new Error(\`\${binName}: \${stage}: \${detail}\${stack}\`, { cause });
	} finally {
		await diagnostics.fiber.dispose();
	}`,
`	let stage = "host preparation failed";
	installBootFsAccel();
	try {
		ctx.baseUrl = pathToFileURL(dirname(absoluteConfigPath)).href + "/";
		ctx.provide("dshHomePath", dshHomePath);
		await ctx.plugin(Loader);
		await prepare?.(ctx);
		stage = "plugin tree failed to load";
		await mountRootInclude(ctx, absoluteConfigPath, patches, bareModuleBaseUrl, binName);
		await ctx.get("loader")?.await();
		if (ctx.get("loader") === void 0) return ctx;
		await auditStartupEntries(ctx, binName);
		return ctx;
	} catch (cause) {
		if (cause instanceof StartupError) try {
			cause.composition = captureStartupComposition(ctx);
		} catch (error) {
			ctx.logger.warn("Startup composition diagnostic unavailable", error);
		}
		await ctx.fiber.dispose();
		if (cause instanceof StartupError) {
			cause.startup = {
				configurationPath: absoluteConfigPath,
				messages: startupLogs
			};
			throw cause;
		}
		const detail = cause instanceof Error ? cause.message : String(cause);
		let deepest = cause;
		const seen = /* @__PURE__ */ new Set();
		while (deepest instanceof Error && !seen.has(deepest) && deepest.cause !== void 0) {
			seen.add(deepest);
			deepest = deepest.cause;
		}
		const stack = deepest instanceof AggregateError ? \`\\n\${deepest.stack ?? deepest.message}\\n\${deepest.errors.map((error) => formatActivationError(error)).join("\\n")}\` : deepest instanceof Error && deepest !== cause ? \`\\n\${deepest.stack ?? deepest.message}\` : "";
		throw new Error(\`\${binName}: \${stage}: \${detail}\${stack}\`, { cause });
	} finally {
		endBootFsPhase();
		await diagnostics.fiber.dispose();
	}`,
    "dsh-app-boot boot() Boot-Phase FS Accelerator lifecycle"
  );

  setReplacement(filePath, code);
  log("Prepared patch for: " + filePath);
}
