/**
* | output |
* | --- |
* | "Submit" |
*
* @param {Push_Upstream_SubmitInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const push_upstream_submit: ((inputs?: Push_Upstream_SubmitInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Push_Upstream_SubmitInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Push_Upstream_SubmitInputs = {};
