/**
* | output |
* | --- |
* | "Branch" |
*
* @param {Push_Upstream_Branch_LabelInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const push_upstream_branch_label: ((inputs?: Push_Upstream_Branch_LabelInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Push_Upstream_Branch_LabelInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Push_Upstream_Branch_LabelInputs = {};
