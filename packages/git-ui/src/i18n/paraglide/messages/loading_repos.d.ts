/**
* | output |
* | --- |
* | "Loading repositories…" |
*
* @param {Loading_ReposInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const loading_repos: ((inputs?: Loading_ReposInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Loading_ReposInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Loading_ReposInputs = {};
