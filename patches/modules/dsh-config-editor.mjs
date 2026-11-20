import { replaceOnce } from "./utils.mjs";

export function patchDshConfigEditor({ readFromAsar, setReplacement, log = () => {} }) {
  const path = "dsh/node_modules/@deepseek-ai/dsh-config-editor/lib/index.js";
  let code = readFromAsar(path);

  code = replaceOnce(
    code,
`var ConfigEditor = class extends Service {
	ownerContext;`,
`function sameEntryList(left, right) {
	if (left.length !== right.length) return false;
	for (let i = 0; i < left.length; i++) {
		if (left[i] !== right[i] || left[i].options.id !== right[i].options.id) return false;
	}
	return true;
}
var ConfigEditor = class extends Service {
	ownerContext;
	editEpoch = 0;
	configCache;`,
    "dsh-config-editor ConfigEditor cache fields"
  );

  code = replaceOnce(
    code,
`	configuration() {
		const profile = this.ownerContext.profileContext;
		const loaded = loadProfileDirectory("dsh", profile.dir, profile.installAnchor);
		const entries = this.entries();
		const overridden = new Set(loaded.patches.filter((patch) => patch.insert === void 0 && Object.hasOwn(patch, "config")).map((patch) => patch.id));
		const composed = /* @__PURE__ */ new Map();
		if (entries.some((entry) => !overridden.has(entry.options.id))) {
			for (const row of flatten(composeEntries([...loaded.layers.map((layer) => layer.patches), loaded.patches]))) if (!composed.has(row.id)) composed.set(row.id, row);
		}
		return entries.map((entry) => ({
			entry,
			inherited: overridden.has(entry.options.id) ? this.inherited(entry, loaded) : structuredClone(composed.get(entry.options.id)?.config ?? {}),
			override: structuredClone(loaded.patches.findLast((row) => row.id === entry.options.id && row.config !== void 0)?.config ?? {})
		}));
	}`,
`	configuration() {
		const profile = this.ownerContext.profileContext;
		const loaded = loadProfileDirectory("dsh", profile.dir, profile.installAnchor, { readonly: true });
		const entries = this.entries();
		const cached = this.configCache;
		if (cached !== void 0 && cached.editEpoch === this.editEpoch && cached.loaded === loaded && sameEntryList(cached.entries, entries)) {
			return cached.rows.map((row) => ({
				entry: row.entry,
				inherited: structuredClone(row.inherited),
				override: structuredClone(row.override)
			}));
		}
		const overridden = /* @__PURE__ */ new Set();
		const complexIds = /* @__PURE__ */ new Set();
		const lastOverride = /* @__PURE__ */ new Map();
		const collectInsertIds = (rows) => {
			for (let i = 0; i < rows.length; i++) {
				const r = rows[i];
				if (r?.id) complexIds.add(r.id);
				if (r?.group && Array.isArray(r.config)) collectInsertIds(r.config);
			}
		};
		for (let i = 0; i < loaded.patches.length; i++) {
			const patch = loaded.patches[i];
			if (patch.insert !== void 0) {
				if (patch.id) complexIds.add(patch.id);
				if (Array.isArray(patch.insert)) collectInsertIds(patch.insert);
			} else {
				if (Object.hasOwn(patch, "config")) overridden.add(patch.id);
				if (patch.config !== void 0) lastOverride.set(patch.id, patch.config);
			}
		}
		const layerPatches = loaded.layers.map((layer) => layer.patches);
		const composed = /* @__PURE__ */ new Map();
		if (entries.some((entry) => !overridden.has(entry.options.id))) {
			for (const row of flatten(composeEntries([...layerPatches, loaded.patches]))) if (!composed.has(row.id)) composed.set(row.id, row);
		}
		let strippedAllMap;
		const needsStrippedAll = entries.some((entry) => overridden.has(entry.options.id) && !complexIds.has(entry.options.id));
		if (needsStrippedAll) {
			strippedAllMap = /* @__PURE__ */ new Map();
			const strippedAllPatches = loaded.patches.map((patch) => {
				if (patch.insert !== void 0 || !Object.hasOwn(patch, "config")) return patch;
				const rest = { ...patch };
				Reflect.deleteProperty(rest, "config");
				return rest;
			});
			for (const row of flatten(composeEntries([...layerPatches, strippedAllPatches]))) {
				if (!strippedAllMap.has(row.id)) strippedAllMap.set(row.id, row);
			}
		}
		const baseRows = entries.map((entry) => {
			const id = entry.options.id;
			const inherited = overridden.has(id)
				? (complexIds.has(id) ? this.inherited(entry, loaded) : structuredClone(strippedAllMap.get(id)?.config ?? {}))
				: structuredClone(composed.get(id)?.config ?? {});
			const overrideRaw = lastOverride.get(id);
			return {
				entry,
				inherited,
				override: overrideRaw === void 0 ? {} : structuredClone(overrideRaw)
			};
		});
		this.configCache = { editEpoch: this.editEpoch, loaded, entries, rows: baseRows };
		return baseRows.map((row) => ({
			entry: row.entry,
			inherited: structuredClone(row.inherited),
			override: structuredClone(row.override)
		}));
	}`,
    "dsh-config-editor batch inherited + readonly cache"
  );

  code = replaceOnce(
    code,
`	async edit(entry, change) {
		const run = async () => {`,
`	async edit(entry, change) {
		this.editEpoch++;
		this.configCache = void 0;
		const run = async () => {
			this.editEpoch++;
			this.configCache = void 0;`,
    "dsh-config-editor edit entry invalidation"
  );

  code = replaceOnce(
    code,
`				await writeFileAtomic(path, String(document), { mode: 384 });
				try {
					await reconcileProfilePatches(this.ownerContext.root, patches, "dsh", [entry.options.id]);
				} catch (error) {
					await writeFileAtomic(path, before, { mode: 384 });
					await reconcileProfilePatches(this.ownerContext.root, beforePatches, "dsh");
					throw error;
				}`,
`				this.editEpoch++;
				this.configCache = void 0;
				await writeFileAtomic(path, String(document), { mode: 384 });
				try {
					await reconcileProfilePatches(this.ownerContext.root, patches, "dsh", [entry.options.id]);
				} catch (error) {
					this.editEpoch++;
					this.configCache = void 0;
					await writeFileAtomic(path, before, { mode: 384 });
					await reconcileProfilePatches(this.ownerContext.root, beforePatches, "dsh");
					throw error;
				}`,
    "dsh-config-editor edit write/rollback invalidation"
  );

  setReplacement(path, code);
  log("Prepared patch for: " + path);
}
