import { replaceOnce, makeAsarImmutableHelper } from "./utils.mjs";

export function patchDshHmr({ readFromAsar, setReplacement, log = () => {} }) {
  const path = "dsh/node_modules/@deepseek-ai/dsh-hmr/lib/index.js";
  let code = readFromAsar(path);

  code = replaceOnce(
    code,
`import { realpath, stat } from "node:fs/promises";`,
`import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";`,
    "dsh-hmr fs promises clock import"
  );

  code = replaceOnce(
    code,
`function requireInternal(id) {
	const require = createRequire(import.meta.url);
	if (process.execArgv.includes("--expose-internals")) try {
		return require(id);
	} catch (_error) {}
	try {
		return require("node-addon-require-builtin").requireBuiltin(id);
	} catch (_error) {}
}`,
`function requireInternal(id) {
	const require = createRequire(import.meta.url);
	try {
		return require(id);
	} catch (_error) {}
	try {
		return require("node-addon-require-builtin").requireBuiltin(id);
	} catch (_error) {}
}`,
    "dsh-hmr requireInternal direct try"
  );

  code = replaceOnce(
    code,
`	invalidate(manifest) {
		const native = this.installPackageHooks();
		const directory = dirname(manifest);
		this.directories.add(directory);`,
`	invalidate(manifest) {
		const native = this.installPackageHooks();
		const directory = dirname(manifest);
		invalidateRealSpellings(directory);
		this.directories.add(directory);`,
    "dsh-hmr PackageManifests invalidate realSpellings"
  );

  code = replaceOnce(
    code,
`	records = /* @__PURE__ */ new Map();
	observedAt = Date.now();
	/**
	* The current time of the clock the operating system stamps local file writes with, read from a new marker file that is
	* removed again. The system clock and file timestamps can differ by a clock tick in either direction, so module files
	* are compared with this time; when no marker can be created, the system clock is used.
	* @returns Epoch milliseconds.
	*/
	now() {
		let directory;
		try {
			directory = mkdtempSync(join(tmpdir(), "dsh-hmr-clock-"));
		} catch (_error) {
			return Date.now();
		}
		try {
			const marker = join(directory, "now");
			writeFileSync(marker, "");
			return statSync(marker).mtimeMs;
		} finally {
			rmSync(directory, {
				recursive: true,
				force: true
			});
		}
	}`,
`	records = /* @__PURE__ */ new Map();
	observedAt = Date.now();
	__clockOffsetMs;
	__calibrationPromise;
	__observeEpoch = 0;
	__uncalibratedObservedAt;
	__applyClockOffsetToPending() {
		if (this.__clockOffsetMs !== void 0 && this.__uncalibratedObservedAt !== void 0) {
			this.observedAt = this.__uncalibratedObservedAt + this.__clockOffsetMs;
			this.__uncalibratedObservedAt = void 0;
		}
	}
	markObservedNow() {
		const epoch = ++this.__observeEpoch;
		const baseSysNow = Date.now();
		if (this.__clockOffsetMs !== void 0) {
			this.__uncalibratedObservedAt = void 0;
			this.observedAt = baseSysNow + this.__clockOffsetMs;
			return Promise.resolve(this.observedAt);
		}
		this.__uncalibratedObservedAt = baseSysNow;
		this.observedAt = baseSysNow;
		return this.__calibrateClockAsync().then((offset) => {
			if (offset !== void 0 && this.__observeEpoch === epoch) this.__applyClockOffsetToPending();
			return this.observedAt;
		});
	}
	__calibrateClockAsync() {
		if (this.__clockOffsetMs !== void 0) return Promise.resolve(this.__clockOffsetMs);
		if (this.__calibrationPromise !== void 0) return this.__calibrationPromise;
		const job = (async () => {
			let directory;
			try {
				directory = await mkdtemp(join(tmpdir(), "dsh-hmr-clock-"));
			} catch (_error) {
				return;
			}
			try {
				const marker = join(directory, "now");
				const sysBefore = Date.now();
				await writeFile(marker, "");
				const sysAfter = Date.now();
				const fsNow = (await stat(marker)).mtimeMs;
				const offset = fsNow - (sysBefore + sysAfter) / 2;
				if (this.__clockOffsetMs === void 0) this.__clockOffsetMs = offset;
				return this.__clockOffsetMs;
			} catch (_error) {
				return;
			} finally {
				await rm(directory, {
					recursive: true,
					force: true
				}).catch(() => {});
				if (this.__calibrationPromise === job) this.__calibrationPromise = void 0;
			}
		})();
		this.__calibrationPromise = job;
		return job;
	}
	now() {
		if (this.__clockOffsetMs !== void 0) return Date.now() + this.__clockOffsetMs;
		let directory;
		try {
			directory = mkdtempSync(join(tmpdir(), "dsh-hmr-clock-"));
		} catch (_error) {
			return Date.now();
		}
		try {
			const marker = join(directory, "now");
			const sysNow = Date.now();
			writeFileSync(marker, "");
			const fsNow = statSync(marker).mtimeMs;
			this.__clockOffsetMs = fsNow - sysNow;
			this.__applyClockOffsetToPending();
			return fsNow;
		} finally {
			rmSync(directory, {
				recursive: true,
				force: true
			});
		}
	}`,
    "dsh-hmr ModuleFiles clock offset cache & async calibration"
  );

  code = replaceOnce(
    code,
`	compare(urls) {
		const stale = /* @__PURE__ */ new Set();`,
`	compare(urls) {
		if (this.__clockOffsetMs === void 0 && this.__uncalibratedObservedAt !== void 0) {
			this.now();
		}
		this.__applyClockOffsetToPending();
		const stale = /* @__PURE__ */ new Set();`,
    "dsh-hmr ModuleFiles compare flush pending calibration"
  );

  code = replaceOnce(
    code,
`		this.records = records;
		this.observedAt = at;
	}
	/**
	* Record the current identity of modules just evaluated again, leaving every other record unchanged.`,
`		this.__observeEpoch += 1;
		this.__uncalibratedObservedAt = void 0;
		this.records = records;
		this.observedAt = at;
	}
	/**
	* Record the current identity of modules just evaluated again, leaving every other record unchanged.`,
    "dsh-hmr ModuleFiles observe bump epoch"
  );

  code = replaceOnce(
    code,
`			const profile = this.ownerContext.get("profileContext");
			if (profile !== void 0) {
				const ready = this.ownerContext.get("appReady");
				if (ready === void 0) throw new Error("Profile HMR requires application readiness");
				const started = Promise.withResolvers();
				this.applicationReady = started.promise;
				const unsubscribe = ready.onReady(() => {
					try {
						this.files.observe(this.profileModules(profileRoots(profile.dir)));
					} catch (error) {
						this.ctx.logger.warn(error);
					}
					started.resolve(true);
				});
				yield () => {
					unsubscribe();
					started.resolve(false);
					return Promise.resolve();
				};
				const manifestPath = join(profile.dir, "package.json");
				const patchFiles = [profile.patchPath, join(profile.home, PROFILE_PATCH_FILENAME)];
				let lastInputs;
				let lastBundles = JSON.stringify(profile.startedBundles);
				const refresh = async (manifestOnly) => {
					const bundles = JSON.stringify(readProfileManifest("dsh", profile.dir).dsh?.profile?.bundles ?? []);
					if (manifestOnly && bundles === lastBundles) return;
					const inputs = JSON.stringify([bundles, ...patchFiles.map((filename) => {
						try {
							return readFileSync(filename, "utf8");
						} catch (error) {
							if (error.code === "ENOENT") return null;
							throw error;
						}
					})]);
					if (inputs === lastInputs) return;`,
`			const profile = this.ownerContext.get("profileContext");
			if (profile !== void 0) {
				const ready = this.ownerContext.get("appReady");
				if (ready === void 0) throw new Error("Profile HMR requires application readiness");
				const started = Promise.withResolvers();
				this.applicationReady = started.promise;
				let idleObserveTimer;
				let observeCalibration;
				let disposed = false;
				const startIdleStepObserve = () => {
					if (disposed || this.closing || this.files.records.size > 0) return;
					try {
						const observeEpoch = this.files.__observeEpoch;
						const at = this.files.observedAt;
						const urls = this.profileModules(profileRoots(profile.dir));
						let idx = 0;
						const stepObserve = () => {
							if (disposed || this.closing || this.files.__observeEpoch !== observeEpoch) return;
							const end = Math.min(idx + 80, urls.length);
							for (; idx < end; idx++) {
								const u = urls[idx];
								if (this.files.records.has(u)) continue;
								const id = identityOf(u);
								this.files.records.set(u, id === void 0 || id.modifiedAt > at ? void 0 : id.key);
							}
							if (idx < urls.length) setImmediate(stepObserve);
						};
						setImmediate(stepObserve);
					} catch (error) {
						this.ctx.logger.warn(error);
					}
				};
				const unsubscribe = ready.onReady(() => {
					if (process.env.DSH_HMR_EAGER_OBSERVE === "1") {
						try {
							this.files.observe(this.profileModules(profileRoots(profile.dir)));
						} catch (error) {
							this.ctx.logger.warn(error);
						}
						started.resolve(true);
						return;
					}
					observeCalibration = this.files.markObservedNow();
					started.resolve(true);
					idleObserveTimer = setTimeout(() => {
						idleObserveTimer = void 0;
						if (disposed || this.closing || this.files.records.size > 0) return;
						if (this.files.__calibrationPromise !== void 0 && observeCalibration !== void 0) {
							void observeCalibration.then(() => {
								startIdleStepObserve();
							}, () => {});
							return;
						}
						startIdleStepObserve();
					}, 1500);
					idleObserveTimer.unref();
				});
				yield () => {
					disposed = true;
					if (idleObserveTimer !== void 0) {
						clearTimeout(idleObserveTimer);
						idleObserveTimer = void 0;
					}
					unsubscribe();
					started.resolve(false);
					return Promise.resolve();
				};
				const manifestPath = join(profile.dir, "package.json");
				const patchFiles = [profile.patchPath, join(profile.home, PROFILE_PATCH_FILENAME)];
				const readPatchSnapshot = (filename) => {
					try {
						return readFileSync(filename, "utf8");
					} catch (error) {
						if (error.code === "ENOENT") return null;
						throw error;
					}
				};
				const readInputsSnapshot = (bundles) => JSON.stringify([bundles, ...patchFiles.map(readPatchSnapshot)]);
				let lastBundles = JSON.stringify(profile.startedBundles);
				let lastInputs = readInputsSnapshot(lastBundles);
				const refresh = async (manifestOnly) => {
					const bundles = JSON.stringify(readProfileManifest("dsh", profile.dir).dsh?.profile?.bundles ?? []);
					if (manifestOnly && bundles === lastBundles) return;
					const inputs = readInputsSnapshot(bundles);
					if (inputs === lastInputs) return;`,
    "dsh-hmr lazy idle observe & precomputed lastInputs"
  );

  code = replaceOnce(
    code,
`function mappedDirectories(resolution) {
	const directories = /* @__PURE__ */ new Set();
	if (resolution === void 0) return directories;
	const dirs = [...resolution.entries.filter((entry) => entry.scope === "profile").map((entry) => entry.packageDir), ...resolution.linkedRoots.map((root) => root.realPath)];
	for (const dir of dirs) for (const spelling of existsSync(dir) ? realSpellings(dir) : [dir]) directories.add(spelling + sep);
	return directories;
}
/**
* The JavaScript and native real paths of an existing path. A packed worker's file system has no native realpath.
* @param path Existing path.
* @returns The distinct spellings.
*/
function realSpellings(path) {
	const native = Reflect.get(realpathSync, "native");
	return [realpathSync(path), ...typeof native === "function" ? [String(Reflect.apply(native, realpathSync, [path]))] : []];
}
/**
* Real directories, with a trailing separator, of the profile and of the targets its linked packages point to. Each
* appears in both real-path spellings: Node's module caches use the JavaScript one, the runtime resolution the native
* one, and on Windows they differ for 8.3 short names.
*/
function profileRoots(dir) {
	const modules = join(realpathSync(dir), "node_modules");
	const linked = (existsSync(modules) ? readdirSync(modules) : []).flatMap((name) => name.startsWith("@") ? readdirSync(join(modules, name)).map((child) => join(modules, name, child)) : [join(modules, name)]).filter((path) => lstatSync(path).isSymbolicLink() && existsSync(path));
	return [...new Set([dir, ...linked].flatMap((path) => realSpellings(path)).map((root) => root + sep))];
}`,
`const realSpellingsCache = /* @__PURE__ */ new Map();
let realSpellingsScopeDepth = 0;
const normalizePathForMatch = process.platform === "win32" ? (p) => p.toLowerCase() : (p) => p;
${makeAsarImmutableHelper("isAsarImmutableHmrPath")}
function isPathRelated(candidate, normTarget, targetPrefix) {
	const normCandidate = normalizePathForMatch(candidate);
	const candidatePrefix = normCandidate.endsWith(sep) ? normCandidate : normCandidate + sep;
	return normCandidate === normTarget || normCandidate.startsWith(targetPrefix) || targetPrefix.startsWith(candidatePrefix);
}
function invalidateRealSpellings(targetPath) {
	if (targetPath === void 0) {
		for (const key of realSpellingsCache.keys()) {
			if (!isAsarImmutableHmrPath(key)) realSpellingsCache.delete(key);
		}
		return;
	}
	const normTarget = normalizePathForMatch(targetPath);
	const targetPrefix = normTarget.endsWith(sep) ? normTarget : normTarget + sep;
	for (const [key, cached] of realSpellingsCache) {
		if (isAsarImmutableHmrPath(key)) continue;
		if (isPathRelated(key, normTarget, targetPrefix) || cached.some((s) => isPathRelated(s, normTarget, targetPrefix))) {
			realSpellingsCache.delete(key);
		}
	}
}
function withRealSpellingsScope(fn) {
	realSpellingsScopeDepth += 1;
	try {
		return fn();
	} finally {
		realSpellingsScopeDepth -= 1;
		if (realSpellingsScopeDepth === 0) invalidateRealSpellings();
	}
}
function mappedDirectories(resolution) {
	const directories = /* @__PURE__ */ new Set();
	if (resolution === void 0) return directories;
	return withRealSpellingsScope(() => {
		const dirs = [...resolution.entries.filter((entry) => entry.scope === "profile").map((entry) => entry.packageDir), ...resolution.linkedRoots.map((root) => root.realPath)];
		for (const dir of dirs) for (const spelling of existsSync(dir) ? realSpellings(dir) : [dir]) directories.add(spelling + sep);
		return directories;
	});
}
function realSpellings(path) {
	const useCache = realSpellingsScopeDepth > 0 || isAsarImmutableHmrPath(path);
	if (useCache) {
		const cached = realSpellingsCache.get(path);
		if (cached !== void 0) return cached;
	}
	const native = Reflect.get(realpathSync, "native");
	const jsReal = realpathSync(path);
	const natReal = typeof native === "function" ? String(Reflect.apply(native, realpathSync, [path])) : void 0;
	const spellings = natReal !== void 0 && natReal !== jsReal ? [jsReal, natReal] : [jsReal];
	if (useCache) realSpellingsCache.set(path, spellings);
	return spellings;
}
function profileRoots(dir) {
	return withRealSpellingsScope(() => {
		const modules = join(realpathSync(dir), "node_modules");
		const linked = (existsSync(modules) ? readdirSync(modules) : []).flatMap((name) => name.startsWith("@") ? readdirSync(join(modules, name)).map((child) => join(modules, name, child)) : [join(modules, name)]).filter((path) => lstatSync(path).isSymbolicLink() && existsSync(path));
		return [...new Set([dir, ...linked].flatMap((path) => realSpellings(path)).map((root) => root + sep))];
	});
}`,
    "dsh-hmr realSpellings scoped cache & invalidation"
  );

  setReplacement(path, code);
  log("Prepared patch for: " + path);
}
