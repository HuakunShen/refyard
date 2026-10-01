/**
* | output |
* | --- |
* | "Create branch at {commit}" |
*
* @param {Dialog_Create_Branch_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_create_branch_title: ((inputs: Dialog_Create_Branch_TitleInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Create_Branch_TitleInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Create_Branch_TitleInputs = {
    commit: NonNullable<unknown>;
};
