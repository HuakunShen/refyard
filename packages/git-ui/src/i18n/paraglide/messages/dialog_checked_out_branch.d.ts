/**
* | output |
* | --- |
* | "the checked-out branch" |
*
* @param {Dialog_Checked_Out_BranchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_checked_out_branch: ((inputs?: Dialog_Checked_Out_BranchInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Checked_Out_BranchInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Checked_Out_BranchInputs = {};
