/**
* | output |
* | --- |
* | "Cherry-pick \"{subject}\" onto {branch}?" |
*
* @param {Dialog_Cherry_Pick_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_cherry_pick_title: ((inputs: Dialog_Cherry_Pick_TitleInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Cherry_Pick_TitleInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Cherry_Pick_TitleInputs = {
    subject: NonNullable<unknown>;
    branch: NonNullable<unknown>;
};
