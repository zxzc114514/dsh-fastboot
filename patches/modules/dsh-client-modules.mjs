import { replaceOnce, makeAsarImmutableHelper } from "./utils.mjs";

export function patchDshClientModules({ readFromAsar, setReplacement, log = () => {} }) {
  const path = "dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js";
  let code = readFromAsar(path);

  code = replaceOnce(
    code,
`import { Service } from "@deepseek-ai/cordis";`,
`import { Service } from "@deepseek-ai/cordis";
${makeAsarImmutableHelper("isAsarImmutableClientPath")}`,
    "dsh-client-modules asar helper"
  );

  code = replaceOnce(
    code,
`	flushQueued = false;
	composed;`,
`	flushQueued = false;
	bootSettled = false;
	pkgManifestCache = /* @__PURE__ */ new Map();
	sourceMetaCache = /* @__PURE__ */ new Map();
	composed;
	ensureFlushed() {
		if (this.dirty.size === 0) return;
		this.flushQueued = false;
		this.flush((err) => {
			this.ctx.logger.warn(err);
		});
	}`,
    "dsh-client-modules fields & ensureFlushed"
  );

  code = replaceOnce(
    code,
`			this.dirty.add(entryName);
			if (this.flushQueued) return;`,
`			this.dirty.add(entryName);
			if (!this.bootSettled) return;
			if (this.flushQueued) return;`,
    "dsh-client-modules skip microtask flush during boot"
  );

  code = replaceOnce(
    code,
`		if (failures.length > 0) throw new ClientPackageCompositionError(failures);
		const registerWebCarrier = (webCtx) => {`,
`		if (failures.length > 0) throw new ClientPackageCompositionError(failures);
		const rootLoader = ctx.root?.loader;
		if (typeof rootLoader?.await === "function") {
			Promise.resolve(rootLoader.await()).finally(() => {
				if (this.bootSettled) return;
				this.bootSettled = true;
				this.ensureFlushed();
			});
		} else {
			this.bootSettled = true;
		}
		const registerWebCarrier = (webCtx) => {`,
    "dsh-client-modules defer bootSettled until rootLoader await"
  );

  code = replaceOnce(
    code,
`		ctx.on("webserver/index-inject", (table) => {
			table.push(...bootInjections(this.composed));
		});`,
`		ctx.on("webserver/index-inject", (table) => {
			this.ensureFlushed();
			table.push(...bootInjections(this.composed));
		});
		ctx.on("app-boot/config-reload", () => {
			this.sourceMetaCache.clear();
		});`,
    "dsh-client-modules ensureFlushed on index-inject"
  );

  code = replaceOnce(
    code,
`	graph() {
		return this.composed;
	}
	/**
	* Absolute path of an entry's client bundle.
	* @param id - entry id (package name).
	* @returns the path, or undefined for an unknown id.
	*/
	clientPath(id) {
		return this.table.get(id)?.meta.clientPath;
	}`,
`	graph() {
		this.ensureFlushed();
		return this.composed;
	}
	/**
	* Absolute path of an entry's client bundle.
	* @param id - entry id (package name).
	* @returns the path, or undefined for an unknown id.
	*/
	clientPath(id) {
		this.ensureFlushed();
		return this.table.get(id)?.meta.clientPath;
	}`,
    "dsh-client-modules ensureFlushed in graph & clientPath"
  );

  code = replaceOnce(
    code,
`	artifactBaseline(id) {
		const baseline = this.table.get(id)?.baseline;
		return baseline === void 0 ? void 0 : { ...baseline };
	}`,
`	artifactBaseline(id) {
		this.ensureFlushed();
		const baseline = this.table.get(id)?.baseline;
		return baseline === void 0 ? void 0 : { ...baseline };
	}`,
    "dsh-client-modules artifactBaseline ensureFlushed"
  );

  code = replaceOnce(
    code,
`	rebuilt(id) {
		const record = this.table.get(id);`,
`	rebuilt(id) {
		this.ensureFlushed();
		const record = this.table.get(id);`,
    "dsh-client-modules rebuilt ensureFlushed"
  );

  code = replaceOnce(
    code,
`	async bundleResource(method, url, ifNoneMatch) {
		if (method !== "GET" && method !== "HEAD") return { status: 405 };`,
`	async bundleResource(method, url, ifNoneMatch) {
		this.ensureFlushed();
		if (method !== "GET" && method !== "HEAD") return { status: 405 };`,
    "dsh-client-modules bundleResource ensureFlushed"
  );

  code = replaceOnce(
    code,
`	resolveMeta(loaderName, baseUrl) {
		const located = this.locatePkgJson(loaderName, baseUrl);
		if (located === void 0) return null;
		const { packageName, path: pkgPath } = located;
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
		const dsh = pkg.dsh;
		const decl = parseDshClient(packageName, dsh !== null && typeof dsh === "object" ? dsh.client : void 0);
		if (decl === void 0 || decl.platform !== "web") return null;
		const clientRel = clientExportOf(packageName, pkg.exports);
		if (clientRel === void 0) throw new Error(\`client-modules: \${packageName} declares dsh.client but exports no "./client" bundle\`);
		return {
			packageName,
			meta: {
				clientPath: join(dirname(pkgPath), clientRel),
				manifestPath: pkgPath,
				...decl.inject !== void 0 ? { inject: decl.inject } : {},
				external: decl.external ?? [],
				immediately: decl.immediately === true
			}
		};
	}
	/**
	* Locate the manifest of the package the Loader mounts for a row. The row's
	* module location is authoritative: the specifier resolves through the same
	* Loader resolution that imported the row's host half — including any
	* active ESM hooks — and the nearest ancestor manifest declaring the name
	* owns the module. Tree-anchored \`require\` resolution remains only for
	* runtimes without Node internals.
	* @param loaderName - module specifier of the loader row.
	* @param baseUrl - resolution base of the tree that owns the row.
	* @returns the manifest path, or \`undefined\` when the name resolves to no package root.
	*/
	locatePkgJson(loaderName, baseUrl) {
		if (loaderName.startsWith("cordis:")) return void 0;
		const pathLike = loaderName.startsWith(".") || loaderName.startsWith("file:") || isAbsolute(loaderName);
		const expectedPackageName = pathLike ? void 0 : exactPackageSpecifier(loaderName);
		if (!pathLike && expectedPackageName === void 0) return void 0;
		const internal = this.ctx.loader.internal;
		if (internal === void 0 || typeof Reflect.get(internal, "resolveSync") !== "function") {
			if (expectedPackageName === void 0) {
				const moduleUrl = loaderName.startsWith("file:") ? loaderName : isAbsolute(loaderName) ? pathToFileURL(loaderName).href : new URL(loaderName, baseUrl).href;
				return this.nearestPackage(moduleUrl);
			}
			try {
				return {
					path: createRequire(baseUrl).resolve(\`\${expectedPackageName}/package.json\`),
					packageName: expectedPackageName
				};
			} catch {
				return;
			}
		}
		let moduleUrl;
		try {
			moduleUrl = internal.version === "v2" ? internal.resolveSync(baseUrl, {
				specifier: loaderName,
				attributes: {}
			}).url : internal.resolveSync(loaderName, baseUrl, {}).url;
		} catch {
			return;
		}
		return this.nearestPackage(moduleUrl, expectedPackageName);
	}
	nearestPackage(moduleUrl, expectedPackageName) {
		if (!moduleUrl.startsWith("file:")) return void 0;
		let dir = dirname(fileURLToPath(moduleUrl));
		while (true) {
			const candidate = join(dir, "package.json");
			if (existsSync(candidate)) try {
				const name = JSON.parse(readFileSync(candidate, "utf8")).name;
				if (typeof name === "string" && (expectedPackageName === void 0 || name === expectedPackageName)) return {
					path: candidate,
					packageName: name
				};
			} catch {}
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	}`,
`	readPkgManifestCached(pkgPath) {
		if (isAsarImmutableClientPath(pkgPath)) {
			let cached = this.pkgManifestCache.get(pkgPath);
			if (cached === void 0) {
				cached = JSON.parse(readFileSync(pkgPath, "utf8"));
				this.pkgManifestCache.set(pkgPath, cached);
			}
			return cached;
		}
		return JSON.parse(readFileSync(pkgPath, "utf8"));
	}
	resolveMeta(loaderName, baseUrl) {
		const cacheKey = this.sourceKey(loaderName, baseUrl);
		const cached = this.sourceMetaCache.get(cacheKey);
		if (cached !== void 0) return cached;
		const located = this.locatePkgJson(loaderName, baseUrl);
		if (located === void 0) return null;
		const { packageName, path: pkgPath, manifest } = located;
		const pkg = manifest ?? this.readPkgManifestCached(pkgPath);
		const dsh = pkg.dsh;
		const decl = parseDshClient(packageName, dsh !== null && typeof dsh === "object" ? dsh.client : void 0);
		if (decl === void 0 || decl.platform !== "web") {
			if (isAsarImmutableClientPath(pkgPath)) this.sourceMetaCache.set(cacheKey, null);
			return null;
		}
		const clientRel = clientExportOf(packageName, pkg.exports);
		if (clientRel === void 0) throw new Error(\`client-modules: \${packageName} declares dsh.client but exports no "./client" bundle\`);
		const result = {
			packageName,
			meta: {
				clientPath: join(dirname(pkgPath), clientRel),
				manifestPath: pkgPath,
				...decl.inject !== void 0 ? { inject: decl.inject } : {},
				external: decl.external ?? [],
				immediately: decl.immediately === true
			}
		};
		if (isAsarImmutableClientPath(pkgPath)) this.sourceMetaCache.set(cacheKey, result);
		return result;
	}
	locatePkgJson(loaderName, baseUrl) {
		if (loaderName.startsWith("cordis:")) return void 0;
		const pathLike = loaderName.startsWith(".") || loaderName.startsWith("file:") || isAbsolute(loaderName);
		const expectedPackageName = pathLike ? void 0 : exactPackageSpecifier(loaderName);
		if (!pathLike && expectedPackageName === void 0) return void 0;
		const internal = this.ctx.loader.internal;
		if (internal === void 0 || typeof Reflect.get(internal, "resolveSync") !== "function") {
			if (expectedPackageName === void 0) {
				const moduleUrl = loaderName.startsWith("file:") ? loaderName : isAbsolute(loaderName) ? pathToFileURL(loaderName).href : new URL(loaderName, baseUrl).href;
				return this.nearestPackage(moduleUrl);
			}
			try {
				return {
					path: createRequire(baseUrl).resolve(\`\${expectedPackageName}/package.json\`),
					packageName: expectedPackageName
				};
			} catch {
				return;
			}
		}
		let moduleUrl;
		try {
			moduleUrl = internal.version === "v2" ? internal.resolveSync(baseUrl, {
				specifier: loaderName,
				attributes: {}
			}).url : internal.resolveSync(loaderName, baseUrl, {}).url;
		} catch {
			return;
		}
		return this.nearestPackage(moduleUrl, expectedPackageName);
	}
	nearestPackage(moduleUrl, expectedPackageName) {
		if (!moduleUrl.startsWith("file:")) return void 0;
		let dir = dirname(fileURLToPath(moduleUrl));
		while (true) {
			const candidate = join(dir, "package.json");
			if (this.pkgManifestCache.has(candidate) || existsSync(candidate)) try {
				const manifest = this.readPkgManifestCached(candidate);
				const name = manifest.name;
				if (typeof name === "string" && (expectedPackageName === void 0 || name === expectedPackageName)) return {
					path: candidate,
					packageName: name,
					manifest
				};
			} catch {}
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	}`,
    "dsh-client-modules resolveMeta & nearestPackage single-read cache"
  );

  code = replaceOnce(
    code,
`	reconcilePackage(packageName) {
		const sources = [];
		for (const source of this.sources.values()) if (source.packageName === packageName) sources.push(source);
		if (sources.length > 1) {
			const locations = sources.map((source) => \`\${JSON.stringify(source.loaderName)} from \${source.baseUrl}\`).join(", ");
			throw new Error(\`client-modules: package \${packageName} resolves from multiple active Loader sources: \${locations}; remove one entry\`);
		}
		const source = sources[0];
		if (source === void 0) return this.table.delete(packageName);
		const { clientPath } = source.meta;
		const baseline = this.readClientBundle(packageName, clientPath, () => this.captureArtifactBaseline(clientPath));
		const entry = graphRow(packageName, artifactRevision(baseline), source.meta);
		const current = this.table.get(packageName);
		if (current?.sourceKey === source.sourceKey && isDeepStrictEqual(current.meta, source.meta) && isDeepStrictEqual(current.entry, entry)) return false;`,
`	reconcilePackage(packageName) {
		const sources = [];
		for (const source of this.sources.values()) if (source.packageName === packageName) sources.push(source);
		if (sources.length > 1) {
			const locations = sources.map((source) => \`\${JSON.stringify(source.loaderName)} from \${source.baseUrl}\`).join(", ");
			throw new Error(\`client-modules: package \${packageName} resolves from multiple active Loader sources: \${locations}; remove one entry\`);
		}
		const source = sources[0];
		if (source === void 0) return this.table.delete(packageName);
		const { clientPath } = source.meta;
		const current = this.table.get(packageName);
		if (current !== void 0 && isAsarImmutableClientPath(clientPath) && current.sourceKey === source.sourceKey && current.meta.clientPath === clientPath && isDeepStrictEqual(current.meta, source.meta)) {
			return false;
		}
		const baseline = this.readClientBundle(packageName, clientPath, () => this.captureArtifactBaseline(clientPath));
		const entry = graphRow(packageName, artifactRevision(baseline), source.meta);
		if (current?.sourceKey === source.sourceKey && isDeepStrictEqual(current.meta, source.meta) && isDeepStrictEqual(current.entry, entry)) return false;`,
    "dsh-client-modules reconcilePackage asar fast skip"
  );

  setReplacement(path, code);
  log("Prepared patch for: " + path);
}
