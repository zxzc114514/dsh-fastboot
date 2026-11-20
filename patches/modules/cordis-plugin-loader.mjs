import { replaceOnce } from "./utils.mjs";

export function patchCordisPluginLoader({ readFromAsar, setReplacement, log = () => {} }) {
  const filePath = "dsh/node_modules/@deepseek-ai/cordis-plugin-loader/lib/index.js";
  let code = readFromAsar(filePath);

  code = replaceOnce(
    code,
`	getTasks() {
		return [...this.entries()].map((entry) => entry._initTask || entry.fiber?.inertia).filter(isNonNullable);
	}`,
`	hasPendingTasks() {
		for (const entry of this.entries()) {
			if (entry._initTask || entry.fiber?.inertia) return true;
		}
		return false;
	}
	getTasks() {
		return [...this.entries()].map((entry) => entry._initTask || entry.fiber?.inertia).filter(isNonNullable);
	}`,
    "cordis-plugin-loader EntryTree.hasPendingTasks"
  );

  code = replaceOnce(
    code,
`		this.fiber?.await().catch(() => {}).finally(() => {
			if (this.loader.getTasks().length) return;
			this.ctx.reflect.notify(["loader"]);
		});`,
`		this.fiber?.await().catch(() => {}).finally(() => {
			if (this.loader.hasPendingTasks()) return;
			this.ctx.reflect.notify(["loader"]);
		});`,
    "cordis-plugin-loader Entry.init use hasPendingTasks"
  );

  code = replaceOnce(
    code,
`	[Service.check]() {
		if (Service.prototype[Service.resolveConfig].call(this).await && this.getTasks().length) return false;
		return true;
	}`,
`	[Service.check]() {
		if (Service.prototype[Service.resolveConfig].call(this).await && this.hasPendingTasks()) return false;
		return true;
	}`,
    "cordis-plugin-loader Loader[Service.check] use hasPendingTasks"
  );

  setReplacement(filePath, code);
  log("Prepared patch for: " + filePath);
}
