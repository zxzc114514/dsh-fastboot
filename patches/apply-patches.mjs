import { patchDshAppBoot } from "./modules/dsh-app-boot.mjs";
import { patchDshDesktopHost } from "./modules/dsh-desktop-host.mjs";
import { patchMainJs } from "./modules/main-js.mjs";
import { patchDshHmr } from "./modules/dsh-hmr.mjs";
import { patchDshConfigEditor } from "./modules/dsh-config-editor.mjs";
import { patchDshSettings } from "./modules/dsh-settings.mjs";
import { patchDshClientModules } from "./modules/dsh-client-modules.mjs";
import { patchDshClientHmr } from "./modules/dsh-client-hmr.mjs";
import { patchProfileBoot } from "./modules/profile-boot.mjs";
import { patchCordis } from "./modules/cordis.mjs";
import { patchCordisPluginLoader } from "./modules/cordis-plugin-loader.mjs";

export function detectProfileBootPath(listPaths) {
  const candidates = listPaths().filter((p) => /^dsh\/node_modules\/@deepseek-ai\/dsh\/lib\/profile-boot-[^/]+\.js$/.test(p));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) return candidates.sort()[0];
  throw new Error("Cannot locate dynamic profile-boot-*.js chunk in ASAR");
}

export function applyFastbootPatches({ listPaths, readText, log = () => {} }) {
  const profileBootPath = detectProfileBootPath(listPaths);
  const replacements = new Map();

  function readFromAsar(entryPath) {
    const overridden = replacements.get(entryPath);
    if (overridden !== void 0) return overridden.toString("utf8");
    const txt = readText(entryPath);
    if (txt === null || txt === void 0) throw new Error(`Entry not in ASAR: ${entryPath}`);
    return txt;
  }

  function setReplacement(entryPath, code) {
    replacements.set(entryPath, Buffer.from(code, "utf8"));
  }

  const ctx = {
    detectProfileBootPath: () => profileBootPath,
    readFromAsar,
    setReplacement,
    log
  };

  patchDshAppBoot(ctx);
  patchDshDesktopHost(ctx);
  patchMainJs(ctx);
  patchDshHmr(ctx);
  patchDshConfigEditor(ctx);
  patchDshSettings(ctx);
  patchDshClientModules(ctx);
  patchDshClientHmr(ctx);
  patchProfileBoot(ctx);
  patchCordis(ctx);
  patchCordisPluginLoader(ctx);

  return replacements;
}
