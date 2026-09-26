/**
* | output |
* | --- |
* | "Commit message" |
*
* @param {Working_Copy_Commit_MessageInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const working_copy_commit_message: ((inputs?: Working_Copy_Commit_MessageInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Working_Copy_Commit_MessageInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Working_Copy_Commit_MessageInputs = {};
