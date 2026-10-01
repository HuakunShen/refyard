/**
* | output |
* | --- |
* | "stash message" |
*
* @param {Stash_Aria_MessageInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const stash_aria_message: ((inputs?: Stash_Aria_MessageInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Stash_Aria_MessageInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Stash_Aria_MessageInputs = {};
