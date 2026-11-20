import { replaceOnce, makeAsarImmutableHelper } from "./utils.mjs";

export function patchDshClientHmr({ readFromAsar, setReplacement, log = () => {} }) {
  const path = "dsh/node_modules/@deepseek-ai/dsh-client-hmr/lib/index.js";
  let code = readFromAsar(path);

  code = replaceOnce(
    code,
`function apply(ctx, config) {
	const pollIntervalMs = config.pollIntervalMs;
	const watched = /* @__PURE__ */ new Map();`,
`${makeAsarImmutableHelper("isImmutableAsarBundlePath")}
function apply(ctx, config) {
	const pollIntervalMs = config.pollIntervalMs;
	const watched = /* @__PURE__ */ new Map();
	const ignoredImmutable = /* @__PURE__ */ new Map();`,
    "dsh-client-hmr immutable asar helper & set"
  );

  code = replaceOnce(
    code,
`	const watchRow = (id, baseline) => {
		const watch = {
			...baseline,
			dirty: false
		};
		watched.set(id, watch);`,
`	const watchRow = (id, baseline) => {
		if (process.env.DSH_CLIENT_HMR_WATCH_ASAR !== "1" && isImmutableAsarBundlePath(baseline.path)) {
			ignoredImmutable.set(id, baseline.path);
			return;
		}
		ignoredImmutable.delete(id);
		const watch = {
			...baseline,
			dirty: false
		};
		watched.set(id, watch);`,
    "dsh-client-hmr watchRow skip immutable asar"
  );

  code = replaceOnce(
    code,
`	const syncWatches = () => {
		const rows = /* @__PURE__ */ new Map();
		for (const row of ctx.clientModules.graph().entries) {
			const watch = ctx.clientModules.artifactBaseline(row.id);
			if (watch !== void 0) rows.set(row.id, watch);
		}
		for (const [id, watch] of watched) {
			if (rows.get(id)?.path === watch.path) continue;
			watched.delete(id);
		}
		for (const [id, watch] of rows) if (!watched.has(id)) watchRow(id, watch);
	};
	ctx.effect(() => {
		syncWatches();
		const unsubscribe = ctx.clientModules.onGraphChanged(syncWatches);
		const timer = setInterval(pollWatches, pollIntervalMs);
		timer.unref();
		return () => {
			unsubscribe();
			clearInterval(timer);
			watched.clear();
		};
	}, "client-hmr: bundle watches");`,
`	const syncWatches = () => {
		const rows = /* @__PURE__ */ new Map();
		const watchAsar = process.env.DSH_CLIENT_HMR_WATCH_ASAR === "1";
		for (const row of ctx.clientModules.graph().entries) {
			if (!watchAsar && ignoredImmutable.has(row.id)) {
				const bPath = ctx.clientModules.clientPath(row.id);
				if (bPath === ignoredImmutable.get(row.id)) {
					rows.set(row.id, { path: bPath, immutable: true });
					continue;
				}
			}
			const watch = ctx.clientModules.artifactBaseline(row.id);
			if (watch !== void 0) rows.set(row.id, watch);
		}
		for (const id of ignoredImmutable.keys()) {
			if (!rows.has(id)) ignoredImmutable.delete(id);
		}
		for (const [id, watch] of watched) {
			if (rows.get(id)?.path === watch.path) continue;
			watched.delete(id);
		}
		for (const [id, watch] of rows) {
			if (watch.immutable) continue;
			if (!watched.has(id)) watchRow(id, watch);
		}
	};
	ctx.effect(() => {
		let disposed = false;
		let synced = false;
		const onSync = () => {
			if (disposed) return;
			synced = true;
			syncWatches();
		};
		const unsubscribe = ctx.clientModules.onGraphChanged(onSync);
		const rootLoader = ctx.root?.loader;
		if (process.env.DSH_CLIENT_HMR_EAGER === "1" || typeof rootLoader?.await !== "function") {
			onSync();
		} else {
			Promise.resolve(rootLoader.await()).finally(() => {
				if (!disposed && !synced) onSync();
			});
		}
		const timer = setInterval(pollWatches, pollIntervalMs);
		timer.unref();
		return () => {
			disposed = true;
			unsubscribe();
			clearInterval(timer);
			watched.clear();
			ignoredImmutable.clear();
		};
	}, "client-hmr: bundle watches");`,
    "dsh-client-hmr async deferred first syncWatches"
  );

  setReplacement(path, code);
  log("Prepared patch for: " + path);
}
