import { replaceOnce } from "./utils.mjs";

export function patchProfileBoot({ detectProfileBootPath, readFromAsar, setReplacement, log = () => {} }) {
  const filePath = detectProfileBootPath();
  let code = readFromAsar(filePath);

  code = replaceOnce(
    code,
`import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";`,
`import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";`,
    "profile-boot import readFileSync"
  );

  code = replaceOnce(
    code,
`function prepareProfile(name, userLayer = true, fromDefaultProfile) {
	if (fromDefaultProfile !== void 0) initializeProfileFromDefault(name, fromDefaultProfile);
	const profile = loadProfile(NAME, name, INSTALL_ANCHOR, void 0, { userLayer });
	reportSkippedBundles(NAME, profile);
	writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG);
	return profile;
}`,
`function ensureProfileRootFile(dir) {
	const target = join(dir, PROFILE_ROOT_FILENAME);
	try {
		if (readFileSync(target, "utf8") === PROFILE_ROOT_CONFIG) return;
	} catch {}
	writeFileSync(target, PROFILE_ROOT_CONFIG);
}
function prepareProfile(name, userLayer = true, fromDefaultProfile) {
	if (fromDefaultProfile !== void 0) initializeProfileFromDefault(name, fromDefaultProfile);
	const profile = loadProfile(NAME, name, INSTALL_ANCHOR, void 0, { userLayer });
	reportSkippedBundles(NAME, profile);
	ensureProfileRootFile(profile.dir);
	return profile;
}`,
    "profile-boot ensureProfileRootFile in prepareProfile"
  );

  code = replaceOnce(
    code,
`	if (resolvedProfile !== void 0) writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG);`,
`	if (resolvedProfile !== void 0) ensureProfileRootFile(profile.dir);`,
    "profile-boot ensureProfileRootFile in composeProfile"
  );

  setReplacement(filePath, code);
  log("Prepared patch for: " + filePath);
}
