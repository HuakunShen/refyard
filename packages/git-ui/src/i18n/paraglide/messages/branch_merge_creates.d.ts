/**
* | output |
* | --- |
* | "merge creates a commit" |
*
* @param {Branch_Merge_CreatesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_merge_creates: ((inputs?: Branch_Merge_CreatesInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Branch_Merge_CreatesInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Branch_Merge_CreatesInputs = {};
