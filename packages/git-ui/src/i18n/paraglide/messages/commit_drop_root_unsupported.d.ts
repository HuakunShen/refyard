/**
* | output |
* | --- |
* | "The first commit cannot be dropped." |
*
* @param {Commit_Drop_Root_UnsupportedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_drop_root_unsupported: ((inputs?: Commit_Drop_Root_UnsupportedInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Commit_Drop_Root_UnsupportedInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Commit_Drop_Root_UnsupportedInputs = {};
