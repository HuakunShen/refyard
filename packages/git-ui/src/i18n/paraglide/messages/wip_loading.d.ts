/**
* | output |
* | --- |
* | "Loading…" |
*
* @param {Wip_LoadingInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const wip_loading: ((inputs?: Wip_LoadingInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Wip_LoadingInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Wip_LoadingInputs = {};
