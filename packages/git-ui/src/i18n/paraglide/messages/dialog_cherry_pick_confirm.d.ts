/**
* | output |
* | --- |
* | "Cherry-pick \"{subject}\"" |
*
* @param {Dialog_Cherry_Pick_ConfirmInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_cherry_pick_confirm: ((inputs: Dialog_Cherry_Pick_ConfirmInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Cherry_Pick_ConfirmInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Cherry_Pick_ConfirmInputs = {
    subject: NonNullable<unknown>;
};
