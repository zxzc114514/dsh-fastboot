import { replaceOnce } from "./utils.mjs";

export function patchDshSettings({ readFromAsar, setReplacement, log = () => {} }) {
  const path = "dsh/node_modules/@deepseek-ai/dsh-settings/lib/index.js";
  let code = readFromAsar(path);

  code = replaceOnce(
    code,
`function volatileForm(schema) {
	if (schema.meta.volatile) return plainSchema(schema);
	if (schema.type === "object") {
		const dict = Object.fromEntries(Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
			const field = volatileForm(child);
			return field === void 0 ? [] : [[key, field]];
		}));
		return Object.keys(dict).length === 0 ? void 0 : z.object(dict);
	}
}`,
`const NO_VOLATILE_FORM = Symbol("NO_VOLATILE_FORM");
const volatileFormCache = /* @__PURE__ */ new WeakMap();
const schemaJsonCache = /* @__PURE__ */ new WeakMap();
function getCachedSchemaJson(schema) {
	let cached = schemaJsonCache.get(schema);
	if (cached === void 0) {
		cached = schema.toJSON();
		schemaJsonCache.set(schema, cached);
	}
	return cached;
}
function volatileForm(schema) {
	const cached = volatileFormCache.get(schema);
	if (cached !== void 0) return cached === NO_VOLATILE_FORM ? void 0 : cached;
	let res;
	if (schema.meta.volatile) res = plainSchema(schema);
	else if (schema.type === "object") {
		const dict = Object.fromEntries(Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
			const field = volatileForm(child);
			return field === void 0 ? [] : [[key, field]];
		}));
		res = Object.keys(dict).length === 0 ? void 0 : z.object(dict);
	}
	volatileFormCache.set(schema, res === void 0 ? NO_VOLATILE_FORM : res);
	return res;
}`,
    "dsh-settings volatileForm & schemaJson cache"
  );

  code = replaceOnce(
    code,
`	revisions = /* @__PURE__ */ new Map();
	closed = false;
	scheduled = false;
	presentations = /* @__PURE__ */ new Map();`,
`	revisions = /* @__PURE__ */ new Map();
	descriptorCache = /* @__PURE__ */ new Map();
	closed = false;
	scheduled = false;
	bootSettled = false;
	deferredInvalidate = false;
	presentations = /* @__PURE__ */ new Map();`,
    "dsh-settings descriptorCache & boot batching fields"
  );

  code = replaceOnce(
    code,
`		ctx.root.loader.await().then(() => this.importLegacyDocument()).catch((error) => {
			ctx.logger.error(error);
		});`,
`		Promise.resolve(ctx.root.loader.await()).finally(() => {
			this.bootSettled = true;
			if (this.deferredInvalidate && !this.closed && this.ownerContext.fiber.state === 2) {
				this.deferredInvalidate = false;
				try {
					this.describe(void 0, true);
				} catch (error) {
					this.ownerContext.logger.error(error);
				}
			}
		});
		ctx.root.loader.await().then(() => this.importLegacyDocument()).catch((error) => {
			ctx.logger.error(error);
		});`,
    "dsh-settings constructor settle flush"
  );

  code = replaceOnce(
    code,
`	invalidate() {
		if (this.scheduled || this.closed) return;
		this.scheduled = true;
		queueMicrotask(() => {
			this.scheduled = false;
			if (this.closed || this.ownerContext.fiber.state !== 2) return;
			try {
				this.describe();
			} catch (error) {
				this.ownerContext.logger.error(error);
			}
		});
	}`,
`	invalidate() {
		if (!this.bootSettled && process.env.DSH_SETTINGS_EAGER_DESCRIBE !== "1") {
			this.deferredInvalidate = true;
			return;
		}
		if (this.scheduled || this.closed) return;
		this.scheduled = true;
		queueMicrotask(() => {
			this.scheduled = false;
			if (this.closed || this.ownerContext.fiber.state !== 2) return;
			try {
				this.describe(void 0, true);
			} catch (error) {
				this.ownerContext.logger.error(error);
			}
		});
	}`,
    "dsh-settings invalidate boot batching & emitOnly"
  );

  code = replaceOnce(
    code,
`	describe(options) {
		const active = /* @__PURE__ */ new Set();
		const descriptors = this.ownerContext.configEditor.configuration().flatMap(({ entry, inherited, override }) => {
			const schema = this.schema(entry);
			if (schema === void 0 || entry.fiber === void 0 || entry.fiber.runtime === null || entry.fiber.state !== 2) return [];
			const form = volatileForm(schema);
			if (form === void 0) return [];
			active.add(entry.id);
			const raw = JSON.stringify([
				entry.fiber.uid,
				schema.toJSON(),
				entry.options.config ?? {}
			]);
			const autoGenerate = this.presentations.get(entry.fiber.ctx.fiber)?.auto ?? true;
			const previous = this.revisions.get(entry.id);
			const revision = previous === void 0 ? 0 : previous.revision + Number(previous.raw !== raw);
			this.revisions.set(entry.id, {
				raw,
				revision,
				ns: entry.options.id,
				autoGenerate
			});
			if (previous?.raw !== raw || previous.autoGenerate !== autoGenerate) this.ownerContext.emit("settings/document-updated", entry.options.id, revision);
			const value = projectForm(form, plainConfig(entry.fiber.effectiveConfig));
			const resolved = interpolate(entry.fiber.ctx, inherited);
			const base = projectForm(form, plainConfig(inheritedConfig(entry.fiber.runtime, resolved)));
			const user = projectForm(form, override);
			const redacted = redactSecrets(form, value);
			return [{
				autoGenerate,
				ns: entry.options.id,
				schema: form.toJSON(),
				revision,
				applies: "live",
				value: options?.redactSecrets ? redacted.value : value,
				base: options?.redactSecrets ? redactSecrets(form, base).value : base,
				user: options?.redactSecrets ? redactSecrets(form, user).value : user,
				...options?.redactSecrets ? { secrets: redacted.secrets } : {}
			}];
		});
		for (const [id, previous] of this.revisions) {
			if (active.has(id) || previous.raw === void 0) continue;
			const revision = previous.revision + 1;
			this.revisions.set(id, {
				...previous,
				raw: void 0,
				revision
			});
			this.ownerContext.emit("settings/document-updated", previous.ns, revision);
		}
		return descriptors;
	}`,
`	describe(options, emitOnly = false) {
		const active = /* @__PURE__ */ new Set();
		let descriptors;
		if (emitOnly === true) {
			descriptors = [];
			for (const entry of this.ownerContext.configEditor.entries()) {
				const schema = this.schema(entry);
				if (schema === void 0 || entry.fiber === void 0 || entry.fiber.runtime === null || entry.fiber.state !== 2) continue;
				const form = volatileForm(schema);
				if (form === void 0) continue;
				active.add(entry.id);
				const schemaJson = getCachedSchemaJson(schema);
				const raw = JSON.stringify([
					entry.fiber.uid,
					schemaJson,
					entry.options.config ?? {}
				]);
				const autoGenerate = this.presentations.get(entry.fiber.ctx.fiber)?.auto ?? true;
				const previous = this.revisions.get(entry.id);
				const revision = previous === void 0 ? 0 : previous.revision + Number(previous.raw !== raw);
				this.revisions.set(entry.id, {
					raw,
					revision,
					ns: entry.options.id,
					autoGenerate
				});
				if (previous?.raw !== raw || previous.autoGenerate !== autoGenerate) this.ownerContext.emit("settings/document-updated", entry.options.id, revision);
			}
		} else {
			const redact = Boolean(options?.redactSecrets);
			descriptors = this.ownerContext.configEditor.configuration().flatMap(({ entry, inherited, override }) => {
				const schema = this.schema(entry);
				if (schema === void 0 || entry.fiber === void 0 || entry.fiber.runtime === null || entry.fiber.state !== 2) return [];
				const form = volatileForm(schema);
				if (form === void 0) return [];
				active.add(entry.id);
				const schemaJson = getCachedSchemaJson(schema);
				const raw = JSON.stringify([
					entry.fiber.uid,
					schemaJson,
					entry.options.config ?? {}
				]);
				const autoGenerate = this.presentations.get(entry.fiber.ctx.fiber)?.auto ?? true;
				const previous = this.revisions.get(entry.id);
				const revision = previous === void 0 ? 0 : previous.revision + Number(previous.raw !== raw);
				this.revisions.set(entry.id, {
					raw,
					revision,
					ns: entry.options.id,
					autoGenerate
				});
				if (previous?.raw !== raw || previous.autoGenerate !== autoGenerate) this.ownerContext.emit("settings/document-updated", entry.options.id, revision);
				const cacheKey = \`\${entry.id}\\0\${redact}\`;
				const layersSig = JSON.stringify([entry.fiber.effectiveConfig ?? null, inherited, override]);
				const cachedDesc = this.descriptorCache.get(cacheKey);
				if (cachedDesc !== void 0 && cachedDesc.raw === raw && cachedDesc.revision === revision && cachedDesc.autoGenerate === autoGenerate && cachedDesc.layersSig === layersSig && cachedDesc.form === form) {
					return [structuredClone(cachedDesc.descriptor)];
				}
				const value = projectForm(form, plainConfig(entry.fiber.effectiveConfig));
				const resolved = interpolate(entry.fiber.ctx, inherited);
				const base = projectForm(form, plainConfig(inheritedConfig(entry.fiber.runtime, resolved)));
				const user = projectForm(form, override);
				const redacted = redactSecrets(form, value);
				const desc = {
					autoGenerate,
					ns: entry.options.id,
					schema: getCachedSchemaJson(form),
					revision,
					applies: "live",
					value: redact ? redacted.value : value,
					base: redact ? redactSecrets(form, base).value : base,
					user: redact ? redactSecrets(form, user).value : user,
					...redact ? { secrets: redacted.secrets } : {}
				};
				this.descriptorCache.set(cacheKey, {
					raw,
					revision,
					autoGenerate,
					layersSig,
					form,
					descriptor: structuredClone(desc)
				});
				return [desc];
			});
		}
		for (const [id, previous] of this.revisions) {
			if (active.has(id) || previous.raw === void 0) continue;
			const revision = previous.revision + 1;
			this.revisions.set(id, {
				...previous,
				raw: void 0,
				revision
			});
			this.ownerContext.emit("settings/document-updated", previous.ns, revision);
		}
		return descriptors;
	}`,
    "dsh-settings describe descriptor cache & emitOnly"
  );

  setReplacement(path, code);
  log("Prepared patch for: " + path);
}
