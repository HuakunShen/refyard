/**
* | output |
* | --- |
* | "Commit message — leave empty to keep \"{parent}\"" |
*
* @param {Dialog_Squash_MessageInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_squash_message: ((inputs: Dialog_Squash_MessageInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Squash_MessageInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Squash_MessageInputs = {
    parent: NonNullable<unknown>;
};
