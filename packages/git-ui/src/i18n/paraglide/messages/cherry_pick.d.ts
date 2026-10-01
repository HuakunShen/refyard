/**
* | output |
* | --- |
* | "Cherry-pick" |
*
* @param {Cherry_PickInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const cherry_pick: ((inputs?: Cherry_PickInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Cherry_PickInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Cherry_PickInputs = {};
