/**
* | output |
* | --- |
* | "Remotes & sync" |
*
* @param {Sidebar_Remotes_SyncInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sidebar_remotes_sync: ((inputs?: Sidebar_Remotes_SyncInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Sidebar_Remotes_SyncInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Sidebar_Remotes_SyncInputs = {};
