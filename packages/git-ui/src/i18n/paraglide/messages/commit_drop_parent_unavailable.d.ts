/**
* | output |
* | --- |
* | "The parent commit is unavailable locally." |
*
* @param {Commit_Drop_Parent_UnavailableInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_drop_parent_unavailable: ((inputs?: Commit_Drop_Parent_UnavailableInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Commit_Drop_Parent_UnavailableInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Commit_Drop_Parent_UnavailableInputs = {};
