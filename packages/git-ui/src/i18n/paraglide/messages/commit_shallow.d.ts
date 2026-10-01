/**
* | output |
* | --- |
* | "Shallow history" |
*
* @param {Commit_ShallowInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_shallow: ((inputs?: Commit_ShallowInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Commit_ShallowInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Commit_ShallowInputs = {};
