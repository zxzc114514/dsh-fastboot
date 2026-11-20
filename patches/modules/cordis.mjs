import { replaceOnce } from "./utils.mjs";

export function patchCordis({ readFromAsar, setReplacement, log = () => {} }) {
  const filePath = "dsh/node_modules/@deepseek-ai/cordis/lib/index.js";
  let code = readFromAsar(filePath);

  code = replaceOnce(
    code,
`var ReflectService = class {
	ctx;
	/** Proxy traps implementing service resolution for every context object. */
	static handler = {
		get: (target, prop, ctx) => {
			if (isSpecialProperty(prop)) return Reflect.get(target, prop, ctx);
			if (Reflect.has(target, prop)) return getTraceable(ctx, Reflect.get(target, prop, ctx));
			const error = /* @__PURE__ */ new Error(\`cannot get property "\${prop}" without inject\`);
			try {
				const def = target.reflect.props[prop];
				if (def?.type === "accessor") return def.get.call(ctx, ctx[symbols.receiver], error);
				const defSite = ctx[symbols.shadow] ?? ctx;
				if (!defSite.fiber.runtime) return ctx.reflect.get(prop, false);
				return ctx.events.waterfall("internal/get", ctx, prop, error, () => {
					const key = defSite[symbols.isolate][prop];
					let fiber = defSite.fiber;
					while (true) {
						let impl = fiber.committed?.[prop];
						for (const provision of fiber.provisions) if (provision.name === prop && provision.ctx[symbols.isolate][prop] === key) impl = provision;
						if (impl) return getTraceable(ctx, impl.value);
						if (prop in fiber.inject) {
							error.message = \`cannot get required service "\${prop}" in inactive context\`;
							throw error;
						}
						if (!fiber.runtime) throw error;
						if (fiber.parent[symbols.isolate][prop] !== key) throw error;
						fiber = fiber.parent.fiber;
					}
				});
			} catch (e) {
				throw e === error ? enhanceError(e) : e;
			}
		},
		set: (target, prop, value, ctx) => {
			if (isSpecialProperty(prop)) return Reflect.set(target, prop, value, ctx);
			const error = /* @__PURE__ */ new Error(\`cannot set property "\${prop}" without provide\`);
			const def = target.reflect.props[prop];
			if (!def) {
				if (!ctx.fiber.runtime) return Reflect.set(target, prop, value, ctx);
				throw enhanceError(error);
			}
			try {
				if (def.type === "accessor") {
					if (!def.set) return false;
					return def.set.call(ctx, value, ctx[symbols.receiver], error);
				}
				return ctx.events.waterfall("internal/set", ctx, prop, value, error, () => {
					return ctx.reflect.set(prop, value, error);
				});
			} catch (e) {
				throw e === error ? enhanceError(e) : e;
			}
		},`,
`const _CORDIS_MISS_MISSING = Symbol("cordis-miss-missing");
const _CORDIS_MISS_INACTIVE = Symbol("cordis-miss-inactive");
function _resolveFiberService(ctx, defSite, prop) {
	const key = defSite[symbols.isolate][prop];
	let fiber = defSite.fiber;
	while (true) {
		let impl = fiber.committed?.[prop];
		for (const provision of fiber.provisions) if (provision.name === prop && provision.ctx[symbols.isolate][prop] === key) impl = provision;
		if (impl) return getTraceable(ctx, impl.value);
		if (prop in fiber.inject) return _CORDIS_MISS_INACTIVE;
		if (!fiber.runtime) return _CORDIS_MISS_MISSING;
		if (fiber.parent[symbols.isolate][prop] !== key) return _CORDIS_MISS_MISSING;
		fiber = fiber.parent.fiber;
	}
}
var ReflectService = class {
	ctx;
	/** Proxy traps implementing service resolution for every context object. */
	static handler = {
		get: (target, prop, ctx) => {
			if (isSpecialProperty(prop)) return Reflect.get(target, prop, ctx);
			if (Reflect.has(target, prop)) return getTraceable(ctx, Reflect.get(target, prop, ctx));
			let error;
			try {
				const def = target.reflect.props[prop];
				if (def?.type === "accessor") {
					if (!def.errorless) error = /* @__PURE__ */ new Error(\`cannot get property "\${prop}" without inject\`);
					return def.get.call(ctx, ctx[symbols.receiver], error);
				}
				const defSite = ctx[symbols.shadow] ?? ctx;
				if (!defSite.fiber.runtime) return ctx.reflect.get(prop, false);
				if ((ctx.events._hooks["internal/get"]?.length ?? 0) > 0) {
					error = /* @__PURE__ */ new Error(\`cannot get property "\${prop}" without inject\`);
					return ctx.events.waterfall("internal/get", ctx, prop, error, () => {
						const found = _resolveFiberService(ctx, defSite, prop);
						if (found === _CORDIS_MISS_INACTIVE) {
							error.message = \`cannot get required service "\${prop}" in inactive context\`;
							throw error;
						}
						if (found === _CORDIS_MISS_MISSING) throw error;
						return found;
					});
				}
				const found = _resolveFiberService(ctx, defSite, prop);
				if (found === _CORDIS_MISS_INACTIVE) {
					error = /* @__PURE__ */ new Error(\`cannot get required service "\${prop}" in inactive context\`);
					throw error;
				}
				if (found === _CORDIS_MISS_MISSING) {
					error = /* @__PURE__ */ new Error(\`cannot get property "\${prop}" without inject\`);
					throw error;
				}
				return found;
			} catch (e) {
				throw error !== void 0 && e === error ? enhanceError(e) : e;
			}
		},
		set: (target, prop, value, ctx) => {
			if (isSpecialProperty(prop)) return Reflect.set(target, prop, value, ctx);
			const def = target.reflect.props[prop];
			if (!def) {
				if (!ctx.fiber.runtime) return Reflect.set(target, prop, value, ctx);
				throw enhanceError(/* @__PURE__ */ new Error(\`cannot set property "\${prop}" without provide\`));
			}
			let error;
			try {
				if (def.type === "accessor") {
					if (!def.set) return false;
					if (!def.errorless) error = /* @__PURE__ */ new Error(\`cannot set property "\${prop}" without provide\`);
					return def.set.call(ctx, value, ctx[symbols.receiver], error);
				}
				if ((ctx.events._hooks["internal/set"]?.length ?? 0) > 0) {
					error = /* @__PURE__ */ new Error(\`cannot set property "\${prop}" without provide\`);
					return ctx.events.waterfall("internal/set", ctx, prop, value, error, () => {
						return ctx.reflect.set(prop, value, error);
					});
				}
				return ctx.reflect.set(prop, value, void 0);
			} catch (e) {
				throw error !== void 0 && e === error ? enhanceError(e) : e;
			}
		},`,
    "cordis ReflectService.handler lazy Error & bypass empty waterfall"
  );

  code = replaceOnce(
    code,
`			for (const [key, value] of entries) yield self.accessor(value, {
				get(receiver, error) {`,
`			for (const [key, value] of entries) yield self.accessor(value, {
				errorless: true,
				get(receiver, error) {`,
    "cordis mixin mark errorless accessor"
  );

  setReplacement(filePath, code);
  log("Prepared patch for: " + filePath);
}
