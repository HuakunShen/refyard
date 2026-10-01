/**
* | output |
* | --- |
* | "Open repository" |
*
* @param {Launcher_Open_RepoInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_open_repo: ((inputs?: Launcher_Open_RepoInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Launcher_Open_RepoInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Launcher_Open_RepoInputs = {};
