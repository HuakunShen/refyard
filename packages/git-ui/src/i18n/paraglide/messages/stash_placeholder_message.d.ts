/**
* | output |
* | --- |
* | "stash message (optional)" |
*
* @param {Stash_Placeholder_MessageInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const stash_placeholder_message: ((inputs?: Stash_Placeholder_MessageInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Stash_Placeholder_MessageInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Stash_Placeholder_MessageInputs = {};
