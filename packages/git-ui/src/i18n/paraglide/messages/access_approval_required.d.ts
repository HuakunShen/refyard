/**
* | output |
* | --- |
* | "approval required" |
*
* @param {Access_Approval_RequiredInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const access_approval_required: ((inputs?: Access_Approval_RequiredInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Access_Approval_RequiredInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Access_Approval_RequiredInputs = {};
