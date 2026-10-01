/**
* | output |
* | --- |
* | "Sync URL" |
*
* @param {Submodule_Sync_UrlInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const submodule_sync_url: ((inputs?: Submodule_Sync_UrlInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Submodule_Sync_UrlInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Submodule_Sync_UrlInputs = {};
