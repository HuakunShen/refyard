/**
* | output |
* | --- |
* | "Remote" |
*
* @param {Push_Upstream_Remote_LabelInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const push_upstream_remote_label: ((inputs?: Push_Upstream_Remote_LabelInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Push_Upstream_Remote_LabelInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Push_Upstream_Remote_LabelInputs = {};
